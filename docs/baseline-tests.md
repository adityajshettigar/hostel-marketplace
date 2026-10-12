# Baseline test results (Stage A, captured before Post-Phase-9 enhancement work)

Working tree was already dirty (Phase 9 changes uncommitted) — baseline recorded as-is, no resets.

## Typecheck (`npx tsc --noEmit`)

| App | exit | errors |
|---|---|---|
| frontend | 0 | 0 |
| gateway | 0 | 0 |
| identity-service | 0 | 0 |
| marketplace-service | 0 | 0 |
| communication-service | 0 | 0 |
| transaction-service | 0 | 0 |
| ai-service | 0 | 0 |

## Automated tests

Documented command per service: `npm run test:integration` (identity, marketplace, transaction, gateway)
and `npm test` (communication, ai) — see docs/final-report.md and docs/audit-report.md.

| Suite | Command | Result |
|---|---|---|
| identity | `npm run test:integration` | **10 failed / 17** (7 passed) — PRE-EXISTING |
| marketplace | `npm run test:integration` | **16 failed / 42** (26 passed) — PRE-EXISTING |
| transaction | `npm run test:integration` | 19 passed / 19 ✓ |
| communication | `npm test` | 20 passed / 20 ✓ |
| ai | `npm test` | 15 passed / 15 ✓ |
| gateway | `npm run test:integration` | 7 passed / 7 ✓ |

Plain `npm test` for identity/marketplace/transaction/gateway returns 403/401 because the
suite presents `x-service-key: test-internal-key` to the *running compose* service, which is
gated on the real `INTERNAL_SERVICE_API_KEY`. That is by design (env-guard); the integration
harness spins up its own server with the test key.

### Pre-existing failure notes

- **identity (10)**: `registerSchema` now requires `hostelGroup` (`z.enum(['MH','LH'])`), but
  `tests/helpers.ts::registerUser()` posts only `hostelBlock`/`roomNumber` → 400 VALIDATION_ERROR
  cascades through auth + refresh-rotation suites.
- **marketplace (16)**: search/filter queries return `[]` (FTS/category/block filters), the offer
  state-machine suite, offer auto-expiry, sold-stats aggregation and the internal-SOLD key-guard
  test fail. Listing CRUD, hostel segregation, JWKS and identity-stub suites pass.

These are recorded so later failures are not mistaken for regressions introduced by this task.
