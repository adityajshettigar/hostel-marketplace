# DEPLOYMENT.md — Smart Hostel Marketplace

Ground-truth deployment guide. Every variable name below was re-derived from
each app's `src/env.ts` (and `frontend/next.config.mjs`) at Phase 11 — not from
older docs. `.env.example` at the repo root is the authoritative template: it
lists every variable with the same names; values ship EMPTY unless the app has
a real default.

## 1. Topology

```
browser ──► frontend :3000 ──/gw/* rewrite──► gateway :4000 ──► identity-service      :4001 (Next.js, RS256 JWT issuer)
                                          ├──► marketplace-service :4002
                                          ├──► communication-service :4003
                                          ├──► transaction-service :4004 (Razorpay escrow, BullMQ)
                                          └──► ai-service :4005 (HF captions/price stats)

postgres :15432 (host) — one schema per service: identity / marketplace /
                         communication / "transaction" / ai (see infra/init-db/)
redis    :16379 (host) — identity rate-limits+OTP, transaction BullMQ (uses DB 1 in tests)
```

The browser never talks to a service directly: the frontend rewrites
`/gw/:path*` to `GATEWAY_ORIGIN`, and the gateway maps
`/api/{identity|marketplace|communication|transaction|ai}/*` to the matching
`SERVICE_*_URL`. Every service verifies the RS256 JWT against
`JWT_PUBLIC_KEY` (issuer `identity-service`, audience `hostel-marketplace`).

## 2. One-command bring-up (local)

```bash
cp .env.example .env          # then fill EVERY value (see §4)
docker compose -f infra/docker-compose.yml --env-file .env up -d --build
docker compose -f infra/docker-compose.yml --env-file .env ps   # wait: 9× (healthy)
```

Health check is wired into every container:
`CMD ["sh","-c","node scripts/check-env.mjs && node server.js"]` — a container
with a missing required variable exits non-zero instead of booting (Phase 9,
item 5). Verify with:

```bash
for p in 4000 4001 4002 4003 4004 4005; do curl -s -o /dev/null -w "$p %{http_code}\n" http://localhost:$p/api/health; done
```

`infra/init-db/` (001-schemas.sql, 002-roles.sh, 003-grants.sql) is mounted
into `/docker-entrypoint-initdb.d` and runs **only on a fresh Postgres
volume**. It creates the five schemas, the five least-privilege roles
(`identity_app`, `marketplace_app`, `communication_app`, `transaction_app`,
`ai_app`) with the `*_DB_PASSWORD` values from `.env`, and the grants.
Re-running from scratch: `docker compose down -v` (DESTROYS data).

Table schemas themselves live in each service's `db/schema.sql` and are
applied by the service role at first boot / by running them manually as the
role (psql) if you need to re-apply.

## 3. Secrets to generate before first boot

```bash
# JWT keypair (one pair, shared by every app through env):
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out jwt.pem
openssl rsa -in jwt.pem -pubout -out jwt.pub.pem
# Put the full PEM (with real newlines, quoted) into .env as
# JWT_PRIVATE_KEY / JWT_PUBLIC_KEY.

# 32-byte base64 key for QR handover material:
openssl rand -base64 32   # → QR_ENCRYPTION_KEY
```

`JWT_ISSUER=identity-service` and `JWT_AUDIENCE=hostel-marketplace` must be
**identical in all seven apps** (they are the defaults in `.env.example`).

## 4. Ground-truth environment map

### gateway (`gateway/src/env.ts`)
| Variable | Notes |
|---|---|
| `SERVICE_IDENTITY_URL` | default `http://identity-service:4001` |
| `SERVICE_MARKETPLACE_URL` | default `http://marketplace-service:4002` |
| `SERVICE_COMMUNICATION_URL` | default `http://communication-service:4003` |
| `SERVICE_TRANSACTION_URL` | default `http://transaction-service:4004` |
| `SERVICE_AI_URL` | default `http://ai-service:4005` |
| `INTERNAL_SERVICE_KEY` | plaintext the gateway injects as `x-service-key`; **must equal** every service's `INTERNAL_SERVICE_API_KEY` |
| `JWT_PUBLIC_KEY` / `JWT_ISSUER` / `JWT_AUDIENCE` | must match identity's signing pair |

### identity-service
| Variable | Notes |
|---|---|
| `IDENTITY_DATABASE_URL` | e.g. `postgresql://identity_app:<IDENTITY_DB_PASSWORD>@postgres:5432/hostel_marketplace` |
| `REDIS_URL` | `redis://redis:6379` (rate limits) |
| `JWT_PRIVATE_KEY` | RS256 PEM — the only signer |
| `JWT_PUBLIC_KEY` | served via JWKS; same PEM everywhere |
| `JWT_ISSUER` / `JWT_AUDIENCE` | `identity-service` / `hostel-marketplace` |
| `COLLEGE_EMAIL_DOMAINS` | comma-separated allowlist, e.g. `vitapstudent.ac.in` |
| `ADMIN_USER_IDS` | LEGACY fallback only — roles live in the `users.role` column and are changed from the admin console's **userbase** page; the SIGNED `role` claim minted from that column is authoritative |

### marketplace-service
| Variable | Notes |
|---|---|
| `MARKETPLACE_DATABASE_URL` | `postgresql://marketplace_app:<MARKETPLACE_DB_PASSWORD>@postgres:5432/hostel_marketplace` |
| `IDENTITY_SERVICE_URL` | server-to-server verification checks |
| `JWT_PUBLIC_KEY` / `JWT_ISSUER` / `JWT_AUDIENCE` | as above |
| `LISTING_IMAGES_MAX` | max images per listing (default 6) |
| `OFFER_TTL_HOURS` | PENDING offer expiry window |
| `INTERNAL_SERVICE_API_KEY` | **same plaintext as gateway's `INTERNAL_SERVICE_KEY`**; guards `PATCH /api/internal/listings/:id/status` |

### communication-service
| Variable | Notes |
|---|---|
| `COMMUNICATION_DATABASE_URL` | `postgresql://communication_app:<COMMUNICATION_DB_PASSWORD>@postgres:5432/hostel_marketplace` |
| `IDENTITY_SERVICE_URL` / `MARKETPLACE_SERVICE_URL` | server-to-server lookups |
| `JWT_PUBLIC_KEY` / `JWT_ISSUER` / `JWT_AUDIENCE` | as above |
| `INTERNAL_SERVICE_API_KEY` | same plaintext as gateway (min length 1, required) |

### transaction-service
| Variable | Notes |
|---|---|
| `TRANSACTION_DATABASE_URL` | `postgresql://transaction_app:<TRANSACTION_DB_PASSWORD>@postgres:5432/hostel_marketplace` |
| `IDENTITY_SERVICE_URL` / `MARKETPLACE_SERVICE_URL` | server-to-server (offer verification, fail-closed) |
| `INTERNAL_SERVICE_API_KEY` | same plaintext as gateway |
| `JWT_PUBLIC_KEY` / `JWT_ISSUER` / `JWT_AUDIENCE` | as above |
| `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` | test-mode pair (`rzp_test_…`) for local/dev |
| `RAZORPAY_WEBHOOK_SECRET` | the value configured in the Razorpay dashboard webhook |
| `RAZORPAY_API_BASE` | default `https://api.razorpay.com/v1` (tests point it at a stub) |
| `RAZORPAY_FUND_ACCOUNT_ID` | OPTIONAL; payouts stay retriable (`HANDOVER_VERIFIED`) while unset |
| `QR_ENCRYPTION_KEY` | 32-byte base64 — encrypts handover PIN/QR at rest |
| `DUAL_AUTH_THRESHOLD` | paise above which dispute resolution needs a second admin token (default `500000`) |
| `ADMIN_USER_IDS` | legacy fallback for pre-role-claim tokens; the SIGNED `role` claim is authoritative |
| `REDIS_URL` | BullMQ release/payout queue |

### ai-service
| Variable | Notes |
|---|---|
| `AI_DATABASE_URL` | `postgresql://ai_app:<AI_DB_PASSWORD>@postgres:5432/hostel_marketplace` |
| `IDENTITY_SERVICE_URL` / `MARKETPLACE_SERVICE_URL` | server-to-server (sold-stats for price suggestions) |
| `INTERNAL_SERVICE_API_KEY` | same plaintext as gateway |
| `JWT_PUBLIC_KEY` / `JWT_ISSUER` / `JWT_AUDIENCE` | as above |
| `HF_API_TOKEN` | OPTIONAL; without it captioning falls back to heuristics (`fallbackUsed: true`) |
| `HF_CAPTION_MODEL` / `HF_API_URL` | Hugging Face model id / endpoint defaults |

### frontend (browser-exposed + build)
| Variable | Notes |
|---|---|
| `NEXT_PUBLIC_GATEWAY_URL` | browser API base, e.g. `http://localhost:4000` |
| `NEXT_PUBLIC_RAZORPAY_KEY_ID` | **must be the SAME key id** as transaction-service's `RAZORPAY_KEY_ID` (checkout is opened from the browser) |
| `NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME` / `NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET` | unsigned direct-to-Cloudinary uploads from the browser |
| `GATEWAY_ORIGIN` | server-side `/gw` rewrite target; compose sets it as a **build arg** (`http://gateway:4000`); `next.config.mjs` falls back to `NEXT_PUBLIC_GATEWAY_URL` then `http://localhost:4000` |

### Postgres container (consumed by `infra/init-db/002-roles.sh`)
`POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` plus the five
`*_DB_PASSWORD` values: `IDENTITY_DB_PASSWORD`, `MARKETPLACE_DB_PASSWORD`,
`COMMUNICATION_DB_PASSWORD`, `TRANSACTION_DB_PASSWORD`, `AI_DB_PASSWORD`.

## 5. Production notes

- **TLS**: terminate at your edge (nginx/Caddy/ALB). Services already emit
  `Strict-Transport-Security`; the API CSP is `default-src 'none'` (JSON-only
  responses); the frontend carries its own page-oriented CSP in
  `frontend/next.config.mjs`.
- **CORS**: set `FRONTEND_ORIGIN` (or `NEXT_PUBLIC_GATEWAY_URL`) on every API
  app to the exact browser origin. Unknown origins get `Vary: Origin` only —
  the browser rejects them (fail-closed).
- **Secrets**: mount `.env` via your orchestrator's secret store; never bake
  `JWT_PRIVATE_KEY`, Razorpay secrets, or DB passwords into images.
- **Admins**: promote the account from the admin console's **userbase** page
  (role user → admin). Roles live in the `users.role` column; the signed JWT
  `role` claim is re-minted at the user's next login/refresh. There is no
  self-serve admin path (self-demotion is blocked).
- **Razorpay**: configure the webhook URL + `RAZORPAY_WEBHOOK_SECRET` in the
  dashboard; keep `RAZORPAY_API_BASE` at the default outside tests.
- **Migrations/tables**: apply each service's `db/schema.sql` as its DB role.
  `infra/init-db` only creates schemas/roles/grants.

## 6. Verification after deploy

1. `curl -s https://<gateway>/api/health` → `200`.
2. Register a real user through the frontend and log in — no verification
   email exists (plain email+password); a `401` on a wrong password confirms
   the identity round-trip.
3. Create a listing, make + accept an offer, create the transaction —
   `POST /api/transaction/transactions/:id/escrow/init` must return a real
   `razorpayOrder.id` (validates the Razorpay pair end-to-end).
4. `docker compose … ps` stays `(healthy)` after 10 minutes (proves
   check-env passed and no crash-looping).
