# Full-Playbook Audit Report — hostel-marketplace

Date: 2026-10-02 · Scope: P1–P8 static + live audit ("VERIFY STRICTLY, FIX ONLY DEFECTS, REPORT")
Method: Step 0 recon → Step 1 phase adherence → Step 2 cross-service contracts → Step 3 execution proof (build / up / health / 159 tests / E2E / role isolation) → Step 4 known-lapse checklist → this report.

**Verdict: PASS.** All eight phases adhere to the playbook; every defect found was fixed and re-verified with real output. **Phase 9 can start** once the two user-owned env actions in §6 are done.

---

## 1. Phase-by-phase results

| Phase | Requirement | Status | Evidence | Fix |
|---|---|---|---|---|
| **P1 Infra** | Compose stack, port remap, schema-per-service init | ✅ PASS | `infra/docker-compose.yml` (postgres 15432, redis 16379, `env_file ../.env`); init-db 001-schemas/002-roles/003-grants; **all 9 containers healthy** after rebuild; role isolation proven live (see §3) | README.md stale 5432/6379 refs → 15432/16379 |
| **P2 identity** | Auth lifecycle, rotation, JWKS, profile API | ✅ PASS | 17/17 tests; refresh rotation + replay→family-revoke proven live (200/401/401); token `kid` == JWKS kid; PATCH `/users/me` now mints fresh RS256 token from updated row (claims verified == DB row) | `users/me` PATCH response → `{user, accessToken, tokenType, expiresIn}` (see §5 note) |
| **P3 marketplace** | Listings, FTS, offers, internal gate, paise | ✅ PASS | 40/40 tests; FTS GIN index w/ A/B weights; `FOR UPDATE` on state changes; direct :4002 key matrix (403/403/200); paise regression test (800.00→80000) | — |
| **P4 communication** | Messaging, safety, socket delivery, notifications API | ✅ PASS | 41/41 tests; `delivered=TRUE` **only** on real socket emit (`messages.ts:90-97`, tests :166-213); blocked msgs stored `delivered=false` (:302-313); notification guard matrix re-proven post-rebuild (201/403/401) | — |
| **P5 ai** | Moderation verdicts, price suggest, recs, HF fallback | ✅ PASS | 35/35 tests; live: suggest `{low:600,mid:600,high:600}` basis SOLD_CATEGORY `sold-median-v1`, `fallbackUsed:false`; recommendations category-ranked; templated fallback + clamping under test | — |
| **P6 transaction** | Escrow→webhook→handover→payout, 48h timer, disputes | ✅ PASS | 19/19 tests **after isolation fix**; webhook HMAC raw-body + event-id idempotency (unsigned rejected, T2); dual-auth >₹5000 (DUAL_AUTH_THRESHOLD 500000); payout idempotency stored pre-call; PIN `crypto.randomInt` + argon2-only; DB recovery re-queues | **Audit Fix #1**: harness + test queue moved to Redis DB 1 (was stolen by live `txn-release` worker on DB 0) |
| **P7 gateway** | Proxy, key injection, JWKS cache, aggregate health | ✅ PASS | 7/7 tests; aggregate health `allOk:true` ×5; x-service-key injected (`proxy.ts:92`); JWKS 10-min cache; downstream gate proven (no key 403 / wrong 403 / gateway 200); structured logs | Env drift (container keys ≠ `.env`) **resolved by rebuild** — hashes now identical (`0df5d1a13918`) |
| **P8 frontend** | Gateway-only API, no localStorage, health route | ✅ PASS | All calls via `/gw/*` rewrite → :4000; no localStorage (comments only); home `/` 200 static; **new** `/api/health` 200; PATCH `/users/me` shape change confirmed compatible (frontend never PATCHes it; GET shape unchanged) | **Audit Fix #3**: `frontend/app/api/health/route.ts` added (was 404) |

**Test totals: 159/159 green** (identity 17, marketplace 40, communication 41, transaction 19, ai 35, gateway 7), run via `npm run test:integration` per service.

---

## 2. Live E2E proof (through gateway :4000)

register (seller/buyer, XF-blocked) → DB dev-verify → login ×2 (2FA first) → listing ACTIVE → conversation (sellerId server-derived ✓) → SAFE message delivered; "whatsapp me at 9876543210" → `OFF_PLATFORM_REQUEST`, `delivered:false` → offer → ACCEPTED → txn 60000 paise → escrow/init 502 (**swapped Razorpay keys — §6**) → DB bridge ESCROW_PENDING → HMAC webhook → PIN → HANDOVER_PENDING → verify 202 `HANDOVER_VERIFIED` retriable (payout unconfigured — §6) → listing SOLD ✓ → no plaintext PIN at rest ✓ → kid contract MATCH ✓.

## 3. Role isolation (live psql, lapse #10)

| Probe | Result |
|---|---|
| `marketplace_app` → `identity.users` | `permission denied for schema identity` |
| `marketplace_app` → INSERT `transaction.transactions` | `permission denied for schema transaction` |
| `identity_app` → `marketplace.listings` | `permission denied for schema marketplace` |
| `transaction_app` → `marketplace.listings` | `permission denied for schema marketplace` |
| `transaction_app` → `identity.users` | `permission denied for schema identity` |
| own-schema reads | OK (listings=9, transactions=8) |

## 4. Files changed (this audit) and why

| File | Change | Reason |
|---|---|---|
| `services/transaction-service/scripts/test-integration.sh` | `REDIS_URL=redis://localhost:16379/1` (comment placed above continuation) | Live worker on DB 0 stole harness jobs → false failures R1/R3/R4/S1b/T1 |
| `services/transaction-service/tests/release.test.ts` | `REDIS_URL` const → DB 1 | Match harness DB; DB-0/DB-1 split had broken T1 (409) |
| `services/identity-service/src/app/api/users/me/route.ts` | PATCH mints fresh RS256 token (login claim shape, 15m, `signingKid`) from updated row; `.catch(()=>null)` on body parse | Lapse #2: stale-token-after-profile-edit |
| `services/{marketplace,communication,transaction,ai}-service/Dockerfile`, `gateway/Dockerfile`, `frontend/Dockerfile` | `HEALTHCHECK` wget `/api/health` | Lapse #3: only identity had one; `compose ps` couldn't show app health |
| `frontend/app/api/health/route.ts` | NEW liveness route | HEALTHCHECK target didn't exist (404) |
| `README.md` | 5432/6379 → 15432/16379 (3 spots) | Lapse #4: doc/host-port drift would mislead native-run devs |
| `.env.example` | + `COLLEGE_EMAIL_DOMAINS` (zod-required, signup 500s without it), + `RAZORPAY_FUND_ACCOUNT_ID` | Lapse #5: required key missing from template |
| *(ops)* Redis DB 0 | purged poisoned `bull:txn-release:*` keys | Harness-era stale jobs; safe (recovery re-queues from DB) |

## 5. Verified-untouched (correct as-is)

- Lapse #1 refresh rotation (M1) — already fixed; live-proven (200/401/401).
- Lapse #7 — delivered-flag semantics + internal-key guard fully tested; socket.io co-located dev+standalone (`src/pages/api/socketio.ts`); normalizer tests ≥15.
- Lapse #8 gateway not a stub — proven live end-to-end.
- Lapse #9 — all frontend traffic via `/gw`; `NEXT_PUBLIC_GATEWAY_URL` in template.
- Lapse #11 — money is integer paise end-to-end; only rupee→paise ingress is `Math.round(Number(offeredPrice)*100)` (`transactions.ts:96`).
- Lapse #12 — HF-down templated fallback, clamping, `modelVersion` all verified.
- Lapse #6 — vitest ^5.0.2 + vite ^8.3.1 pinned in all 6; `.npmrc` copied in every service Dockerfile that runs `npm ci` (frontend has none and needs none — standalone build, no workspace deps).
- Escrow `FOR UPDATE`, FTS weights, PIN never returned post-generation, webhook idempotency, dual-auth, 48h auto-release + DB recovery — all confirmed statically and (where applicable) live.

## 6. User-owned items (report-only, need your action)

1. **Razorpay `RAZORPAY_KEY_ID`/`RAZORPAY_KEY_SECRET` appear swapped** in `.env` — escrow/init returns 502 live. Swap them back.
2. **`RAZORPAY_FUND_ACCOUNT_ID` unset** — handover verify correctly returns 202 `HANDOVER_VERIFIED` with payout retriable. Set it to complete the payout leg. (Now present in `.env.example`.)

## 7. Ops notes

- **Wedged pg-pool**: long-lived `next dev`/standalone containers can hit "timeout exceeded" (pg-pool) after the test harness hammers shared Postgres; Postgres itself is fine. Fix: `docker compose restart <service>`. Seen on identity + transaction.
- **Integration tests** must run via `npm run test:integration` per service (plain `npm test` lacks env). Transaction tests intentionally use Redis DB 1 to coexist with the live worker.
- **Gateway 401 on `/api/communication/notifications`** is by design: internal-only endpoints aren't exposed through the public gateway mount; call :4003 directly with both `x-service-key` and `x-internal-api-key`.
- **`GET /api/users/me`** returns snake_case DB fields (unchanged); **PATCH** now returns `{user, accessToken, tokenType, expiresIn}` — any *future* profile-edit UI must read `accessToken` from the PATCH response and swap it into memory.

## 8. Readiness

| Phase | Compliance |
|---|---|
| P1–P8 (each) | 100% of auditable requirements verified; all found defects fixed & re-verified |
| **Overall** | **100% system-side**; residual risk = the two §6 env items (user-owned) + one documented gap (frontend restores sessions by re-login on reload — by design, commented in `auth-context.tsx`) |

**Can Phase 9 start? — YES.** Stack is green (9/9 healthy, 159/159 tests, E2E pass, isolation proven). Complete the two §6 env actions first so payment flows work end-to-end during Phase 9 work.
