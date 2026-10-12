# Phase 10 — auth gate, admin return, profile, purchases, order timeline, Cloudinary, tests

Everything below was executed against the running stack
(`docker compose -f infra/docker-compose.yml --env-file .env`). Commands and
results are reported verbatim; nothing is marked passing that was not run.

---

## A. Files changed, by module

### Access gate + navigation (frontend)

| Path | Change |
| --- | --- |
| `frontend/app/page.tsx` | Marketplace grid now wrapped in `RequireAuth`; hero/listings render only for an authenticated session. |
| `frontend/app/sell/new/page.tsx` | `SellNewPage` split into a `RequireAuth` wrapper + `SellNewInner`. |
| `frontend/app/listings/[id]/page.tsx` | Same split — a pasted listing URL now redirects to login. |
| `frontend/app/chat/[conversationId]/page.tsx` | Same split — conversations require a session. |
| `frontend/components/layout/site-header.tsx` | Rewritten: nav (Market/Dashboard/Orders/Sell), Purchases and Profile are **authenticated-only**; logged-out visitors get only Log in / Create account. Adds the **admin-only “Admin Console” return button** (`.role === "admin"` and not already on `/admin`). |
| `frontend/components/profile/profile-dialog.tsx` | **New.** Name, email, phone, hostel type/block, room, UPI + inline phone/UPI edit + Purchases shortcut. |
| `frontend/app/purchases/page.tsx` | Rewritten (see §Purchases). |
| `frontend/app/purchases/[id]/page.tsx` | Rewritten to render the shared order dialog (one detail implementation). |
| `frontend/app/my-orders/page.tsx` | Rewritten on the shared timeline/dialog. |

### Admin console

| Path | Change |
| --- | --- |
| `frontend/components/layout/site-header.tsx` | The admin-only return button (desktop + mobile menu) and an “Admin” marker while on the console. |
| `frontend/app/admin/page.tsx` | Unchanged behaviour (already had `AdminGate`, “View Market Grid”, disputes, audit). The return path it was missing now exists in the header. |

### Profile & phone (frontend + backend)

| Path | Change |
| --- | --- |
| `frontend/lib/api/queries.ts` | Added `useMyProfile()` (GET `/users/me`). |
| `frontend/lib/api/mutations.ts` | Added `useUpdateProfile()` (PATCH `/users/me`). |
| `frontend/lib/api/types.ts` | `SessionUser.phone`; purchase detail parties carry `phone`. |
| `frontend/lib/api/schemas.ts` | `meSchema` now has `phone`/`hostel_group`/`role`; purchase-detail parties carry `phone`. |
| `services/identity-service/db/schema.sql` | Additive `ALTER TABLE users ADD COLUMN IF NOT EXISTS phone text`. |
| `services/identity-service/src/app/api/users/me/route.ts` | `phone` in GET + PATCH (10–15 digits, optional `+`, spaces/dashes stripped, `''` ⇒ NULL); **UPI regex corrected** (see below). |
| `services/identity-service/src/routes/internal.ts` | Batch internal read returns `phone`. |
| `services/identity-service/src/routes/register.ts` | Same UPI regex correction as `/users/me`. |
| `services/transaction-service/src/identity.ts` | `UserSummary.phone`. |
| `services/transaction-service/src/app/api/fulfill/[offerId]/deliveryDetails/route.ts` | Seller-only delivery details now include the buyer’s phone. |

### Purchases & transaction history

| Path | Change |
| --- | --- |
| `frontend/app/purchases/page.tsx` | Today (browser-local day) by default with an All-history switch; All/Bought/Sold/Failed tabs; each row shows **item name, image, amount, real escrow status** and the perspective label; opens the shared dialog. |
| `services/transaction-service/src/routes/purchases.ts` | List now returns `listingTitle` + `imageUrl` (server-selected from marketplace) and `pagination.hasMore`; optional `from`/`to` ISO instants for the local-day filter; detail returns the parties’ `phone`. |
| `frontend/lib/api/queries.ts` | `usePurchases(role, range)`; `localDayRange()` computes the browser’s local day boundaries. |

### Order fulfilment & timeline

| Path | Change |
| --- | --- |
| `frontend/lib/orders.ts` | **New.** `deriveOrderView()` — the six stages, derived from offer + escrow + fulfilment state; role capabilities (buyer can confirm, seller can start delivery / must verify handover); truthful payout-pending flag. |
| `frontend/components/orders/order-detail-dialog.tsx` | **New.** The single order dialog (item, image, buyer, seller, status, timeline, actions, loading/error/missing-image states). |
| `frontend/components/orders/party-details.tsx` | **New.** Name + hostel/room/phone block. |
| `frontend/lib/api/mutations.ts` | Added `useConfirmReceipt()`; **removed `useDeliver`** (the seller could mark the order delivered — the receipt decision belongs to the buyer). |
| `frontend/lib/api/schemas.ts` | `fulfillmentSchema` gained `buyerReceived/buyerConfirmedAt/buyerDeclinedAt`; the entry now carries `role`, `offerStatus` and a nullable `fulfill`. |
| `services/transaction-service/db/schema.sql` | Additive `buyer_received`, `buyer_confirmed_at`, `buyer_declined_at` on `fulfilment_tracking`. |
| `services/transaction-service/src/state-machine.ts` | `FulfRequestRow` carries the receipt fields. |
| `services/transaction-service/src/release.ts` | New `markHandoverVerified()`; `settleTransaction()` gained the **buyer-receipt gate** and the `BUYER_CONFIRM` source; the 48 h auto-release now **escalates instead of paying** an unconfirmed order. |
| `services/transaction-service/src/routes/handover.ts` | `verify-handover` records `HANDOVER_VERIFIED` and **no longer pays out**; the payout moved behind the buyer’s answer. |
| `services/transaction-service/src/routes/buyer-confirm.ts` | **New.** `POST /api/fulfill/:offerId/buyerConfirm { received }` — buyer-only, requires an accepted offer and a handover-verified escrow; `true` ⇒ DELIVERED + settlement, `false` ⇒ recorded denial, escrow frozen, dispute path. |
| `services/transaction-service/src/routes/start-delivery.ts` | **New.** The single seller delivery-start path, now with the **escrow-funded precondition**. |
| `services/transaction-service/src/app/api/fulfill/[offerId]/buyerConfirm/route.ts` | **New** route entry. |
| `services/transaction-service/src/app/api/fulfill/[offerId]/route.ts` | GET returns the full transaction shape + `role`/`offerStatus`; POST delegates to `start-delivery`. |
| `services/transaction-service/src/app/api/fulfill/[offerId]/startDelivery/route.ts` | Delegates to `start-delivery` (no duplicate logic). |
| `services/transaction-service/src/app/api/fulfill/[offerId]/deliver/route.ts` | **Deleted** — it let the seller declare the buyer’s receipt. |

### Environment / Docker

| Path | Change |
| --- | --- |
| `services/transaction-service/db/schema.sql` | Enum guard is now scoped to `current_schema()` so the file can be applied into `transaction_test` (see §C). |
| `services/transaction-service/scripts/stub-marketplace.js` | Deterministic `…0008` listing fixture (SOLD write always fails). |
| `services/identity-service/tests/helpers.ts` | Registration fixture updated to the current hostel contract. |
| `docs/frontend-file-map.md` | **New** — the per-module frontend map. |
| `docs/phase10-report.md` | **New** — this report. |
| `scripts/smoke-test.sh` | **New** — the end-to-end smoke test (§D), documented in the README. |
| `README.md` | New “End-to-end smoke test (Phase 10)” section with the command and what it covers. |

No `.env`, `Dockerfile`, `next.config.mjs` or compose change was needed for
Cloudinary (see §B) — the pipeline was already correct, the image was stale.

### Tests

| Path | Change |
| --- | --- |
| `services/transaction-service/tests/setup.ts` | Added `setBuyerReceipt()` fixture. |
| `services/transaction-service/tests/integration.test.ts` | T1/T3/H1a updated to the two-step completion (handover verify → buyer confirms). |
| `services/transaction-service/tests/release.test.ts` | R1 now asserts the escalation; **R1b added** (completes once confirmed); R3/S1a/S1b use the receipt fixture; S1b no longer relies on the shared one-shot failure flag. |
| `services/marketplace-service/tests/marketplace.test.ts` | MH/LH-scoped fixtures corrected (see §C). |

---

## B. Cloudinary — root cause and fix

**The credentials were never the problem.**

Evidence, in order:

1. The configured cloud/preset are **valid**: a direct unsigned upload
   (`POST https://api.cloudinary.com/v1_1/<cloud>/image/upload` with
   `upload_preset=hostel_unsigned`) returns **HTTP 200** with a
   `secure_url` on `https://res.cloudinary.com`.
2. The **served client bundle contained neither value**:
   `grep -rl "dw0y2pyd4" .next/static` and the same for `hostel_unsigned`
   returned nothing. `lib/cloudinary.ts` therefore evaluated
   `cloudinaryConfigured() === false` and the upload zone showed
   “Cloudinary env vars not set — uploads disabled”.

**Cause: stale image + build-time inlining.** `NEXT_PUBLIC_*` values are baked
into the client bundle by `next build`. Compose passes them as build args
(`NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME: ${…:-}`), and that interpolation only
resolves when the build is run with the env file —
`docker compose -f infra/docker-compose.yml --env-file .env build frontend`.
The running image had been built without it, so both args were empty strings.
Restarting the container can never fix this: the values live in the bundle.

**Fix and verification**

- Rebuilt with `--env-file .env`; the served chunks now contain both the cloud
  name and the preset (`app/sell/new/page-*.js`, `chunks/159-*.js`).
- Confirmed **no `CLOUDINARY_API_KEY`/`CLOUDINARY_API_SECRET` anywhere in the
  client bundle**.
- End-to-end: unsigned upload → `secure_url` → listing created with that URL →
  `GET /api/transaction/purchases` and the order-details response both return
  the same `res.cloudinary.com` URL (smoke §4 and §8).
- `next.config.mjs` still restricts images to `res.cloudinary.com`, and no CSP
  was weakened.
- `.env.example` already documents the two public vars next to the private
  ones; no change was required.

---

## C. Test repair report

Commands: `npm run test:integration` in each package (each script starts the
service under test against the real compose Postgres/Redis plus stubs).
Frontend has no test script; it is covered by `npx tsc --noEmit` + `next build`.

| Suite | Command | Result |
| --- | --- | --- |
| gateway | `npm run test:integration` | **7 passed / 0 failed** |
| identity-service | `npm run test:integration` | **17 / 0** |
| marketplace-service | `npm run test:integration` | **42 / 0** |
| transaction-service | `npm run test:integration` | **20 / 0** |
| communication-service | `npm run test:integration` | **41 / 0** |
| ai-service | `npm run test:integration` | **35 / 0** |
| frontend | `npx tsc --noEmit` | clean |

Total: **162 tests passing, 0 failing, 0 skipped**.

### Failures found and fixed

1. **transaction `type "fulfilment_status" does not exist`** (Category C —
   broken setup). The harness applies `db/schema.sql` into `transaction_test`,
   but the enum guard checked `pg_type` database-wide, found the dev schema's
   type and skipped the `CREATE TYPE`, so the `CREATE TABLE` failed. Guard is
   now scoped with `n.oid = t.typnamespace AND n.nspname = current_schema()`.

2. **identity: every registration 400** (Category C — stale fixture). The
   helper still sent `hostelBlock: 'MH-A'` with no `hostelGroup`, both rejected
   by the current contract. Fixture now sends `hostelGroup: 'MH'`,
   `hostelBlock: 'MH-1'`. 10 tests fixed.

3. **marketplace: 16 failures** (Categories B and C).
   - The shared `buyerToken()` was an **LH-1** resident while every listing
     under test belonged to MH-1/MH-2 sellers, so search, filters, pagination
     and every offer assertion were querying an empty (cross-group) market.
     The default buyer is now MH, with explicit `lhBuyerToken()` /
     `lhSellerToken()` used where the boundary is the thing under test.
   - “MH buyer cannot offer on an LH listing” was passing an **MH** listing id,
     so it asserted 404 against a request that is legitimately 201. It now
     publishes a genuine LH listing, asserts the MH buyer gets 404 **and** that
     an LH resident gets 201 on the same listing.
   - Sold-stats asserted that an MH caller sees LH SOLD rows (the opposite of
     the product rule). It now seeds both groups and asserts each caller sees
     exactly its own (LH: sample 2, median 200; MH: sample 2, median 500), with
     ACTIVE rows excluded on both sides.

4. **transaction R1/R3/R4/S1a/S1b/T1/T3/H1a — 8 failures** (Category B —
   obsolete expectations). These encoded “verify-handover ⇒ COMPLETED + payout”.
   The product contract now requires the buyer’s own receipt confirmation, so:
   - T1/T3/H1a were updated to the real two-step flow (verify → `HANDOVER_VERIFIED`
     with `awaitingBuyerConfirmation`, then `buyerConfirm` → COMPLETED), and T3
     additionally asserts exactly **one** `handover_idempotency` row.
   - R1 was rewritten to assert the new, stronger guarantee: the 48 h timer
     **cannot** pay an unconfirmed order — it leaves the row `HANDOVER_VERIFIED`,
     writes `RELEASE_BLOCKED_BUYER_UNCONFIRMED` and creates no payout key.
   - **R1b was added** to prove the timer *does* complete the order once the
     buyer has confirmed.
   - R3/R4/S1a/S1b use the new `setBuyerReceipt()` fixture, because they test
     payout mechanics, not the receipt gate.

5. **S1b flakiness** (Category D). It used the stub’s global one-shot
   `_fail_next` flag, which the newly-added buyerConfirm flows in the parallel
   suite could steal. Replaced with a deterministic per-listing fixture
   (`…0008` always rejects the SOLD write) plus an explicit listing-id switch
   for the retry phase.

No assertion was deleted, no test skipped, no timeout raised, no type
suppression added, and no production validation was relaxed to make a fixture
pass. The two behaviours that changed on purpose are both now pinned by
stronger tests than before.

---

## D. Smoke-test result

Script: **`scripts/smoke-test.sh`** (checked in) — a fresh run against the live
stack through the gateway (`:4000`) and the frontend (`:3000`):

```bash
bash scripts/smoke-test.sh   # exits non-zero on any FAIL
```

```
46 passed, 0 failed, 1 blocked
```

Covered and passing:

- **Gate**: unauthenticated `GET /api/marketplace/listings` → 401; `/`,
  `/dashboard`, `/sell/new`, `/purchases`, `/my-orders`, `/transactions/<id>`
  serve **no protected content** while logged out (checked against the rendered
  HTML) and `/` serves the login/create-account gateway.
- **Auth**: registration + login for seller/buyer/admin; the admin token
  carries the server-signed `role: "admin"` claim.
- **Profile/phone**: `/users/me` exposes `phone`; PATCH stores it
  (`"98765 43210"` → `9876543210`); an invalid number is 400.
- **Cloudinary**: real unsigned upload → `secure_url` on `res.cloudinary.com`,
  persisted onto the published listing.
- **Order lifecycle**: offer → seller accepts (buyer sees it) → duplicate
  acceptance refused → escrow transaction created (duplicate request is a
  no-op) → **delivery refused before escrow funding** → seller starts delivery
  → buyer cannot confirm before delivery, and **cannot confirm before the
  PIN/QR handover is verified** → seller cannot answer on the buyer's behalf.
- **Receipt**: buyer “No” ⇒ not delivered, denial persisted, escrow stays
  locked, nothing paid; buyer “Yes” ⇒ DELIVERED + `buyerConfirmedAt`; repeating
  “Yes” is idempotent.
- **Purchases**: item **name** and **image** present in history, `hasMore`
  pagination, the same order visible as a SALE for the seller, order details
  include the other party and the image, and a third party gets 404.
- **Admin**: admin reads the audit log (200); a student is denied the audit log
  and the disputes queue (403).

**Blocked (not “passed”):** the live escrow capture and a real seller payout.
There is no reachable Razorpay checkout/webhook in this environment, so the
escrow-lock and PIN/QR handover steps were advanced with a controlled DB
fixture to exercise the new endpoint. The payout itself is reported
**PENDING** by the API and the UI — delivery confirmation and financial
settlement are kept distinct, and nothing claims money moved.

Note on method: no browser binary is available in this environment, so the
browser-level checks were executed as HTTP/SSR assertions on the actual served
pages plus full API end-to-end runs — not by driving Chrome.

---

## E. Acceptance checklist

| Requirement | Status | Evidence |
| --- | --- | --- |
| Login/register is the only public entry; protected URLs redirect | ✅ | smoke §1; `RequireAuth` on `/`, `/dashboard`, `/sell/new`, `/listings/[id]`, `/chat/*`, `/purchases`, `/purchases/[id]`, `/my-orders`, `/transactions/[id]`, `/admin*` |
| No protected-content flash while auth resolves | ✅ | `RequireAuth` renders the skeleton until authenticated; SSRs contain no marketplace content |
| Admin lands on `/admin` after login | ✅ | `login/page.tsx`: `isAdmin ? "/admin" : next` |
| Admin-only “return to console” button | ✅ | `site-header.tsx`, gated on the signed role claim; absent for students |
| Server-side admin authorization intact | ✅ | smoke §9 (403 for students); no role logic was moved client-side |
| Profile shows the user’s own details | ✅ | dialog reads `/users/me`; phone added end-to-end + verified |
| Profile has a Purchases shortcut | ✅ | same `/purchases` page as the top-right button |
| Purchases visible only when authenticated | ✅ | header nav renders Purchases only for an authenticated session |
| Today’s orders by default, history retained | ✅ | local-day `from`/`to` + All-history switch + `hasMore` paging |
| Bought / Sold / Failed labels with item name and status | ✅ | smoke §8; real escrow status shown alongside |
| Order-details dialog (buyer, seller, item, status, image) | ✅ | shared dialog; smoke §8 |
| Buyer timeline: Placed → Accepted → Escrow → Delivery → Awaiting confirmation → Delivered | ✅ | `lib/orders.ts` + `Stepper`, driven by backend state |
| Seller: accept → delivery details (name/hostel/room/phone) → deliver | ✅ | accept + `deliveryDetails` (phone now included) + `startDelivery` |
| Buyer confirms receipt Yes/No; Yes ⇒ delivered + payout, No ⇒ blocked | ✅ | smoke §7; transaction tests R1/R1b/T1/T3/H1a |
| PIN/QR handover still mandatory | ✅ | buyer’s “Yes” is refused with `HANDOVER_NOT_VERIFIED` before verification; 3-attempt lockout test still green |
| Auto-release cannot bypass buyer confirmation | ✅ | R1 (escalates) + R1b (completes only when confirmed) |
| Payout never falsely reported | ✅ | reports `payout: PENDING`; smoke marks the live payout BLOCKED |
| Cloudinary upload works end to end | ✅ | §B + smoke §4 |
| Stale tests repaired | ✅ | §C — 162/162 |
| Smoke test with real results | ✅ | §D — 46/0/1 |
| Existing design system & security preserved | ✅ | reused `Button/Card/Modal/Stepper/Badge`; no CSP/CORS/hostel-isolation relaxation |

---

## F. Known limitations and follow-ups

1. **Live payments are unverified.** Razorpay checkout, webhook capture and
   payout were never executed against the provider; only the stub path is
   proven. Treat escrow funding and payout as *BLOCKED* until a test-mode
   checkout is run by hand.
2. **Buyer silence now parks the order.** An order whose buyer never answers
   stays `HANDOVER_VERIFIED`; the 48 h timer audits
   `RELEASE_BLOCKED_BUYER_UNCONFIRMED` and stops. The intended exit is the
   existing dispute/admin resolution (admin `MANUAL_VERIFY` is the authorized
   override). If a product rule for “buyer unresponsive” is wanted, it belongs
   in the dispute workflow — deliberately not invented here.
3. **Two dead auth duplicates remain**: `lib/auth/authcontext.tsx` and
   `lib/auth/authcontext.ts` (nothing imports them; the live implementation is
   `auth-context.tsx`). Left in place rather than deleted unasked.
4. ~~`marketplace-service` needed one manual restart — pre-existing environment
   flakiness.~~ **Corrected: that was a real product bug, not flakiness.**
   See §G — every service's `pool` was a `get`-only Proxy that silently dropped
   pg-pool's internal writes, so a lost client could never be shed and the pool
   wedged permanently. Fixed and covered by a regression test.
5. **No browser binary** in this environment, so no click-through run; see §D.
6. `docs/frontend-file-map.md` documents which frontend files are safe to
   hand-edit and which are shared.

---

## G. Post-report fix — “Listing not found” / purchases impossible

**Symptom.** Clicking any item showed *“Listing not found”* and no purchase
could be started. Every listing read through the gateway returned
`500 {"error":"INTERNAL"}` after ~2 s.

**Evidence.**

- `GET /api/marketplace/listings` → 500; `GET /api/marketplace/listings/<id>` →
  500 (not 404 — the frontend renders its *not found* state for any error).
- `marketplace.listings` held 25 rows, the target listing was `ACTIVE`, and
  Postgres was healthy with 5 of 100 connections used.
- Service logs: `[marketplace:listListings] Error: timeout exceeded when trying
  to connect` (same for `createListing`).
- `pg_stat_activity` showed **zero** `marketplace_app` connections, so the pool
  was not merely out of clients on the server side.
- Later the same signature appeared in `identity-service`
  (`Error: timeout exceeded when trying to connect` on `POST /auth/login`,
  HTTP 500) — the outage class was systemic, not marketplace-specific.

**Root cause.** `src/db.ts` in all five services exported the pool as a Proxy
with **only a `get` trap**:

```ts
const pool = new Proxy({} as Pool, { get: (_, p) => getPool()[p] });
```

pg-pool mutates its own state with plain assignments — in `_remove()`:

```js
this._clients = this._clients.filter((c) => c !== client)
```

and `this.ending`/`this.ended` in `end()`. Call sites reach those methods with
the **proxy** as `this`, so the assignment was written to the throwaway `{}`
target and thrown away. The real `_clients` array therefore kept every dead
client forever, `_isFull()` (`this._clients.length >= max`) stayed permanently
`true`, `connect()` never called `newClient()`, and every request waited out
`connectionTimeoutMillis` before failing. A single lost client socket (Postgres
restart, idle socket death) wedged the service for good — and a restart was the
only cure, which is why it looked like environment flakiness during Phase 10.

**Fix.** Added the missing `set` trap in every service (`get` still forwards
reads):

```ts
set(_target, prop: string, value: unknown) {
  (getPool() as unknown as Record<string, unknown>)[prop] = value;
  return true;
},
```

**Changed files.**

| Path | Change |
| --- | --- |
| `services/marketplace-service/src/db.ts` | `set` trap + the reasoning behind it. |
| `services/identity-service/src/db.ts` | Same. |
| `services/transaction-service/src/db.ts` | Same. |
| `services/communication-service/src/db.ts` | Same. |
| `services/ai-service/src/db.ts` | Same. |
| `services/*/tests/db-pool.test.ts` (5 new) | Behavioral guard: writes through the proxy must land on the real pool. |

**Verification.**

- All five images rebuilt (`--env-file .env`) and restarted; 9/9 containers
  healthy.
- `GET /api/marketplace/listings?page=1&limit=3` → **200** with listings.
- `GET /api/marketplace/listings/5f803dc5-…` (the affected item) → **200** with
  its Cloudinary image.
- `POST /api/marketplace/offers` from a buyer on that listing → **201**, so the
  purchase path works. (Test offer deleted afterwards; the listing is back to
  zero offers.)
- Seller dashboard reads: `listings/mine`, `offers`, `transactions`,
  `notifications` → **200**.
- New guard passes (5/5) and was **mutation-verified**: removing the `set` trap
  again makes it fail (`expected undefined to be 'forwarded'`), so it is not a
  vacuous test.
- Full `scripts/smoke-test.sh` re-run on the rebuilt images: **46 passed,
  0 failed, 1 blocked** (the same live-payout blocker).
- All five integration suites re-run with the new guard file included, all exit
  0: marketplace **43** (was 42), transaction **21** (20), identity **18** (17),
  communication **42** (41), ai **36** (35) — the +1 in each is the guard. All
  five `npm run typecheck` runs are clean. The §C counts above are the
  pre-fix ones. Gateway is untouched (7 tests, unchanged).

Note for the remaining risk: the compose healthcheck only pings the service, so
a wedged pool still reports `healthy`. The invariant test is the guard against a
silent recurrence; a DB-touching healthcheck would be the belt-and-braces
follow-up.

**Not done:** no attempt to reconnect-in-place or auto-restart wedged services —
with the proxy fixed, pg-pool discards dead clients correctly, which is the
proper repair rather than a scheduled restart.
