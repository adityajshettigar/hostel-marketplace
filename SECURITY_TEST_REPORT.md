# SECURITY_TEST_REPORT.md

Date: 2026-10-12 · Branch: `master` · Scope: the listing-detail fix, the order-lifecycle
verification, and the trust boundaries those touch (gateway → marketplace/transaction/identity,
inventory/financial state changes, secret handling, deployment exposure).

Method: read-only source review + the repo's own automated suites + live HTTP checks against the
already-running local compose stack + registry-based dependency scans. No DAST, no fuzzing, no
load testing, no production data, no live payment, no secret rotation, no service stopped or
rebuilt. Evidence is sanitized: **no secret value appears in this report** (names/keys only).

Authorized changes are limited to the six files listed in `IMPLEMENTATION_REPORT.md` §11; findings
outside that scope are reported, not silently fixed.

---

## 1. Findings (sorted by severity)

| ID | Severity | Confidence | Finding | Evidence | Impact | Recommendation |
|---|---|---|---|---|---|---|
| S1 | **High** | Verified | **Credentials recoverable from the repo.** The single initial commit (`a0ea0f4`) contains two agent-session transcripts — `freebuff-chat-2026-09-27T13-28-03.197Z.md` (4.7 MB) and `tillllnow` (5.7 MB) — that embed 33–34 of the current `.env` values, including `JWT_PRIVATE_KEY` (the RS256 token-signing key), `JWT_PUBLIC_KEY`, `INTERNAL_SERVICE_API_KEY` (≡ gateway `INTERNAL_SERVICE_KEY`), and every `*_DB_PASSWORD`. Both files are deleted in the working tree but still present in `HEAD`. Additionally, the untracked working-tree artifacts `10-10log`, `logs/till2now` and `logs/freebuff-chat-*.md` contain **47** configured values, adding `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, `CLOUDINARY_API_SECRET`, `HUGGINGFACE_API_KEY`, `HF_API_TOKEN` and `QR_ENCRYPTION_KEY`. | Value-by-value comparison of `.env` against the committed blobs (`git show HEAD:<file>`) and the working-tree files — exact matches; counts and key names only were retained. No git remote is configured, so the history has not been published. | Anyone with the repository (or a future clone/push/archive) can mint valid access tokens for any user id, call internal service-to-service endpoints with the shared key, read/write the databases, forge Razorpay webhook signatures and spend Cloudinary/HF quota. | Treat every listed credential as compromised: regenerate the JWT key pair, `INTERNAL_SERVICE_API_KEY`/`INTERNAL_SERVICE_KEY`, all DB passwords, the Razorpay key pair + webhook secret, the Cloudinary secret and HF token(s), `QR_ENCRYPTION_KEY`. Remove the transcripts from history (`git filter-repo`/BFG) or re-initialise the repo before any push. Add `10-10log`, `tillllnow`, `logs/` to `.gitignore`. **Not done here** (rotation/history rewrites are explicitly out of scope). |
| S2 | **High** | Verified | **No stock reservation on seller acceptance → overselling is possible.** `acceptOffer` (`services/marketplace-service/src/routes/offers.ts`) only flips `offers.status` to `ACCEPTED`; nothing decrements or reserves `listings.quantity` and no `reserved`/`sold` column exists (grep for `reserved`/`quantity -` finds no writer). | Source review of `acceptOffer`, `counterOffer`, `createOffer` + `marketplace-service/db/schema.sql` (`listings.quantity` has no reservation counterpart). Live suite shows two offers can each be accepted; the specification invariant "quantity 1 on stock 30 reserves exactly 1 unit; no oversell under concurrent acceptance" cannot hold. | Several buyers can each pay into a separate escrow for the same unit; only one can be delivered, so the others need a refund — and see S3 (no provider refund). Money can be stranded. | Add `reserved_quantity`/`sold_quantity` with `available = quantity − reserved − sold`; reserve atomically inside the accept transaction (`SELECT … FOR UPDATE`); release on reject/cancel/refund through the existing `x-internal-api-key` path; add a concurrent-accept test. |
| S3 | **High** | Verified | **Refunds are bookkeeping only — no provider refund call.** `resolveDispute(resolution: 'REFUNDED')` transitions the transaction to `REFUNDED` and writes an audit row, but never calls Razorpay. The code comment states it: *"admin refund; no Razorpay refund call in test mode"*. | `services/transaction-service/src/routes/disputes.ts` (REFUNDED branch); grep for a refund API call returns none. | A buyer whose order is rejected/disputed cannot actually be refunded; the UI state `REFUNDED` would overstate reality if surfaced as "refund completed". | Implement a server-side provider refund (amount bound to the verified payment, idempotency key persisted, status tracked from the provider response/webhook) and expose `REFUND_PENDING/SUBMITTED/PROCESSED/FAILED` truthfully. Blocked in practice by invalid local test keys (see S11). |
| S4 | Medium | Verified | **Public profile leaks a resident's room number to any authenticated user.** `GET /api/identity/users/:id/public` returns `fullName`, `hostelBlock`, **`roomNumber`** and `verificationStatus` for any user id, with no relationship to a listing or an accepted order. | Live call for a user id that is not the caller (`200` with `hostelBlock`+`roomNumber`); source of `services/identity-service/src/app/api/users/[id]/public/route.ts`; consumed by the listing page's `VerifiedResidentBadge`. | A buyer's room is discoverable before acceptance (offer/conversation payloads expose the counterparty's user id), contradicting the stated rule that buyer name/room/phone stay private until an order is accepted. | Return block + verification status only for the badge use case, or gate `roomNumber` behind an accepted order (the `deliveryDetails` route already models the authorized case). |
| S5 | Medium | Verified | **Every service port is published on `0.0.0.0` by the compose file.** `infra/docker-compose.yml` maps `4001–4005`, `4000`, `3000`, `15432` (Postgres) and `16379` (Redis) on all interfaces, although the gateway is the documented single ingress. | `docker ps` shows `0.0.0.0:4001-4005->…` and `0.0.0.0:15432->5432`; compose file review. | On a shared/LAN host, services are reachable directly, bypassing the gateway's JWT gate and rate limiting; Postgres/Redis are reachable with the short dev passwords (S7) — total data compromise. | Bind infrastructure to `127.0.0.1` in development (`127.0.0.1:15432:5432`) and remove the service-port mappings for deployment, or front them with a network policy/firewall. Keep Postgres published only where the local test harnesses need it. Not changed here (would alter the user's running dev workflow). |
| S6 | Medium | Verified | **Payment webhook cannot reach the transaction service through the gateway.** `/api/transaction/*` is JWT-gated (`authBypass: false`), so Razorpay's server-to-server `payment.captured` callback (no Bearer token) is rejected `401` at the gateway. Fail-closed, no data exposure. | `gateway/src/proxy.ts` `resolveRoute()`; already recorded as finding #1 in the repo's `docs/final-report.md` §5. The transaction suite proves the handler itself is correct (signature verification + event-id dedupe) when called directly. | Payments can never complete in this topology: orders stay `ESCROW_PENDING`, so the delivery/receipt/payout stages are unreachable for real users. | Choose one: add a precisely-scoped `authBypass` for the webhook path (signature verification remains the gate, as with any provider webhook) **or** expose only the webhook route to the service. Verify by posting a signed event through the gateway. Not changed here — it moves a security boundary and needs the owner's decision. |
| S7 | Low | Verified | **Local `.env` uses short development passwords** (`POSTGRES_*`, `*_DB_PASSWORD` are all < 12 characters). | Name-only length check of `.env`; `.env.example` values are empty, so nothing real is committed by the template. | Only exploitable together with S5 (published 5432/6379 on a non-loopback interface). | Generate strong unique passwords for any non-local deployment (documented in `docs/DEPLOYMENT.md`); the template must stay value-free (it does). |
| S8 | Low | Verified | **Malformed ids returned `500` (exception/error-path leak) — FIXED and now live.** `GET /api/listings/not-a-uuid` reached Postgres and raised `invalid input syntax for type uuid`, surfacing `500 INTERNAL` and logging an exception. | Live `500` before the fix; the source-built server answers `404 NOT_FOUND`, and after the two affected local containers were rebuilt the **running** app answers `404` too (`GET /api/listings/not-a-uuid`, `GET /api/offers/not-a-uuid`), covered by two new tests + a live smoke check. | Low: no data leaked (generic 500 body), but it is an unvalidated-input path and noisy error logging. | Done: UUID-shape guard in the shared row helpers. Note the deliberate choice of `404` (project convention for "id cannot resolve") over `400`; the frontend treats both identically. |
| S9 | Low | Verified | **29 dependency advisories across the 7 apps, including 1 critical per app.** All apps are flagged; the critical is `next` (self-hosted DoS via the Image Optimizer `remotePatterns` configuration) and the recurring highs are `postcss` (XSS in CSS stringify output), `source-map-js` (DoS) and build-tooling chains (`braces`/`micromatch`/`fast-glob`/`chokidar` are dev-only paths in the frontend). | `npm audit --json` in each app against the live registry: frontend 10 (1 crit / 7 high / 2 mod), gateway 3 (1/2/0), identity 4 (1/2/1), marketplace/communication/transaction/ai 3 each (1/2/0). Metadata freshness: fetched at run time in this session. | The Next.js Image Optimizer advisory only affects apps that serve `/_next/image`; the API services render no images and the frontend uses plain `<img>` with a single allow-listed remote host, which limits practical exposure. Still a real dependency risk. | Upgrade Next.js (and let the lockfile refresh postcss/source-map-js) in a separate, reviewed change — dependency upgrades were out of scope here. |
| S10 | Informational | Verified | **Unsigned Cloudinary upload preset is public by design.** `NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET` / `NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME` are inlined into the client bundle (intended); the private `CLOUDINARY_API_SECRET` is **not** in any client chunk. | Built client chunks scanned for every configured secret value → only `NEXT_PUBLIC_GATEWAY_URL` and `COLLEGE_EMAIL_DOMAINS` appear (both intentionally public). Live unsigned upload succeeded (used by the smoke test). | Anyone can upload arbitrary files to that preset, consuming the account's quota/bandwidth. | Keep the preset restricted (max size/format, folder, moderation) and monitor upload volume; never add a signed-upload secret to the frontend. |
| S11 | Informational (blocker) | Verified | **Live provider verification is blocked:** the Razorpay key pair is positively identified as **test mode** (`rzp_test…`) but was reported as rejected by Razorpay itself (`HTTP 401`, `docs/final-report.md` QA1), and `RAZORPAY_FUND_ACCOUNT_ID` is empty. | `.env` key-id prefix is `rzp_test…` (test mode confirmed, no value printed); `getEnv().RAZORPAY_FUND_ACCOUNT_ID` defaults to `''`. | Order-create, refund and payout cannot be exercised against the real sandbox; only the repo's Razorpay stub is authoritative. No real money can move in this configuration. | Supply a valid test key pair (and fund account id for payouts), then re-run the escrow/refund/payout paths. Never enable live keys for testing. |

### 1.1 Checks that passed (selected evidence)

| Check | Result |
|---|---|
| Listing detail requires a JWT at the gateway | `401` without a token |
| Cross-hostel listing detail | `404` both directions (MH→LH and LH→MH), no existence leak |
| Unknown / malformed listing id | `404` (was `500` for malformed — fixed) |
| Logged-out visitor on `/listings/:id` | HTML contains no listing data (no SSR leak) |
| Market search segregation | An MH search never returns an LH listing; the LH seller sees its own |
| Buyer receipt (`buyerConfirm`) authorization | Non-buyer (incl. the seller) → `404`; buyer before delivery → `409`; before PIN/QR handover → `409 HANDOVER_NOT_VERIFIED` |
| Buyer's "No" | Denial persisted, escrow untouched (`HANDOVER_VERIFIED|none`), no payout — verified in the DB |
| Buyer's "Yes" replay | Idempotent (`delivered:true` twice, single payout path) |
| Webhook signature | Unsigned/tampered → `400` before any state change; duplicate event id → no-op |
| Payout safety | Only `BUYER_CONFIRM`/admin `MANUAL_VERIFY` can settle; a failed payout never reaches `COMPLETED`; retry reuses the same key `release:<txnId>` |
| Dispute freeze | A `DISPUTED` row cannot be auto-released by the 48 h worker |
| PIN/QR handover | 3 failed attempts lock the handover; credential is buyer-only (`403` seller/admin, `404` stranger) |
| Admin surfaces | Audit log + disputes queue: admin `200`, student `403`; another user's order: `404` |
| Third-party order read | `404` (no existence leak) |
| Phone privacy | Buyer phone returned only by the seller-only `deliveryDetails` route for an *accepted* offer; absent from listing payloads and public profiles |
| Client-settable money fields | None: amounts/prices and all payment/refund/payout states are server-derived; the checkout callback cannot mark an order paid |
| Security headers | CSP/HSTS/nosniff/X-Frame-Options and locked-down CORS applied at the gateway and on API responses |
| Rate limiting | Login 5/min/IP (`429`+`Retry-After`) and gateway per-IP token bucket (`429`) |
| `.env` handling | Git-ignored and untracked; `.env.example` carries no real values; every real key is documented in the template |
| Client bundle | No private secret present in any built JS chunk |
| ARM64 base images | `node:20-alpine`, `postgres:16-alpine`, `redis:7-alpine` all publish `linux/arm64` manifests (registry `docker manifest inspect`), and no `--platform` pin exists in any Dockerfile |
| Database persistence | Named volumes `postgres_data` and `redis_data` in compose |

### 1.2 Explicitly not tested / not applicable

* **Browser-only security UI** (CSP behavior in a real browser, clickjacking, focus traps, XSS via
  rendered content): no browser is installed in this environment. `N/A` here.
* **AI service (`/api/ai/*`)**: untouched by this task and not on the listing/order path —
  `N/A` for this scope.
* **DAST / fuzzing / load or DoS testing / brute force / active scanning of public endpoints**:
  deliberately not run (prohibited by the task and destructive). `NOT RUN`.
* **SAST tooling** (semgrep/CodeQL/eslint-security): no scanner is installed and no tool install
  was authorized; substituted by targeted manual source review of the touched paths. `PARTIAL`.
* **Login/receipt flows with real email (Resend) and real Razorpay Checkout**: blocked (no
  verified sending domain; see S11). `BLOCKED`.
* **Historical/archival secret scan of every untracked artifact**: only the four artifacts found in
  the working tree were scanned (S1). `PARTIAL`.

---

## Security Metrics

Denominators are stated explicitly; every number below comes from a command run in this session.

### Test-case accounting

| Category | Identified | Applicable | Executed | PASS | FAIL | WARN | BLOCKED | NOT RUN | N/A |
|---|---|---|---|---|---|---|---|---|---|
| Service suites (6 apps, vitest) | 129 | 129 | 129 | 129 | 0 | 0 | 0 | 0 | 0 |
| Typechecks + frontend build | 8 | 8 | 8 | 8 | 0 | 0 | 0 | 0 | 0 |
| Live end-to-end smoke (63 checks) | 63 | 63 | 62 | 62 | 0 | 0 | 1 | 0 | 0 |
| Targeted manual checks (§1.1/§1.2) | 46 | 44 | 44 | 33 | 13 | 2 | 2 | 2 | 2 |
| **Total** | **246** | **244** | **243** | **232** | **13** | **2** | **3** | **2** | **2** |

* Executed coverage = executed applicable checks / applicable checks × 100 = **243 / 244 = 99.6 %**
* Pass rate among executed checks = PASS / executed × 100 = **232 / 243 = 95.5 %**
  (WARN and FAIL are **not** counted as passes.)
* Blocked = 3 (1 live seller payout in the smoke suite; 2 manual checks that need real provider
  credentials — live refund and live order-create).
* Manual-check FAILs break down as: 7 dependency-scan rows (S9, advisory presence per app),
  2 secret-exposure scans (S1), 1 invariant check (S2), 1 lifecycle check (S3), 1 privacy check
  (S4), 1 deployment-exposure scan (S5) — i.e. only 6 are application-behavior defects.
* The former smoke FAIL (`malformed id -> 500`) is **resolved**: it was a deployment-staleness
  artifact (the running container predated the source fix), not an open vulnerability. After
  rebuilding and recreating **only** the local `marketplace-service` and `frontend` containers, the
  live check passes (`404`, no exception leak) and the live smoke suite is 62 PASS / 0 FAIL /
  1 BLOCKED. Source was unchanged by that action — see `IMPLEMENTATION_REPORT.md` §0.

### Findings by severity and confidence

| Severity | Count | Confidence: Verified | Likely |
|---|---|---|---|
| Critical | 0 | 0 | 0 |
| High | 3 (S1, S2, S3) | 3 | 0 |
| Medium | 3 (S4, S5, S6) | 3 | 0 |
| Low | 3 (S7, S8, S9) | 3 | 0 |
| Informational | 1 (S10) | 1 | 0 |
| Informational/blocker | 1 (S11) | 1 | 0 |
| **Total** | **11** | **11** | **0** |

### Surface coverage

| Dimension | Found | Assessed |
|---|---|---|
| Services/apps | 7 (gateway, identity, marketplace, communication, transaction, ai, frontend) + Postgres + Redis | 7 reviewed; 6 runtime-exercised; ai tested but not security-scoped (N/A) |
| Client-consumed endpoints | 14 (listings list/detail/mine, offers list/detail, identity me/public/users, conversations, notifications, transactions list/detail, purchases list/detail, audit, disputes, fulfill, handover-credential) | 14 envelope-contract-checked live; the ordering/payment subset additionally exercised by 63 live E2E checks |
| MH/LH isolation scenarios | 6 (MH detail, LH detail, MH→LH detail, LH→MH detail, MH search, offer across groups) | 6 tested (all denied/allowed correctly) |
| Dependency manifests | 7 (`package-lock.json` per app) | 7 scanned with `npm audit` at run time (fresh advisory metadata) |
| Dependency findings | 29 advisories | 1 critical + 19 high + 3 moderate (unique per app; the same `next` advisory repeats in all 7 apps) |
| Secret-bearing config keys | 47 in `.env` | 47 checked against the template; 47 checked against 4 working-tree artifacts, the committed history and the built client bundle |
| Payment/refund/payout/webhook/idempotency scenarios | 12 | executed: signature rejection, duplicate webhook, PIN lockout, dispute freeze, buyer-confirm gate (yes/no/replay), idempotent retry with the same key, payout-failure never COMPLETED, no-payout-on-denial, listing-SOLD-before-payout = 10; blocked: live payout, live refund = 2 |
| Stock-concurrency scenarios | 2 (concurrent accept of one offer; capacity exhausted across offers) | executed: 1 (concurrent/duplicate accept → single terminal state); **not satisfied: 1** (capacity reservation — S2) |

### Integrity

* Changed files in this task: **6** (see `IMPLEMENTATION_REPORT.md` §11) — frontend query, listing
  page, hover overlay, marketplace handlers, marketplace tests, smoke test. Closing the P0 gate
  later in the session changed **no source file**; it rebuilt and recreated only the two affected
  local images/containers (`marketplace-service`, `frontend`) so the running app serves that code.
* Unexpected changes: **none**. The working tree was already dirty before this task (the project is
  uncommitted on top of one initial commit); the pre-existing state was not altered, nothing was
  reverted, no file was reformatted, no commit was created.
* Secrets disclosed in this report: **none** (key names and counts only).
* Production/shared data touched: **none** (the live E2E suite writes only to the local dev
  database, which is that suite's purpose).

### Final disposition

**Findings require remediation before beta.**

Rationale: the listing-detail defect is fixed and verified, the order/payout/refund *state machine*
is server-authoritative and idempotent, and no Critical-severity issue exists. However, four items
must be resolved before any beta or deployment: the recoverable credentials (S1, rotate +
scrub history), the missing stock reservation (S2), the absence of a real refund call (S3), and
the webhook-reachability decision (S6) — S1 and S2/S3 can directly cause account takeover and
stranded customer money respectively. S4/S5 are hardening items that become urgent the moment the
stack is reachable beyond a single trusted machine.
