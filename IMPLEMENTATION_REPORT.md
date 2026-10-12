# IMPLEMENTATION_REPORT.md

Date: 2026-10-12 · Branch: `master` · Repo: Smart Hostel Marketplace (gateway + 5 Next.js
services + frontend + infra)

Scope of this task: (a) fix the `Listing not found` defect on `/listings/{id}`, (b) verify the
buyer/seller order lifecycle end to end, (c) re-run the automated suites + typechecks + build,
(d) review payment safety, security and deployment configuration. Only the files listed in
§11 were changed. No deployment, no secret rotation, no production data, no real payment.

**Status: P0 listing-details release gate PASS (§0).** Source was already correct in the previous
revision; the gate was closed by rebuilding and recreating **only** the two affected *local*
containers (`marketplace-service`, `frontend`) so the running app serves the fixed code. No remote
deployment, no `docker compose down`, no volume/data change, and the other seven services were left
running untouched.

---

## 0. P0 Listing Details Release Gate

**Gate status: PASS** — verified on the running local application at `http://localhost:3000` with
the real, currently-listed records below, after the fixed code was actually deployed into the
running containers (see “Why it was still broken after the first fix”).

### Why it was still broken after the first fix — the second, decisive root cause

The source fix was correct but **was not running**. `frontend/Dockerfile` builds a Next.js
**standalone production bundle** and the service is not bind-mounted, so `localhost:3000` was
still serving the image built at `2026-10-11T10:43Z`, ~8 h *before* the fix was written
(`2026-10-12T00:14Z`). Proof — the *deployed* client chunk
(`.next/static/chunks/159-*.js`) contained:

```js
request("/api/marketplace/listings/".concat(e),{schema:c.Tb})     // c.Tb === bare listingSchema
```

The running browser therefore still executed the pre-fix validation, and the owner kept seeing
“Listing not found”. This is an **artifact/rollout** failure layered on top of the code defect,
and it is why a source-level fix alone did not change what the browser showed.

### Verified root cause (both layers, evidence-backed)

| Layer | Evidence | Expected | Actual | Conclusion |
|---|---|---|---|---|
| Market list response | `GET /gw/api/marketplace/listings` → `{"listings":[…]}`, ids `d5d8d270…` / `590e6030…` | canonical ids | canonical ids | list is fine |
| Link / route param | `ListingHoverOverlay` → `/listings/${listing.id}`, `useParams().id` | same id | same id | route/param correct |
| Detail fetch | `GET /gw/api/marketplace/listings/:id` → `200`, keys `["listing"]` | `{ listing }` | `{ listing }` | API correct |
| Gateway / rewrite | `/gw/*` → `http://gateway:4000/*` | pass-through | pass-through | fine |
| Backend handler | `getListing(request, id)` returns the wrapped row | `{ listing }` | `{ listing }` | fine |
| Auth / tenant scope | 401 without a token; 404 cross-group both ways | gated | gated | isolated, not the cause |
| Database record | the clicked id exists and is `ACTIVE` | present | present | listing was never missing |
| **Response shape / error mapper** | bare `listingSchema.safeParse({listing:{…}})` → **false** | parse OK | fail → “not found” | **ROOT CAUSE** |
| **Deployed artifact** | deployed chunk `{schema:c.Tb}` (bare) | fixed build | stale build | **ROOT CAUSE (rollout)** |

Executed with the project's **own compiled** `frontend/lib/api/schemas.ts` against the live body:

```
live detail response keys : ["listing"]
OLD (deployed) schema     : REJECTED  -> page error branch -> "Listing not found"
NEW (fixed source) schema : ACCEPTED  -> renders the listing
parsed listing id/title   : d5d8d270-4cdd-45f3-820c-1cab0ef57ab5 | P0 MH Item 1791746428
```

### Records tested (non-secret record identifiers, currently `ACTIVE` in the running DB)

| Group | Canonical listing id | Result |
|---|---|---|
| **MH** | `d5d8d270-4cdd-45f3-820c-1cab0ef57ab5` | `200`, title/description/price `100.00`/quantity `30`/1 stored Cloudinary image |
| **LH** | `590e6030-b54a-449f-8a1a-104eb02172be` | `200`, same fields, resolved by an LH-resident session |

Sessions: fresh throw-away accounts registered per group (MH resident + LH resident + seller); no
existing/real user data was read or modified.

### Endpoint, statuses, fields (host/header values redacted)

- `GET /api/marketplace/listings/:id` via the browser's same-origin path `:3000/gw/…` → **200**,
  `content-type: application/json`, envelope keys `["listing"]`.
- Fields verified present and non-fabricated: `id`, `sellerId`, `title`, `description`, `category`,
  `condition`, `price`, `quantity`, `images[]`, `status`, `createdAt`, `updatedAt`.
- `GET /listings/:id` (page) → **200**; renders no listing data for a logged-out visitor.
- `GET /gw/api/marketplace/listings/:id` **without** a token → **401**.
- Invalid / absent ids → **404** distinct from operational failures; malformed body → **400**.

### Direct URL + hard refresh

The page derives the id exclusively from `useParams()` and refetches on mount, so a pasted URL /
hard reload resolves the listing with **no hidden state from the market card** (verified: `/listings/{id}`
returns 200 and the detail call is a plain `GET` on the URL's id). Caveat, documented project
decision (not a defect): sessions are **memory-only**, so a brand-new tab/hard refresh asks for
sign-in first and then lands on the correct listing.

### New-tab behaviour (gate B3)

“View details” is a real anchor built from the listing's canonical id — proven in the **served**
client chunk (`chunks/app/page-*.js`) after the rebuild:

```js
href:"/listings/".concat(l.id), target:"_blank", rel:"noopener noreferrer"
```

`l.id` is the same canonical id the detail API resolves (checked against the list response above),
so the new tab opens `/listings/{canonical-id}` and cannot reach back into the market tab
(`noopener`). Keyboard activation works because it is an `<a>`, not a click handler.

### Invalid-ID and error differentiation (after the fix, live)

| Case | Result |
|---|---|
| malformed id (`/listings/not-a-uuid`) | **404** (was a `500` exception leak from the stale container) |
| unknown uuid | **404** |
| no token | **401** |
| MH caller → LH listing / LH caller → MH listing | **404** both ways (tenant isolation, no existence leak) |
| malformed request body | **400** |
| network/5xx / timeout / malformed response | page shows “Could not load this listing” + **Try again**, never “not found” — verified by code path (`page.tsx` error mapping) and the `ApiError(500,'BAD_SHAPE')` throw in `client.ts`; **not** fault-injected live (doing so would mean breaking the running stack) |

### What was changed to close the gate

No source change was needed — the source was already correct and unchanged this session. The gate
was closed by deploying the existing fix into the two affected local images only:

```
docker compose -f infra/docker-compose.yml --env-file .env build frontend marketplace-service
docker compose -f infra/docker-compose.yml --env-file .env up -d --no-deps --force-recreate \
    marketplace-service frontend
```

(no `down`, no `-v`, no prune, no pull; postgres/redis and the other five services were **not**
touched or restarted). Post-deploy proof — the served bundle now contains the envelope wrapper:

```js
request("/api/marketplace/listings/".concat(e),{schema:r.Ryn({listing:s.Tb})})   // z.object({ listing: listingSchema })
```

### Changed files for this gate

**No source file changed in this session** — the code was already correct (the six changed files are
listed with rationale in §11). The only mutation was to two local Docker images/containers, so
`git status` for source is byte-identical to the pre-gate state.

### Regression guard

- **Server side (automated, passing):** `services/marketplace-service/tests/marketplace.test.ts`
  `describe('GET /api/listings/:id — detail envelope, both groups, honest errors')` asserts the
  envelope is exactly `['listing']` and carries the card's canonical id, both hostel groups, `401`
  anonymous, `404` unknown uuid, `404 NOT_FOUND` for a malformed id (also on the shared offer path),
  and `404` for buyers on a `DELETED` listing. A bare-listing body re-introduced into the serializer
  would fail the first assertion.
- **End-to-end (automated, passing):** `scripts/smoke-test.sh` §4b re-checks the same envelope, id,
  route presence and logged-out exposure through the browser's `/gw` path.
- **Honest gap:** the *client-side* half (parsing the envelope rather than the bare listing) is
  **not** covered by a unit test, because the `frontend` package has no test runner
  (no `test` script, no vitest/jsdom — §13.6). It is guarded instead by the server-contract tests
  and the live smoke checks. Adding vitest to `frontend` remains the recommended follow-up, and no
  assertion was weakened or removed to obtain a green result.

### Automated tests re-run in the final, deployed state

| Check | Command | Result |
|---|---|---|
| end-to-end smoke (live stack) | `bash scripts/smoke-test.sh` | **62 PASS / 0 FAIL / 1 BLOCKED**, exit 0 |
| marketplace-service suite (detail-contract regression guard) | `npm run test:integration` | **48/48 PASS**, exit 0 |
| frontend typecheck | `npx tsc --noEmit` | **exit 0** |

The formerly failing `malformed id -> 500` check is now **PASS**, exactly as predicted. The single
**BLOCKED** item is the live Razorpay payout (`escrow released (live payout succeeded)`) — no valid
test credentials / fund account.

### Runtime/browser/data prerequisites unavailable in this environment

- **No browser** is installed, so the click-through, the new-tab visual check, the responsive and
  keyboard/focus pass and the real Razorpay Checkout popup remain user-run. The gate was proven at
  the HTTP/contract layer through the exact path the browser uses, plus inspection of the *served*
  client bundle that executes the validation.
- Live payout/refund/order-create remain blocked (invalid Razorpay test key pair, empty
  `RAZORPAY_FUND_ACCOUNT_ID`).

**Release stance:** the listing-details release blocker is resolved and proven end-to-end at the
HTTP/contract level on the running app. The wider order/payment scope is unaffected by this gate;
its open items (stock reservation, provider refund, webhook reachability) are listed in §13.

---

## 1. Executive summary — root cause

**The listing existed and the API was correct. The frontend detail request parsed the wrong
response envelope, so the page never saw a listing.**

`GET /api/marketplace/listings/:id` returns `{ "listing": { … } }` (HTTP 200) — the same
envelope as the list route and the create/PATCH responses. The detail query validated the
response with the **bare listing schema**:

```ts
// frontend/lib/api/queries.ts (before)
queryFn: () => request(`/api/marketplace/listings/${id}`, { schema: listingSchema }),
```

`listingSchema` describes a listing object, not `{ listing }`, so `zod`'s `safeParse` failed,
`request()` threw `ApiError(500, 'BAD_SHAPE')`, React Query set `isError`, and the page rendered
its error branch for **every** listing in **both** hostel groups:

> Listing not found — It may have been sold, removed, or the link is wrong.

No 404 was ever returned by the backend. The not-found copy was simply shown for a
client-side shape-validation failure. Fix = validate the envelope
(`z.object({ listing: listingSchema })`).

Proof (live, on the running stack, through the browser's real path
`http://localhost:3000/gw/api/marketplace/listings/:id`):

| Step | Result |
|---|---|
| Detail request through `/gw` with a real JWT | `200` , body keys = `["listing"]` |
| Old client schema `listingSchema.safeParse(body)` | `false` ← **the defect** |
| Fixed schema `z.object({ listing: listingSchema }).safeParse(body)` | `true`, id/title/quantity parsed |

Two further defects were found while making the page actually render, both inside the same
feature:

1. **Rules-of-Hooks crash.** `const [activeImage] = React.useState(0)` was declared *after* the
   loading/error early returns, so the loading→loaded render switch changed the hook count
   ("rendered more hooks than during the previous render"). It was masked by bug #1 —
   the error branch always returned first. The state is now declared with the other hooks.
2. **`500` on a malformed id.** `GET /api/listings/not-a-uuid` passed the raw path segment to a
   `uuid` column → Postgres `invalid input syntax for type uuid` → `500 INTERNAL` + a logged
   exception. The shared row helpers now reject a non-UUID id, so every id-based marketplace
   route answers the normal `404 NOT_FOUND` (the same answer the cross-hostel path gives).

## 2. Affected components and why it happened

| Layer | Component | Role in the defect |
|---|---|---|
| Frontend | `frontend/lib/api/queries.ts` | Wrong response schema for the detail query → `BAD_SHAPE` for all listings |
| Frontend | `frontend/app/listings/[id]/page.tsx` | Reported that error as "Listing not found"; also had a hooks-order crash and no distinction between 404 / 403 / network |
| Frontend | `frontend/components/listings/listing-hover-overlay.tsx` | "View details" was a same-tab link with no `target`/`rel` |
| Marketing API | `services/marketplace-service/src/handlers.ts` | Row helpers passed unvalidated ids to Postgres → 500 on malformed ids |

Nothing was wrong with the identifiers, the gateway rewrite, the tenant filter, or the data: the
market card already passes `listing.id` (the canonical UUID) and the API resolves it correctly
for the caller's hostel group.

## 3. Data-flow map (market card → persistence)

```
listing-card.tsx / listing-hover-overlay.tsx
  listing.id (canonical UUID from the list DTO)
        │  <Link href="/listings/{id}" target="_blank" rel="noopener noreferrer">
        ▼
frontend/app/listings/[id]/page.tsx        (client component, RequireAuth-gated)
  useListing(id) → GET /gw/api/marketplace/listings/{id}
        │  next.config.mjs rewrite: /gw/:path* → http://gateway:4000/:path*
        ▼
gateway (4000)  resolveRoute → marketplace; JWT verified; original Authorization forwarded
  downstreamPath: /api/marketplace/listings/{id} → /api/listings/{id}
        ▼
marketplace-service (4002)
  app/api/listings/[id]/route.ts → routes/listings.ts getListing()
        getListingRow(id)  [uuid-shape guard → null → 404]
        status must be ACTIVE · hostelGroup(seller_block) === hostelGroup(JWT.hostelBlock) else 404
        ▼
  { listing: serializeListing(row) }      ← envelope the page now validates
        ▼
marketplace schema (listings: seller_id, seller_block, title, price, quantity, image_urls, status …)
```

## 4. Listing-detail behavior implemented

* Response is validated as `{ listing }`; the page renders `data.listing`.
* **Distinct states** instead of one generic message:
  * loading → skeleton (unchanged);
  * `400/404` → "Listing not found … may have been sold, removed, or the link is wrong" + **Back to
    market** (`/`) — the earlier button was labelled "Back to market" but actually re-fetched;
  * `401/403` → "This listing is not available to you" (another hostel market) + Back to market;
  * anything else (timeout, 5xx, bad shape, offline) → "Could not load this listing" + **Try again**
    (`refetch()`).
* `View details` opens `/listings/{id}` in a **new tab** with `rel="noopener noreferrer"`; it is a
  real anchor, so keyboard/middle-click/context-menu behavior is preserved.
* Meta line now shows the real available quantity (`listing.quantity`) next to category/condition/date.
* Public/private boundary preserved: seller identity comes from
  `GET /api/identity/users/:id/public` (name/block/room/verification only — no phone). Buyer
  delivery details are never on this page.

## 5. Order lifecycle (verified as implemented, not re-written)

The repo's existing model is **offer → seller accepts → escrow → PIN/QR handover → buyer receipt
(Yes/No) → payout**, implemented across marketplace-service and transaction-service. It was
verified end to end against the live stack (`scripts/smoke-test.sh`, §12) — no parallel API was
invented.

| Transition | Actor | Guard (all server-side) | Result |
|---|---|---|---|
| Offer PENDING → ACCEPTED | listing seller | owner, listing ACTIVE, offer PENDING | `ACCEPTED` (terminal); duplicate accept → `409 INVALID_TRANSITION` |
| Transaction create | buyer | offer ACCEPTED, one transaction per offer | `DEAL_CONFIRMED`; duplicate request returns the same order |
| `escrow/init` | buyer | amount bound server-side | Razorpay order (test mode) |
| `payment.captured` webhook | Razorpay | HMAC signature over raw bytes + event-id dedupe | `ESCROW_LOCKED` → `HANDOVER_PENDING` + PIN/QR |
| `startDelivery` | listing seller | offer ACCEPTED **and** escrow funded (`ESCROW_NOT_FUNDED` before) | `IN_DELIVERY` |
| `verify-handover` | seller | PIN/QR, 3 attempts then lock | `HANDOVER_VERIFIED` (no payout yet) |
| `buyerConfirm {received:true}` | **buyer only** (stranger/seller → 404) | order `IN_DELIVERY` **and** txn `HANDOVER_VERIFIED` | `DELIVERED` → settle path |
| `buyerConfirm {received:false}` | buyer | same | denial recorded; escrow stays locked, no payout, dispute URL returned |
| settle | system | source `BUYER_CONFIRM` or admin `MANUAL_VERIFY` only | listing SOLD → idempotent payout → `COMPLETED` |
| dispute resolve | admin (dual-auth above threshold) | `DISPUTED/ADMIN_REVIEW` | `RESOLVED`→`COMPLETED` (payout) or `REFUNDED` |
| replays (accept / txn create / yes / no / webhook) | — | idempotency keys, unique constraints, terminal states | no duplicate order, no double payout, no double refund row |

UI: `frontend/app/my-orders` + `components/orders/order-detail-dialog.tsx` drive the seller's
accept / reject / start-delivery and the buyer's Yes/No receipt answer.

### 5.1 Gaps found in the lifecycle (reported, NOT silently changed)

1. **No stock reservation on acceptance.** `acceptOffer` flips the offer to `ACCEPTED` and never
   touches `listings.quantity`; there is no `reserved` column. A listing with `quantity = 1` can
   therefore have several buyers' offers accepted, each able to fund escrow for the same unit;
   only one can be delivered. The prompt's invariant ("quantity 1 on stock 30 reserves exactly
   1 unit; no oversell under concurrent acceptance") is **not met** by the current model.
   *Recommended (not implemented):* add `reserved_quantity`/`sold_quantity` with
   `available = quantity - reserved - sold`, reserve inside `acceptOffer` with
   `SELECT … FOR UPDATE`, and release on reject/refund through the existing
   `x-internal-api-key` write path. Left un-implemented deliberately: a reservation without a
   release path (which needs a transaction→marketplace release call) would permanently lock stock
   after a refund, which is worse than the current state. **This is the one checklist item that is
   not satisfied.**
2. **Refunds are bookkeeping only.** `resolveDispute(resolution: 'REFUNDED')` transitions the
   transaction to `REFUNDED` but performs **no Razorpay refund call** ("no Razorpay refund call in
   test mode" in the code). So there is a refund *state*, not a tracked provider refund, and
   `Refund completed` cannot be claimed.
3. **Payment webhook is unreachable through the gateway** in this topology: `/api/transaction/*`
   is JWT-gated at the gateway, so a real Razorpay callback (no Bearer token) gets `401`
   (fail-closed). This is a pre-existing finding in the repo's own `docs/final-report.md` (§5.1)
   and needs a decision: add a signature-verified `authBypass` for the webhook path, or expose the
   webhook route to the service directly. Not changed here (security-boundary decision).

## 6. Data model / schema changes

**None.** No migration, no new table, no new column. The malformed-id fix is pure input
validation; the detail fix is client-side.

## 7. APIs / routes

No route was added or removed. Two behaviors changed:

| Route | Change |
|---|---|
| `GET /api/listings/:id` | unchanged contract (`{ listing }`); a non-UUID id now returns `404 NOT_FOUND` instead of `500 INTERNAL` |
| `GET /api/offers/:id`, and any other route using the shared row helpers | same class of malformed-id hardening (`404`, no exception leak) |

Authorization, tenant scope and status predicates are untouched (verified: JWT required, 404 for
cross-hostel, 404 for non-participants, 404 for non-ACTIVE).

## 8. Inventory / concurrency / idempotency — actual state

* **Inventory:** see §5.1 — no reservation, no atomic decrement, therefore oversell is possible.
  The system does *not* decrement by the listing's total quantity when a single unit is ordered
  (`offers.quantity` is per-offer and validated `<= listings.quantity`), so the "never decrement
  the whole stock" half of the invariant holds.
* **Duplicate order:** enforced — `transactions.offer_id UNIQUE` plus the offer state machine; the
  live suite proves a repeated create returns the same order and a repeated accept is `409`.
* **Concurrent acceptance:** the accept is a single conditional `UPDATE … WHERE status='PENDING'`,
  so two concurrent accepts cannot both win for one offer — but two *different* offers can both be
  accepted (see §5.1 item 1).
* **Payout/refund idempotency:** `handover_idempotency(transaction_id UNIQUE, key UNIQUE, status)`
  is written in the same DB transaction *before* the payout call; a `COMPLETED` row refuses a
  second payout. Webhooks dedupe on `webhook_events.event_id UNIQUE`.

## 9. Payment capability actually supported

* Integration is **Razorpay REST in test mode** (`RAZORPAY_API_BASE`, key id/secret, webhook
  secret). Live confirmations never rely on the checkout callback: `payment.captured` is verified
  server-side (HMAC over the raw body) and payment state is re-read from the DB.
* A client-side success callback cannot move an order: `buyerConfirm yes` requires the server-side
  `HANDOVER_VERIFIED` state, which requires a funded escrow.
* **"Escrow" is a held-settlement model implemented in this codebase, not a verified Razorpay
  Route/linked-account marketplace transfer.** No Route access, linked accounts, or fund account
  were verified in this task. `RAZORPAY_FUND_ACCOUNT_ID` is empty in the current `.env`, so
  payouts stay retriable by design and a live payout is **BLOCKED** (no live payout succeeded in
  any run). Do not describe this as legal escrow until a provider-supported transfer flow is
  confirmed.
* The test-mode key pair in the local `.env` was reported as *rejected by Razorpay* (HTTP 401) in
  `docs/final-report.md` → real provider calls (order create, refund, payout) cannot be exercised
  until a valid test key pair is supplied by the owner. All provider paths were therefore verified
  against the repo's own Razorpay stub in the transaction suite, and marked BLOCKED live.

## 10. Security/privacy safeguards in the touched paths

* Detail endpoint: JWT required (401 without), cross-hostel → 404 (no existence leak), non-ACTIVE
  → 404, malformed id → 404 (no exception leak / no 500 error detail).
* Page: no listing data is rendered to a logged-out visitor (asserted in the smoke test); the
  access-denied state does not reveal whether the listing exists.
* No seller phone/contact fields on the listing page; buyer delivery fields remain gated behind an
  accepted offer (`deliveryDetails` is seller-only, 404 for everyone else).
* No secrets added; no client-side secret introduced (the detail fix is schema-only).

## 11. Files changed (this task only)

| File | Change |
|---|---|
| `frontend/lib/api/queries.ts` | `useListing` now validates `{ listing }` (root-cause fix) |
| `frontend/app/listings/[id]/page.tsx` | hook-order fix; `data.listing`; distinct 400/404 vs 401/403 vs network states; "Try again" refetch; real quantity in the meta line |
| `frontend/components/listings/listing-hover-overlay.tsx` | "View details" opens `/listings/{id}` in a new tab with `rel="noopener noreferrer"` |
| `services/marketplace-service/src/handlers.ts` | UUID-shape guard in `getListingRow`/`getOfferRow` → 404 instead of a 500 exception leak |
| `services/marketplace-service/tests/marketplace.test.ts` | +5 regression tests for the detail contract, both hostel groups, honest errors (48/48 pass) |
| `scripts/smoke-test.sh` | new §4b end-to-end detail checks (MH + LH, isolation, envelope, 404 vs 500, page route, no SSR leak); LH resident fixture; fixed a variable name this section introduced (`PG` clobbered the Postgres container name) |

No unrelated file was intentionally changed; no formatting/codemod sweep was run.

## 12. Tests actually run (all on this machine, this session)

| Suite / check | Command | Result |
|---|---|---|
| marketplace integration | `npm run test:integration` | **48/48 PASS** (43 before + 5 new detail tests) |
| identity integration | `npm run test:integration` | **18/18 PASS** |
| transaction integration | `npm run test:integration` | **21/21 PASS** (one earlier run had 1 flaky failure: `release.test.ts R4` — `Job … could not be removed because it is locked by another worker`; a re-run was fully green — see §13) |
| gateway integration | `npm run test:integration` | **7/7 PASS** |
| communication unit | `npm test` | **20/20 PASS** |
| ai unit | `npm test` | **15/15 PASS** |
| typecheck ×7 apps | `npx tsc --noEmit` | **7/7 exit 0** |
| frontend build | `npm run build` | **exit 0**, `/listings/[id]` route present |
| end-to-end smoke (live stack) | `bash scripts/smoke-test.sh` | **62 PASS / 0 FAIL / 1 BLOCKED**, exit 0 — see §0 |
| client-schema vs live response | compiled `lib/api/schemas.ts`, parsed the live `/gw` body | old `false` → new `true` |

**The earlier smoke FAIL is resolved.** `malformed id -> 500` came from the running
`marketplace-service` container predating the source fix; after rebuilding and recreating **only**
`marketplace-service` and `frontend` (see §0) every smoke check passes, including that one.

**The BLOCKED check** is the live seller payout (`escrow released (live payout succeeded)`) — no
valid Razorpay test credentials / fund account, so the settlement path is proven against the
Razorpay stub only.

## 13. Limitations, known issues, follow-ups

1. No stock reservation (§5.1.1) — the only unmet acceptance item from the task checklist.
2. No provider refund call (§5.1.2) — `REFUNDED` is a local state.
3. Webhook not reachable through the gateway (401) until the owner chooses the auth-bypass or
   direct-exposure option (§5.1.3).
4. Live payout / real refund / real order-create verification is BLOCKED (no valid test keys,
   empty `RAZORPAY_FUND_ACCOUNT_ID`).
5. No browser is available in this environment, so the page was verified by (a) the real HTTP path
   the browser uses, (b) parsing the live response with the project's actual compiled schema, and
   (c) inspecting the **served** client bundle to confirm the running app executes the fixed
   validation. Browser-only items (visual responsive check, keyboard/focus pass, real Razorpay
   Checkout popup) remain user-run.
6. The frontend has **no test runner** (no `test` script, no vitest/jsdom in `package.json`), so
   the client-side envelope regression is guarded by the backend-contract tests + smoke checks
   rather than a frontend unit test. Adding vitest to `frontend` is a recommended follow-up.
7. Flaky test: `transaction-service/tests/release.test.ts` → `R4 job recovery` can fail when the
   BullMQ harness removes a job that its own worker just picked up ("locked by another worker").
   Observed once, not reproducible on re-run. Recommend seeding that job with a longer delay
   before removing it.
8. `docs/final-report.md` and other prior reports remain as written; this report supersedes them
   only for the items it covers.

## 14. Final git status summary

The working tree was already heavily dirty at the start of this task (the whole project is
uncommitted on top of a single initial commit). This task added/modified only the six files in
§11; `git status` also still shows the pre-existing uncommitted project, untracked session-log
artifacts and the previously deleted tracked files (`freebuff-chat-*.md`, `tillllnow`) — see the
security report for why those matter. Nothing was reverted, and no commit was created.
