# Security Policy & Design Notes

Hostel-marketplace is a student-to-student marketplace (Next.js 14 monorepo:
`frontend`, `gateway`, and five services). This document records the security
properties that are actually implemented in the codebase and the policies that
operators must follow. It is the Phase 9 hardening summary.

---

## 1. Transport, headers & CORS

Every Next.js API response (all five services **and** the gateway) is stamped
with helmet-equivalent headers by a single shared helper
(`src/lib/security.ts`) that is applied centrally in each service's
`src/middleware.ts` (so no route handler can omit them) and in the gateway's
catch-all route:

| Header | Value |
| --- | --- |
| `Content-Security-Policy` | `default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'; …` |
| `X-Frame-Options` | `DENY` |
| `X-Content-Type-Options` | `nosniff` |
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains; preload` |
| `Referrer-Policy` | `no-referrer` |
| `X-DNS-Prefetch-Control` | `off` |
| `Cache-Control` | `no-store, max-age=0, must-revalidate` (never overrides a route's explicit policy, e.g. the public JWKS) |
| `X-Powered-By` | `none` |

**CORS** is locked to an allow-list read from environment variables
(`FRONTEND_ORIGIN`, falling back to `NEXT_PUBLIC_GATEWAY_URL` / `FRONTEND_URL`).
Only the configured origin (plus `http://localhost:3000` / `:4000` in dev) is
ever reflected; any other `Origin` receives no CORS grant. `OPTIONS`
preflights are answered centrally (204) in each service's middleware and in the
gateway, and are not forwarded upstream.

The frontend applies the same base headers via `next.config.mjs` `headers()`,
with the strict CSP scoped to `/api/:path*`.

---

## 2. Authentication & JWT rotation policy

- **Signing:** RS256. The private key stays in the root `.env`; the public half
  is served at `/.well-known/jwks.json` (`kid` = SHA-256 JWK thumbprint). Other
  services verify with the JWKS key and fall back to `JWT_PUBLIC_KEY`.
- **Access tokens:** short-lived (`15m`), `iss`/`aud` checked, `type: access`.
- **Refresh tokens (rotation + reuse detection):**
  - Only `sha256(refreshToken)` is stored; the token itself lives in an
    httpOnly cookie.
  - Every refresh issues a **new** refresh token and moves the previous hash
    into `superseded_refresh_hashes` (the session row stays `ACTIVE`).
  - Replaying a superseded token (a theft signal) **revokes the entire family**
    — every session for that user — and returns `REFRESH_TOKEN_REUSED`.
  - A concurrent-rotation race is detected via a conditional `UPDATE … WHERE
    refresh_token_hash = $old` and treated the same way (family revocation).
- **Revocation:** logout / explicit revocation sets the session `REVOKED`;
  terminal sessions never rotate.
- **Admin authorization:** roles are DB-backed (`users.role`) and only
  changeable from the admin console's userbase routes (admin-gated,
  self-demotion blocked). identity stamps the role into the **signed** `role`
  claim at login/refresh, so demotions take effect on the next token mint.
  There is no 2FA/OTP step: sign-in is plain email + password over TLS.

### JWT key rotation (operational policy)

1. Generate a new RSA keypair and update `JWT_PRIVATE_KEY` / `JWT_PUBLIC_KEY`.
2. Restart **identity-service** first (it signs), then roll the verifying
   services. Access tokens live ≤ 15 minutes, so the outage window is small.
3. Because the `kid` is derived from the key, verifiers fetching JWKS pick up
   the new key automatically (10-minute cache). Keep the old public key
   available for at least one access-token lifetime if you rotate without
   accepting a short re-login window.

---

## 3. PIN handling (handover)

- At escrow lock the transaction service generates a random 4-digit PIN with
  `crypto.randomInt`.
- The PIN is stored **only as an argon2id hash** (`argon2.hash(pin, { type:
  argon2id })`). The plaintext is returned exactly once in the Razorpay webhook
  response and is never logged or persisted in clear.
- To let the buyer re-fetch their PIN, the plaintext is additionally stored
  **AES-256-GCM encrypted** (`encryptSecret`) alongside the hash; the hash
  remains the verification authority. The buyer-only handover-credential route
  decrypts it only while handover is pending.
- Verification uses `argon2.verify` (constant-time within the KDF).

---

## 4. Webhook signature verification

- Razorpay webhooks are verified with **HMAC-SHA256** of the **raw** request
  body using `RAZORPAY_WEBHOOK_SECRET`, compared **timing-safely** to the
  `X-Razorpay-Signature` header (`verifyWebhookSignature`).
- Verification **fails closed**: a missing secret or missing/invalid signature
  is rejected *before* any DB or outbound API call.
- Payouts are idempotent: the idempotency key is persisted (`PENDING`) **before**
  the payout call, so a retry never double-pays.

---

## 5. Rate limits in place

| Where | Scope | Limit | Behaviour |
| --- | --- | --- | --- |
| identity-service | `POST /api/auth/login` | 5 requests / 60 s / IP | Redis fixed-window; **fail-closed** (Redis down → 503) |
| gateway | all proxied routes | token bucket, capacity 30, refill 10/s per IP | 429 with `Retry-After` |

Client IP is taken from `X-Forwarded-For` (first hop) / `X-Real-IP`, which the
fronting proxy overwrites. Limits are applied *before* business logic.

---

## 6. Escrow honesty note (important)

The transaction service does **not** claim money has moved unless it has. In
`settleTransaction`:

1. The listing is flipped to `SOLD` in marketplace-service via the internal key
   **before any payout**. If that write fails, settlement aborts with the row
   safely at `HANDOVER_VERIFIED` and is retriable — there is never a "paid but
   still listed" state.
2. A payout is attempted via Razorpay. **`COMPLETED` is set only after a payout
   really succeeds** (2xx + payout id).
3. If the payout fails, the transaction stays `HANDOVER_VERIFIED` and is retried
   with the same idempotency key.

Razorpay is configured for **TEST MODE** in this deployment, and the Hugging
Face captioning call is a stub/fallback — the escrow *flow* is real, but no
real money leaves the environment.

---

## 7. Input validation & SQL safety

- Every route that reads a body or query params parses them with **Zod** before
  touching the database (shared `parseJsonBody` / `parseQuery` helpers).
- All SQL uses `pg` parameterized queries (`$1`, `$2`, …). Dynamic fragments are
  limited to hard-coded/whitelisted column names and `$N`-placeholder joins. The
  former unused identity helpers that interpolated table/column identifiers were
  removed in Phase 9.

---

## 8. Secret management & service isolation

- Secrets are read **only from `process.env`**; none are hardcoded.
- Each container runs `scripts/check-env.mjs` before `server.js` and **exits
  non-zero** if any required variable (the set shipped empty in the root
  `.env.example`) is missing.
- All five services are **gateway-only**: `src/middleware.ts` rejects direct
  traffic lacking the shared `x-service-key` (constant-time SHA-256 digests).
  Exempt: `/api/health`, `/.well-known/*`, `/api/webhooks/*` (HMAC-authenticated),
  `/api/internal/*` (shared internal key).

---

## Reporting a vulnerability

Do not open a public issue for security problems. Contact the maintainers
privately with reproduction steps and impact. Please allow reasonable time for a
fix before disclosure.
