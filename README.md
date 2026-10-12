# Smart Hostel Marketplace

**One-paragraph description (SRS abstract object):** The Smart Hostel
Marketplace is a campus-only, rule-abiding digital marketplace where hostel
students buy, sell and negotiate within their own hostel block (MH/LH), so that
peers never leave their rooms to trade. Students verify their real hostel
identity (reg no, phone number, block, room) with two-factor authentication,
list SFW items with hover previews of price/quantity, then chat, offer and
complete handoffs through an escrow simulation with a 48h review window, PIN/QR,
disputes and AI-assisted pricing. All five services run as independent
Next.js 14 microservices sharing one Postgres instance (one schema per service)
and one Redis cache.

> **Phase 2 status: identity-service implemented** (register → verify → login →
> session/refresh → admin roles → profiles → JWKS, all verified with a clean production
> build + typecheck). All other apps remain **Phase 1 scaffolding only**.
> This README and the `docs/` folder are the home for the full SRS (drop it
> here later); the paragraph above follows the playbook supplied with the task.

---

## Folder structure

```
hostel-marketplace/
├── frontend/                  Next.js 14 (App Router + TS) - student-facing UI
├── gateway/                   Thin reverse-proxy (stub in Phase 1)
└── services/
    ├── identity-service/      Auth, users, hostel identity
    ├── marketplace-service/   Listings, search, offers/negotiation
    ├── communication-service/ Chat, chat-safety, notifications
    ├── transaction-service/   Transactions, escrow, PIN/QR, disputes
    └── ai-service/            Pricing AI, categorisation, recommendations, risk
├── infra/
│   ├── docker-compose.yml     Single-command full-stack (Postgres + Redis + 7 apps)
│   └── init-db/               Schemas + least-privilege DB roles (run once on first boot)
└── docs/                      SRS, spec iterations, decisions log
```

Each folder under `services/`, `frontend/` and `gateway/` is a **standalone**
Next.js 14 (App Router, TypeScript) project: own `package.json`, `tsconfig.json`,
its own `Dockerfile` (multi-stage, `node:20-alpine`, production build). No pages
in the services or gateway — they expose only `app/api/` route handlers, so all
inter-service calls are plain REST over the Docker network in prod.

## Quick start — run the whole system

```bash
# 1. Create your .env (from the values-free template) and fill it in:
cp .env.example .env

# 2. Bring up Postgres, Redis and all 7 Next.js services:
docker compose -f infra/docker-compose.yml --env-file .env up --build
```

Open the service map:

| Service | Port | Docker network name |
|---|---|---|
| frontend | 3000 | `frontend` |
| gateway | 4000 | `gateway` |
| identity-service | 4001 | `identity-service` |
| marketplace-service | 4002 | `marketplace-service` |
| communication-service | 4003 | `communication-service` |
| transaction-service | 4004 | `transaction-service` |
| ai-service | 4005 | `ai-service` |
| Postgres | 5432 | `postgres` |
| Redis | 6379 | `redis` |

Logs interleave; stop everything with `Ctrl+C`, then `docker compose down` (add
`-v` only if you want to throw away the Postgres data volume).

## Run just your own service (one teammate, one machine)

Each teammate owns one service. Start the **shared** Postgres + Redis once, then
develop in your own app with zero Docker built around you:

```bash
# 1. Shared infra only (postgres + redis), from the repo root:
docker compose -f infra/docker-compose.yml --env-file .env up -d postgres redis

# 2. In YOUR service folder:
cd services/identity-service
cp ../../.env.example .env           # fill in YOUR variables (read below)
npm install                          # or: npm run dev (installs everything inside Docker)
npm run dev
```

Dev server: `http://localhost:4001` (`npm run dev` already pins the right port).
Point at the **shared** Postgres/Redis by pointing `IDENTITY_DATABASE_URL` /
`REDIS_URL` at `localhost:15432` / `localhost:16379` (host port mapping in
`infra/docker-compose.yml`), e.g.:

```
IDENTITY_DATABASE_URL=postgresql://identity_app:<password>@localhost:15432/hostel_marketplace
REDIS_URL=redis://localhost:16379
```

`IDENTITY_APP_PASSWORD` and the other role passwords live in your **root**
`.env` (mounted into the Docker network containers via `env_file`), while the
service-local copy keeps its own `DATABASE_URL` etc. for native dev — there is
no cross-pollution between Docker and your laptop.

> The `IDENTITY_*` env names below match the `identity_app` role the
> `infra/init-db/` scripts create on first boot.

## Database bootstrap (one-time, on first boot)

`infra/init-db/` runs automatically, alphabetically, when the Postgres volume is
empty for the first time. Schemas are created first, then least-privilege roles,
then schema-level grants, so each service's DB user can only touch its own
schema. Re-run from scratch with `docker compose down -v` (wipes the dev DB).

- `infra/init-db/001-schemas.sql` — 5 schemas
- `infra/init-db/002-roles.sh` — roles with passwords from **env** (SQL can't
  read environment, hence the script) + schema ownership
- `infra/init-db/003-grants.sql` — least-privilege grants (same-current-user default
  privileges, `search_path` scoped per role)

## Phase 2 — identity-service (implemented)

Full auth microservice on Next.js 14 App Router. Handlers live in
`services/identity-service/src/routes/*.ts`; the files under
`src/app/api/**/route.ts` are thin re-exports.

### Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | Liveness for Docker HEALTHCHECK / gateway |
| POST | `/api/auth/register` | College-email signup, argon2id hash — no email verification step |
| POST | `/api/auth/login` | Session + JWT (plain email + password, no 2FA step) |
| POST | `/api/auth/refresh` | Rotates refresh token (httpOnly cookie), new access token |
| POST | `/api/auth/logout` | Revokes session, clears cookie |
| GET / PATCH | `/api/users/me` | Own profile (JWT Bearer) |
| GET | `/api/users/[id]/public` | Least-privilege public profile (no email/UPI) |
| GET | `/api/users` | Admin userbase: accounts that logged in + their role |
| PATCH | `/api/users/[id]/role` | Admin role toggle (user ↔ admin, admin-gated) |
| GET | `/.well-known/jwks.json` | JWKS for other services to verify our tokens |

### Extra env vars (root `.env`)

```
IDENTITY_DATABASE_URL=postgresql://identity_app:<pw>@localhost:15432/hostel_marketplace
REDIS_URL=redis://localhost:16379
JWT_PRIVATE_KEY="<PEM contents, BEGIN/END lines included>"
JWT_PUBLIC_KEY="<PEM contents>"
JWT_ISSUER=identity-service
JWT_AUDIENCE=hostel-marketplace
COLLEGE_EMAIL_DOMAINS=college.edu,students.example.edu
```

Generate the JWT key pair once with:

```bash
openssl genpkey -algorithm RSA -out jwt_private.pem 2048
openssl rsa -in jwt_private.pem -pubout -out jwt_public.pem
```

### Verify it locally

```bash
cd services/identity-service
npm install
npx next build        # ✓ Compiled successfully — 13 routes
npm run typecheck     # ✓ tsc --noEmit clean
npm run dev           # http://localhost:4001/api/health
```

Register → log in. Registration is plain email+password (no verification
email) and login issues the token pair directly (no 2FA/OTP step).

### Known limitations (next phase)

- Admin authorization is admin-side: roles live in `users.role` and are
  toggled from the admin console's **userbase** page.

## Verified on the plan

| Requirement | Phase 1 |
|---|---|
| Monorepo named `hostel-marketplace`, exact structure | ✅ |
| Standalone Next.js 14 (App Router, TS) per app, own package.json/tsconfig/Dockerfile | ✅ |
| API-route-only services + gateway (no pages) | ✅ |
| PostgreSQL 16 + Redis 7, healthchecks, `depends_on: service_healthy` | ✅ |
| Root `.env` shared via `env_file` on every service | ✅ |
| Postgres roles with least-privilege per schema | ✅ |
| Scaffolding **only** — no business logic | ✅ |

### Next steps

- `gateway/` stub (no reverse-proxy logic yet) → proxy phase when routing begins
- ✅ `identity-service` route tree + auth flows (Phase 2)
- Remaining services' `app/api/` route trees as their feature phases land
- `docs/` grows the SRS and an implementation/architecture log

## Known limitations (Phases 4–5 audit)

- **Stale JWT claims until refresh (M2):** `PATCH /api/users/me` updates the database but an
  already-issued access token keeps its old `hostelBlock` claim (marketplace block-wise search
  reads the claim), so a profile change is reflected only after the next refresh/re-login —
  self-healing because access tokens live 15 minutes; no structural fix is scheduled yet.
- **No SOLD data for price suggestions (M4):** no code path sets
  `marketplace.listings.status='SOLD'` yet (accepting an offer flips the offer row only, the
  listing stays ACTIVE), so ai-service `POST /api/suggest/price` returns its labeled
  `FALLBACK_DEFAULT` band in real usage — **transaction-service (Phase 6)** closes this by
  writing SOLD transitions when deals complete.

### Phase 4–5 additions (root `.env`)

Per-service `COMMUNICATION_DATABASE_URL` / `AI_DATABASE_URL` and the `*_SERVICE_URL` entries
already existed in the Phase 1 `.env.example` template. Genuinely NEW variables added since
the Phase 2 section was written:

| Variable | Purpose | Service |
|---|---|---|
| `INTERNAL_SERVICE_API_KEY` | Shared service-to-service API key protecting internal-only routes (`POST /api/notifications`); sent as `x-internal-api-key`, never a user JWT | communication-service (Phase 4) |
| `HF_API_TOKEN` | Hugging Face Inference API token for image captioning; leave empty to run the pure-template fallback (SRS 7.12) | ai-service (Phase 5) |
| `HF_CAPTION_MODEL` | HF image-captioning model id (default `Salesforce/blip-image-captioning-base`) | ai-service (Phase 5) |
| `HF_API_URL` | HF Inference API base URL (default `https://api-inference.huggingface.co/models`; overridable for tests) | ai-service (Phase 5) |
| `SERVICE_*_URL` (5 vars) | Gateway-only upstream table (`SERVICE_IDENTITY_URL` … `SERVICE_AI_URL`, compose service names) | gateway (Phase 7) |
| `INTERNAL_SERVICE_KEY` | Key the gateway injects as `x-service-key` on every forwarded request | gateway → all services (Phase 7 / audit Step 2) |
| `QR_ENCRYPTION_KEY` | 32-byte base64 AES-256-GCM key for handover QR payloads | transaction-service (Phase 6) |
| `DUAL_AUTH_THRESHOLD` | Paise amount above which dispute resolution needs a second admin | transaction-service (Phase 6) |
| `ADMIN_USER_IDS` | legacy admin allowlist (roles are now DB-backed; see Known limitations below) | transaction (audit Q4) |

## Known limitations / operational notes (pre-frontend audit)

- **Admin roles are DB-backed (admin console).** identity-service has no
  self-serve admin creation. The `users.role` column (`user` / `admin`) is the
  single source of truth: identity stamps a **signed `role` claim** into every
  access token it mints (login and refresh re-read the column), and
  transaction-service's admin gate accepts the signed claim first, falling back
  to the legacy `ADMIN_USER_IDS` env list only for tokens minted before the
  claim existed. Roles are changed from the admin console's **userbase** page
  (`PATCH /api/users/:id/role`, admin-gated, self-demotion blocked); a change
  takes effect for a user at their next login or token refresh.
- **N4 / two service-URL env families exist on purpose.**
  Family A `IDENTITY_SERVICE_URL / MARKETPLACE_SERVICE_URL / COMMUNICATION_SERVICE_URL /
  TRANSACTION_SERVICE_URL / AI_SERVICE_URL` (localhost-style, Phase 1 template) is read by
  **identity, marketplace, communication, transaction and ai** for their outbound
  peer calls. Family B `SERVICE_IDENTITY_URL / SERVICE_MARKETPLACE_URL /
  SERVICE_COMMUNICATION_URL / SERVICE_TRANSACTION_URL / SERVICE_AI_URL`
  (compose service names) is read **only by the gateway** as its upstream routing
  table. Keep both in sync when ports change; consolidating them is a possible
  future cleanup, deliberately not done in the hardening pass.
- **N5 / Razorpay and Hugging Face are stubs-only.** `RAZORPAY_KEY_ID`,
  `RAZORPAY_KEY_SECRET` and `RAZORPAY_WEBHOOK_SECRET` are empty in `.env`, so
  `POST /api/transactions/:id/escrow/init` returns **503 RAZORPAY_NOT_CONFIGURED**
  and the webhook fails closed (`400 INVALID_SIGNATURE`) — no real payment flow can
  run until TEST-mode keys are pasted in. `HF_API_TOKEN` is likewise empty, so AI
  captions use the labeled template fallback. Everything end-to-end has been proven
  with local test doubles (see the Phase 6 suites); the live sandbox APIs remain an
  **unverified integration point** by design (user decision Q7).
- **N2 / services are gateway-only (audit Step 2).** Every service runs a shared
  `src/middleware.ts` gate: direct-port traffic without `x-service-key: $INTERNAL_SERVICE_KEY`
  (the value the gateway injects) is rejected with **403**. Exempt by design:
  `/api` (info), `/api/health`, `/.well-known/*` (JWKS), `/api/webhooks/*`
  (Razorpay HMAC-authenticated), `/api/internal/*` (internal-key routes), and
  communication's `/api/socketio` socket attachment.
- **N1 / SOLD write (audit Step 1).** On handover verification, transaction-service
  marks the listing `SOLD` in marketplace **before** attempting the payout, using the
  shared internal key (`PATCH /api/internal/listings/:id/status`). If that call fails,
  settlement aborts with the transaction left at `HANDOVER_VERIFIED` and a clear
  retryable error — a payout can never succeed while the listing is still ACTIVE.
- **Dev-stack note (audit F1–F3).** There is no email sending in the stack at
  all (Resend/verification/2FA were removed): registration and login are plain
  email+password. identity's Docker image
  carries argon2's musl prebuilds explicitly because Next's standalone tracer prunes
  them (see `services/identity-service/Dockerfile`).

### Closeout pass (pre-frontend, G1–G3)

- **Deployment: webhook ingress is direct-to-service by design.** The gateway
  deliberately has **no `/api/webhooks/*` mount** (verified: `POST
  :4000/api/webhooks/razorpay` → 404). Razorpay webhooks originate from Razorpay's
  servers, not from a logged-in user, so JWT-gated gateway proxying does not apply
  to them. In every deployment, transaction-service's webhook route
  (`POST /api/webhooks/razorpay`, port 4004 locally) **must be reachable directly
  by Razorpay**, bypassing the gateway. The route authenticates itself via the
  Razorpay HMAC signature and fails closed (`400 INVALID_SIGNATURE`) when
  `RAZORPAY_WEBHOOK_SECRET` is unset or the signature does not verify. Configure
  the webhook URL in the Razorpay dashboard to point at transaction-service's
  public address, not the gateway's.
- **Route visibility: browsing requires login (confirmed intentional, Q2).**
  Through the gateway (`:4000`) — the only public ingress — every route requires a
  valid access-token JWT **except**: identity auth routes (`register`, `login`,
  `refresh`, `logout`),
  gateway info routes (`GET /api`, `GET /api/health`), and each service's
  `GET /api/health` + `GET /api` info. Identity's JWKS (`/.well-known/jwks.json`)
  is public by design. Marketplace listing search/browse (`GET
  /api/marketplace/listings`) is public **at the service layer** (no
  `requireAuth`), but the gateway JWT-gates it — so a logged-out visitor cannot
  browse today; making browse public later would mean a scoped gateway `authBypass`
  for that one GET (deliberately not done). All other GETs require a JWT:
  marketplace `listings/:id`, `offers`, `offers/:id`, `stats/sold`; communication
  `conversations`, `conversations/:id`, `notifications`; transaction
  `transactions`, `transactions/:id`; ai `recommendations`; identity `users/me`.
  Direct service ports enforce the `x-service-key` gate (N2 above), so
  service-layer routes are never anonymously reachable except the middleware
  exemptions listed there.
- **Fresh-volume bootstrap: apply the per-service schemas (closeout finding).**
  `infra/init-db/` creates schemas, roles and grants only — **not tables**. After
  a true `docker compose down -v`, each service's `db/schema.sql` must be applied
  **as that service's DB role** (the role's `search_path` pins it to its own
  schema; applying as `postgres` would land tables in `public`):
  ```bash
  for pair in "identity:identity_app" "marketplace:marketplace_app" \
              "communication:communication_app" "transaction:transaction_app" "ai:ai_app"; do
    docker compose --project-directory infra exec -T postgres \
      psql -U "${pair##*:}" -d hostel_marketplace \
      -v ON_ERROR_STOP=1 < "services/${pair%%:*}-service/db/schema.sql"
  done
  ```
  (Automating this into the boot sequence is a possible future cleanup,
  deliberately not done in this pass.)
- **Internal key pairing (closeout finding).** `INTERNAL_SERVICE_KEY` (injected
  by the gateway as `x-service-key`) and `INTERNAL_SERVICE_API_KEY` (the value
  services compare against) must hold **the same plaintext value** — the N2
  middleware SHA-256-hashes both sides before comparing, so a hash in one and
  plaintext in the other will never match and **every gateway-routed request
  403s**. Symptom seen in the closeout run: `403 {"error":"FORBIDDEN","message":
  "Missing or invalid x-service-key header"}` on all gateway routes with
  healthy containers.
- **Auth session model: memory-only tokens — you are logged out on every page
  refresh (known, accepted tradeoff, H5).** Identity-service returns the access
  token (15 min) and refresh token in the login/refresh **JSON body**; the
  frontend holds both in module-scope JavaScript memory (`lib/api/client.ts`)
  and **never** in `localStorage`/`sessionStorage` (a hard build-brief rule:
  web storage is readable by any script, so a single XSS payload would exfiltrate
  the tokens) and never in a cookie it sets itself. The deliberate cost:
  JavaScript memory dies with the page, so **every refresh or reopened tab
  requires logging in again**. Within a live page session, a 401 triggers one
  silent refresh-and-retry; after a reload there is nothing left to refresh
  with. This is a documented engineering decision, not an oversight. One
  clarification found during the closeout recon: identity's login route *does*
  already set an httpOnly `refreshToken` cookie — but with `path=/api/auth/refresh`,
  which never matches the browser's gateway path (`/api/identity/auth/refresh`),
  so the cookie never flows; and the refresh route reads the token from the JSON
  body only, never the cookie. Wiring silent re-login-after-reload up is therefore    a *small* backend change (gateway-compatible cookie path + cookie fallback in
    the refresh route), deliberately **not** made in this pass (user decision Q4:
    documentation-only); it is the natural next step if the logout-on-refresh UX
    becomes unacceptable.

## End-to-end smoke test (Phase 10)

```bash
bash scripts/smoke-test.sh          # needs the stack up; exits non-zero on any failure
```

Drives the real stack through the gateway (`:4000`) and frontend (`:3000`):
asserts the login/register gate hides every protected route from a logged-out
visitor, registers and logs in a seller/buyer/admin, uploads an image to
Cloudinary and publishes a listing, runs the offer → accept → escrow → delivery
→ **buyer receipt (No then Yes)** lifecycle, then checks the purchases history,
the admin-only surfaces and third-party access denial.

It prints `PASS`/`FAIL`/`BLOCKED` per assertion and summarises at the end. One
assertion is reported `BLOCKED` by design: the live escrow capture and Razorpay
payout need real test-mode credentials, so escrow funding and the PIN/QR
handover are advanced with a controlled DB fixture and the payout is truthfully
reported `PENDING` — the run never claims money moved.

`docs/phase10-report.md` holds the full Phase 10 report (file inventory per
module, Cloudinary root cause, test repairs, smoke-test results) and
`docs/frontend-file-map.md` the per-module frontend map.
