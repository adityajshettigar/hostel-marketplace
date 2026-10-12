# transaction-service

> **Honesty note:** This escrow implementation uses Razorpay TEST MODE and has
> not undergone external security audit or PCI/RBI compliance review — it is a
> correctly-engineered simulation suitable for a student/demo deployment, not a
> production payments system.

Phase 6: transaction lifecycle, smart escrow (Razorpay test mode), PIN/QR
handover, 48h auto-release, and disputes, in the `transaction` Postgres schema.

## State machine

```
DEAL_CONFIRMED → ESCROW_PENDING → ESCROW_LOCKED → HANDOVER_PENDING
  → HANDOVER_VERIFIED → COMPLETED
side: ESCROW_LOCKED|HANDOVER_PENDING → DISPUTED → ADMIN_REVIEW
  → RESOLVED → COMPLETED | REFUNDED
```

Every transition goes through a single code path (`src/state-machine.ts`) and
runs inside a Postgres transaction holding `SELECT … FOR UPDATE` on the row —
skips are impossible, and simultaneous verify-handover / auto-release are
serialized by the row lock. The 48h auto-release reuses the exact same settle
path as manual verification (`settleTransaction`, recheck-then-act), so there
is exactly one release code path.

## API

| Method | Path | Who | What |
| --- | --- | --- | --- |
| POST | `/api/transactions` | buyer | Verify offer ACCEPTED via marketplace-service (caller Bearer forwarded, fail-closed 502) → row `DEAL_CONFIRMED`. Also boots the lazy BullMQ release worker + DB recovery of pending release jobs. |
| GET | `/api/transactions?role=buying\|selling` | party | List own transactions |
| GET | `/api/transactions/:id` | party/admin | One transaction (404 for outsiders; PIN/QR never exposed) |
| POST | `/api/transactions/:id/escrow/init` | buyer | Razorpay Order (TEST MODE) for `amount_paise` → `ESCROW_PENDING`; returns order id |
| POST | `/api/webhooks/razorpay` | Razorpay | HMAC-SHA256 of the RAW body vs `X-Razorpay-Signature` (rejected + audited before any DB touch). Verified `payment.captured` (deduped on event id): escrow LOCKED, 4-digit PIN (argon2 hash only), AES-256-GCM QR `{transactionId, expiresAt}`, `release_deadline = now + 48h`, → `HANDOVER_PENDING`, BullMQ delayed job. Response carries the plaintext PIN **once**. |
| POST | `/api/transactions/:id/verify-handover` | seller | PIN (argon2.verify) or QR (decrypt + txn match + not expired). Max 3 attempts (SRS 5.7.1) — 3rd wrong sets `handover_locked` (admin unlock). Every attempt → append-only audit. Success: → `HANDOVER_VERIFIED`, then payout via shared settle path; `COMPLETED` only if the payout call actually succeeded, else stays `HANDOVER_VERIFIED` (BullMQ retries). Idempotency key (`release:<txnId>`) stored in `handover_idempotency` BEFORE calling Razorpay — no double-pay. |
| POST | `/api/transactions/:id/dispute` | buyer | ≥1 evidence URL (Cloudinary) → `DISPUTED`, release job cancelled + settle path refuses disputed rows, `admin_tickets` row created |
| PATCH | `/api/disputes/:id/resolve` | admin | `ADMIN_REVIEW` → `RESOLVED` → `COMPLETED` or `REFUNDED`. Amount > `DUAL_AUTH_THRESHOLD` paise requires a second, different admin (`secondAdminToken: "admin:<userId>"`, SRS 5.7.4). |
| GET | `/api` | — | Health (`{ok:true}` + DB ping) |

## Security properties (implemented, not skipped)

- Money is **integer paise** (`bigint`), never floats.
- Every state change: one DB transaction + `SELECT … FOR UPDATE` on the row.
- PIN: `crypto.randomInt(1000, 10000)`, stored **only** as argon2id hash; never
  logged, never stored plaintext, never returned after the webhook response.
- QR payload: AES-256-GCM (key `QR_ENCRYPTION_KEY`, 32-byte base64), decrypted
  server-side only, checked for transactionId match + expiry.
- Webhook: signature verified over the RAW body before anything else;
  invalid/unsigned attempts rejected + audited; idempotent on event id.
- Payout: idempotency key persisted before the Razorpay call; duplicate settle
  attempts are refused; `COMPLETED` implies a real 2xx payout response.
- `transaction_audit` is **insert-only**: `REVOKE UPDATE, DELETE, TRUNCATE …
  FROM transaction_app` (also as default privileges for future tables).
- Recovery: pending release jobs are recovered FROM the DB on the lazy runtime
  boot (first request after restart) — survives Redis loss (SRS 5.4.5).

## Admin authorization

identity-service has no role claim (audit precedent), so admins are a
comma-separated `ADMIN_USER_IDS` env list of user ids; JWT `sub` must match
(user decision Q3).

## Env vars

| Var | Meaning |
| --- | --- |
| `TRANSACTION_DATABASE_URL` | Postgres URL for `transaction_app` (search_path pinned to `transaction`) |
| `IDENTITY_SERVICE_URL` | identity-service (JWKS) |
| `MARKETPLACE_SERVICE_URL` | marketplace-service (offer verification) |
| `JWT_PUBLIC_KEY` / `JWT_ISSUER` / `JWT_AUDIENCE` | RS256 verification (JWKS-first, env fallback) |
| `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` | Razorpay TEST MODE API keys |
| `RAZORPAY_WEBHOOK_SECRET` | webhook HMAC secret |
| `RAZORPAY_FUND_ACCOUNT_ID` | seller payout destination (test mode) |
| `QR_ENCRYPTION_KEY` | 32-byte base64 AES-256-GCM key |
| `DUAL_AUTH_THRESHOLD` | integer paise; dispute resolution above this needs a second admin |
| `ADMIN_USER_IDS` | comma-separated admin user ids |
| `REDIS_URL` | Redis for BullMQ delayed release jobs |

## Database

`db/schema.sql` owns the tables inside the `transaction` schema (apply AS
`transaction_app`):

- `transactions` — the escrow lifecycle row (amounts in paise)
- `webhook_events` — Razorpay event idempotency (unique event id)
- `handover_idempotency` — payout idempotency key per transaction
- `admin_tickets` — dispute tickets for admins
- `disputes` — buyer disputes with evidence URLs
- `transaction_audit` — append-only audit log (UPDATE/DELETE/TRUNCATE revoked)

## Tests

```
npm run test:integration     # stubs + server on :14004 + compose PG/Redis
```

12 tests: happy path e2e, webhook-signature-rejection,
duplicate-webhook-idempotency, 3-failed-PIN-attempts-locks,
dispute-freezes-and-blocks-auto-release, auto-release-does-not-fire-if-disputed,
payout-failure-stays-HANDOVER_VERIFIED-then-retries (real BullMQ + real settle
path), restart-proof job recovery, dual-auth dispute resolution, and guard
tests. Stub Razorpay lives at `scripts/stub-razorpay.js` (REST, sentinel
amount 133700 paise always fails to exercise the retry path).
