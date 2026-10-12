import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { setup, teardown, PENDING_ID, STUB_500_ID, type TestHarness } from './setup';

// ---------------------------------------------------------------------------
// Integration tests — run against a live server (BASE_URL, default :4002) with
// a dedicated marketplace_test schema (TEST_DATABASE_URL points at Postgres).
// Tokens are real RS256 JWTs minted with the test key pair, mirroring exactly
// what identity-service issues at login.
// ---------------------------------------------------------------------------

let h: TestHarness;
beforeAll(async () => {
  h = await setup();
});
afterAll(async () => {
  await teardown();
});

const SELLER_ID = '11111111-1111-4111-8111-111111111111';
const SELLER2_ID = '44444444-4444-4444-8444-444444444444';
const BUYER_ID = '22222222-2222-4222-8222-222222222222';
const STRANGER_ID = '33333333-3333-4333-8333-333333333333';
const LH_SELLER_ID = '66666666-6666-4666-8666-666666666666';
const LH_BUYER_ID = '77777777-7777-4777-8777-777777777777';

// MH/LH segregation: a resident only ever sees listings from their OWN group's
// hostels, so a fixture's hostel block decides what it can reach. The default
// sellers here are MH-1/MH-2, which is why the default buyer is an MH resident
// too — the earlier `buyerToken` was LH-1 while every listing under test was
// MH, so search/filter/offer assertions were looking at an empty market. Tests
// that actually exercise the boundary use the explicit LH tokens below.
const sellerToken = () =>
  h.signToken({ sub: SELLER_ID, email: 'seller@college.edu', fullName: 'Seller One', hostelBlock: 'MH-1', roomNumber: '101', verificationStatus: 'VERIFIED' });
const seller2Token = () =>
  h.signToken({ sub: SELLER2_ID, email: 'seller2@college.edu', fullName: 'Seller Two', hostelBlock: 'MH-2', roomNumber: '202', verificationStatus: 'VERIFIED' });
const buyerToken = () =>
  h.signToken({ sub: BUYER_ID, email: 'buyer@college.edu', fullName: 'Buyer B', hostelBlock: 'MH-2', roomNumber: '303', verificationStatus: 'VERIFIED' });
const lhSellerToken = () =>
  h.signToken({ sub: LH_SELLER_ID, email: 'lhseller@college.edu', fullName: 'LH Seller', hostelBlock: 'LH-1', roomNumber: '707', verificationStatus: 'VERIFIED' });
const lhBuyerToken = () =>
  h.signToken({ sub: LH_BUYER_ID, email: 'lhbuyer@college.edu', fullName: 'LH Buyer', hostelBlock: 'LH-1', roomNumber: '808', verificationStatus: 'VERIFIED' });
const pendingToken = () =>
  h.signToken({ sub: PENDING_ID, email: 'pending@college.edu', fullName: 'Pending P', hostelBlock: 'LH-2', roomNumber: '404', verificationStatus: 'PENDING' });
const stub500Token = () =>
  h.signToken({ sub: STUB_500_ID, email: 'err@college.edu', fullName: 'Err E', hostelBlock: 'LH-3', roomNumber: '505', verificationStatus: null });

type Res = { status: number; json: any };

async function api(method: string, path: string, token?: string, body?: unknown): Promise<Res> {
  const res = await fetch(`${h.baseUrl}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      'x-service-key': process.env.TEST_SERVICE_KEY || 'test-internal-key',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

function listingBody(overrides: Record<string, unknown> = {}) {
  return {
    title: 'Gate Study Table',
    description: 'Solid wood study table, barely used',
    category: 'Furniture',
    condition: 'Good',
    price: '499.00',
    quantity: 1,
    images: ['https://res.cloudinary.com/demo/image/upload/sample.jpg'],
    ...overrides,
  };
}  async function createListing(token: string, overrides: Record<string, unknown> = {}) {
  const r = await api('POST', '/api/listings', token, listingBody(overrides));
  if (r.status !== 201) throw new Error(`createListing failed: ${r.status} ${JSON.stringify(r.json)}`);
  return r.json.listing;
}  async function createOffer(token: string, listingId: string, overrides: Record<string, unknown> = {}) {
  const r = await api(
    'POST',
    '/api/offers',
    token,
    { listingId, offeredPrice: '400.00', quantity: 1, ...overrides },
  );
  if (r.status === 201 || r.status === 409 || r.status === 400 || r.status === 404) return r;
  throw new Error(`createOffer unexpected status ${r.status}: ${JSON.stringify(r.json)}`);
}

// ---------------------------------------------------------------------------
// 1. Listings: create → edit → delete
// ---------------------------------------------------------------------------

describe('listings: create → edit → delete', () => {
  it('creates a listing as a VERIFIED seller (201)', async () => {
    const r = await api('POST', '/api/listings', sellerToken(), listingBody());
    expect(r.status).toBe(201);
    expect(r.json.listing).toMatchObject({
      title: 'Gate Study Table',
      category: 'Furniture',
      price: '499.00',
      status: 'ACTIVE',
    });
    expect(r.json.listing.images).toHaveLength(1);
  });

  it('rejects a PENDING seller (403 SELLER_NOT_VERIFIED)', async () => {
    const r = await api('POST', '/api/listings', pendingToken(), listingBody());
    expect(r.status).toBe(403);
    expect(r.json.error).toBe('SELLER_NOT_VERIFIED');
  });

  it('rejects missing and invalid tokens (401)', async () => {
    const noAuth = await api('POST', '/api/listings', undefined, listingBody());
    expect(noAuth.status).toBe(401);
    const badAuth = await api('POST', '/api/listings', 'not-a-jwt', listingBody());
    expect(badAuth.status).toBe(401);
  });

  it('validates the body with Zod (400 VALIDATION_ERROR)', async () => {
    const r = await api('POST', '/api/listings', sellerToken(), listingBody({ category: 'Cars' }));
    expect(r.status).toBe(400);
    expect(r.json.error).toBe('VALIDATION_ERROR');
  });

  it('edits own listing (PATCH owner-only)', async () => {
    const listing = await createListing(sellerToken(), { title: 'Old Chair' });
    const r = await api('PATCH', `/api/listings/${listing.id}`, sellerToken(), {
      price: '450.50',
      title: 'Comfy Chair',
    });
    expect(r.status).toBe(200);
    expect(r.json.listing).toMatchObject({ title: 'Comfy Chair', price: '450.50' });
  });

  it('forbids editing someone else’s listing (403)', async () => {
    const listing = await createListing(sellerToken());
    const r = await api('PATCH', `/api/listings/${listing.id}`, buyerToken(), { price: '1.00' });
    expect(r.status).toBe(403);
    expect(r.json.error).toBe('FORBIDDEN');
  });

  it('forbids deleting someone else’s listing (403)', async () => {
    const listing = await createListing(sellerToken());
    const r = await api('DELETE', `/api/listings/${listing.id}`, buyerToken());
    expect(r.status).toBe(403);
  });

  it('soft-deletes own listing; then GET → 404 and re-delete → 409', async () => {
    const listing = await createListing(sellerToken(), { title: 'Doomed Kettle' });
    const del = await api('DELETE', `/api/listings/${listing.id}`, sellerToken());
    expect(del.status).toBe(200);
    expect(del.json.deleted).toBe(true);

    const get = await api('GET', `/api/listings/${listing.id}`, buyerToken());
    expect(get.status).toBe(404);

    const again = await api('DELETE', `/api/listings/${listing.id}`, sellerToken());
    expect(again.status).toBe(409);
    expect(again.json.error).toBe('INVALID_STATE');
  });
});

// ---------------------------------------------------------------------------
// 2. Search: keyword (FTS), category, block-wise, pagination
// ---------------------------------------------------------------------------

describe('search & filters', () => {
  const kw = `claculator${Date.now()}`; // unique keyword for this run
  let mhAListingId: string;
  let mhBListingId: string;

  beforeAll(async () => {
    const a = await createListing(sellerToken(), {
      title: `Scientific ${kw} deluxe`,
      description: 'Engineering calculator with warranty',
      category: 'Electronics',
      price: '1200.00',
      quantity: 2,
    });
    mhAListingId = a.id;

    const b = await createListing(seller2Token(), {
      title: 'Wooden bookshelf',
      description: `Holds ${kw} books and decor`,
      category: 'Furniture',
      price: '899.00',
      quantity: 1,
    });
    mhBListingId = b.id;
  });

  it('matches keywords across title AND description via FTS', async () => {
    const byTitle = await api('GET', `/api/listings?q=${kw}&limit=50`, buyerToken());
    expect(byTitle.status).toBe(200);
    const ids = byTitle.json.listings.map((l: any) => l.id);
    expect(ids).toContain(mhAListingId); // keyword in title
    expect(ids).toContain(mhBListingId); // keyword in description
  });

  it('filters by category', async () => {
    const r = await api('GET', `/api/listings?category=Electronics&limit=50`, buyerToken());
    const ids = r.json.listings.map((l: any) => l.id);
    expect(ids).toContain(mhAListingId);
    expect(ids).not.toContain(mhBListingId);
  });

  it('enforces block-wise filtering (SRS 5.2.2)', async () => {
    const a = await api('GET', `/api/listings?block=MH-1&limit=50`, buyerToken());
    const idsA = a.json.listings.map((l: any) => l.id);
    expect(idsA).toContain(mhAListingId);
    expect(idsA).not.toContain(mhBListingId);

    const b = await api('GET', `/api/listings?block=MH-2&limit=50`, buyerToken());
    const idsB = b.json.listings.map((l: any) => l.id);
    expect(idsB).toContain(mhBListingId);
    expect(idsB).not.toContain(mhAListingId);
  });

  it('enforces MH/LH segregation: an LH resident cannot see MH listings (404)', async () => {
    // Cross-group reads are invisible even when the caller asks for the other
    // group's block explicitly (?block=MH-1 from an LH token, or vice versa).
    const a = await api('GET', `/api/listings?block=MH-1&limit=50`, lhBuyerToken());
    expect(a.status).toBe(200);
    expect(a.json.listings.map((l: any) => l.id)).not.toContain(mhAListingId);

    const detail = await api('GET', `/api/listings/${mhAListingId}`, lhBuyerToken());
    expect(detail.status).toBe(404);
  });

  it('enforces MH/LH segregation: an MH buyer cannot offer on an LH listing (404)', async () => {
    // The listing must actually be in the OTHER group for this to test anything:
    // an LH-1 seller publishes it, then an MH resident tries to buy it.
    const lhListing = await createListing(lhSellerToken(), {
      title: `LH-only kettle ${Date.now()}`,
      category: 'Appliances',
      price: '400.00',
    });

    const offer = await api('POST', '/api/offers', buyerToken(), {
      listingId: lhListing.id,
      offeredPrice: '400.00',
      quantity: 1,
    });
    // MH buyer offering on an LH listing must be treated as a non-existent resource.
    expect(offer.status).toBe(404);

    // Sanity: the LH resident CAN offer on it (the boundary is the group, not the listing).
    const allowed = await api('POST', '/api/offers', lhBuyerToken(), {
      listingId: lhListing.id,
      offeredPrice: '400.00',
      quantity: 1,
    });
    expect(allowed.status).toBe(201);
  });

  it('paginates deterministically', async () => {
    const tok = sellerToken();
    await createListing(tok, { title: `${kw} pen pack A`, category: 'Books', quantity: 5 });
    await createListing(tok, { title: `${kw} pen pack B`, category: 'Books', quantity: 5 });
    await createListing(tok, { title: `${kw} pen pack C`, category: 'Books', quantity: 5 });

    const p1 = await api('GET', `/api/listings?q=${kw}+pen&category=Books&page=1&limit=2`, buyerToken());
    expect(p1.json.listings).toHaveLength(2);
    expect(p1.json.pagination.total).toBe(3);

    const p2 = await api('GET', `/api/listings?q=${kw}+pen&category=Books&page=2&limit=2`, buyerToken());
    expect(p2.json.listings).toHaveLength(1);
  });

  it('rejects invalid query params (400)', async () => {
    const r = await api('GET', '/api/listings?category=Cars', buyerToken());
    expect(r.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Listing DETAIL by canonical id — the exact contract the frontend
// /listings/:id page consumes. Regression guard for the "Listing not found"
// defect: the page parses `{ listing: {...} }`, so the detail response must be
// that envelope (never a bare listing) carrying the SAME id the market card
// links to. Both hostel groups must resolve their own listings, and an id that
// cannot exist must be an honest 404 — not a 500 from a raw Postgres uuid cast.
// ---------------------------------------------------------------------------

describe('GET /api/listings/:id — detail envelope, both groups, honest errors', () => {
  it('returns the { listing } envelope with the card\'s canonical id (MH)', async () => {
    const created = await createListing(sellerToken(), { title: 'Detail Chair MK' });
    const r = await api('GET', `/api/listings/${created.id}`, buyerToken());
    expect(r.status).toBe(200);
    // The envelope is the contract: a bare listing body would break the page's
    // response schema and render "Listing not found" for every listing.
    expect(Object.keys(r.json)).toEqual(['listing']);
    expect(r.json.listing.id).toBe(created.id);
    expect(r.json.listing.title).toBe('Detail Chair MK');
    expect(r.json.listing.quantity).toBe(1);
    expect(r.json.listing.sellerId).toBe(SELLER_ID);
  });

  it('resolves an LH listing by the same id for its own group', async () => {
    const lh = await createListing(lhSellerToken(), { title: `LH detail lamp ${Date.now()}` });
    const own = await api('GET', `/api/listings/${lh.id}`, lhBuyerToken());
    expect(own.status).toBe(200);
    expect(own.json.listing.id).toBe(lh.id);

    // ...and the other group gets the same 404 as a listing that never existed.
    const cross = await api('GET', `/api/listings/${lh.id}`, buyerToken());
    expect(cross.status).toBe(404);
  });

  it('is JWT-gated (401) and 404s for an unknown uuid', async () => {
    const created = await createListing(sellerToken(), { title: 'Detail Guard Table' });
    const anon = await api('GET', `/api/listings/${created.id}`);
    expect(anon.status).toBe(401);

    const missing = await api(
      'GET',
      '/api/listings/00000000-0000-4000-8000-000000000000',
      buyerToken(),
    );
    expect(missing.status).toBe(404);
  });

  it('a malformed id is a 404 NOT_FOUND, never a 500 exception leak', async () => {
    const r = await api('GET', '/api/listings/not-a-uuid', buyerToken());
    expect(r.status).toBe(404);
    expect(r.json.error).toBe('NOT_FOUND');

    // Same class of bug on the offer detail path (shared row helper).
    const offer = await api('GET', '/api/offers/not-a-uuid', buyerToken());
    expect(offer.status).toBe(404);
  });

  it('a DELETED listing 404s for buyers but stays readable to its owner via /mine', async () => {
    const created = await createListing(sellerToken(), { title: 'Detail Deleted Fan' });
    const del = await api('DELETE', `/api/listings/${created.id}`, sellerToken());
    expect(del.status).toBe(200);

    const buyerView = await api('GET', `/api/listings/${created.id}`, buyerToken());
    expect(buyerView.status).toBe(404);

    const mine = await api('GET', '/api/listings/mine?limit=50', sellerToken());
    expect(mine.status).toBe(200);
    expect(
      mine.json.listings.find((l: any) => l.id === created.id)?.status,
    ).toBe('DELETED');
  });
});

// ---------------------------------------------------------------------------
// H2 closeout: GET /api/listings/mine — the caller's listings in ANY status
// ---------------------------------------------------------------------------

describe('H2: GET /api/listings/mine (any status, owner-scoped)', () => {
  it('rejects unauthenticated calls (401)', async () => {
    const r = await api('GET', '/api/listings/mine');
    expect(r.status).toBe(401);
  });

  it('returns ONLY the caller\'s listings in every status; other users\' rows never appear', async () => {
    const stamp = Date.now();
    const mineActive = await createListing(sellerToken(), { title: `Mine active ${stamp}` });
    const mineDeleted = await createListing(sellerToken(), { title: `Mine deleted ${stamp}` });
    const del = await api('DELETE', `/api/listings/${mineDeleted.id}`, sellerToken());
    expect(del.status).toBe(200);

    // A SOLD row for the caller, seeded directly (SOLD is written by
    // transaction-service settlement in real flows).
    const sep = h.appDbUrl.includes('?') ? '&' : '?';
    const client = new Client({ connectionString: `${h.appDbUrl}${sep}options=--search_path%3Dmarketplace_test` });
    await client.connect();
    try {
      await client.query(
        `INSERT INTO listings (seller_id, seller_block, title, category, condition, price, quantity, status)
         VALUES ($1, 'MH-1', $2, 'Books', 'Good', '123.00', 1, 'SOLD')`,
        [SELLER_ID, `Mine sold ${stamp}`],
      );
    } finally {
      await client.end();
    }

    // Another seller's rows (ACTIVE and DELETED) must never leak in.
    const otherActive = await createListing(seller2Token(), { title: `Other active ${stamp}` });
    const otherDeleted = await createListing(seller2Token(), { title: `Other deleted ${stamp}` });
    await api('DELETE', `/api/listings/${otherDeleted.id}`, seller2Token());

    const r = await api('GET', '/api/listings/mine?limit=50', sellerToken());
    expect(r.status).toBe(200);
    const ids = r.json.listings.map((l: { id: string }) => l.id);
    expect(ids).toContain(mineActive.id);
    expect(ids).toContain(mineDeleted.id); // DELETED visible to its owner
    expect(ids).not.toContain(otherActive.id);
    expect(ids).not.toContain(otherDeleted.id);
    expect(r.json.listings.every((l: { sellerId: string }) => l.sellerId === SELLER_ID)).toBe(true);

    const statuses = new Set(r.json.listings.map((l: { status: string }) => l.status));
    expect(statuses.has('ACTIVE')).toBe(true);
    expect(statuses.has('DELETED')).toBe(true);
    expect(statuses.has('SOLD')).toBe(true);

    // seller2's own view contains only their own rows.
    const r2 = await api('GET', '/api/listings/mine?limit=50', seller2Token());
    expect(r2.status).toBe(200);
    const ids2 = r2.json.listings.map((l: { id: string }) => l.id);
    expect(ids2).toContain(otherActive.id);
    expect(ids2).toContain(otherDeleted.id);
    expect(ids2).not.toContain(mineActive.id);
    expect(r2.json.listings.every((l: { sellerId: string }) => l.sellerId === SELLER2_ID)).toBe(true);
  });

  it('paginates with non-overlapping pages', async () => {
    const tok = sellerToken();
    const stamp = Date.now();
    await createListing(tok, { title: `MinePageA ${stamp}` });
    await createListing(tok, { title: `MinePageB ${stamp}` });

    const p1 = await api('GET', '/api/listings/mine?page=1&limit=2', tok);
    expect(p1.status).toBe(200);
    expect(p1.json.listings.length).toBeLessThanOrEqual(2);
    expect(p1.json.pagination).toMatchObject({ page: 1, limit: 2 });
    expect(p1.json.pagination.total).toBeGreaterThanOrEqual(2);

    if (p1.json.pagination.totalPages > 1) {
      const p2 = await api('GET', '/api/listings/mine?page=2&limit=2', tok);
      expect(p2.status).toBe(200);
      expect(p2.json.pagination.page).toBe(2);
      const ids1 = p1.json.listings.map((l: { id: string }) => l.id);
      const ids2 = p2.json.listings.map((l: { id: string }) => l.id);
      expect(ids1.some((id: string) => ids2.includes(id))).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// 3a/3b: JWKS auth negatives + VERIFIED enforcement via stub identity
// ---------------------------------------------------------------------------

describe('auth: JWKS + issuer/audience/alg', () => {
  it('rejects a token signed by an unknown key (kid not in JWKS, bad signature)', async () => {
    // /api/listings/:id requires auth (the LIST endpoint is public by design).
    const r = await api('GET', '/api/listings/99999999-9999-4999-8999-999999999999', 'garbage.token.value');
    expect(r.status).toBe(401);
  });

  it('rejects HS256 alg-confusion tokens', async () => {
    const jwt = (await import('jsonwebtoken')).default;
    const forged = jwt.sign({ sub: SELLER_ID }, 'secret', { algorithm: 'HS256' });
    const r = await api('GET', '/api/listings/99999999-9999-4999-8999-999999999999', forged);
    expect(r.status).toBe(401);
  });
});

describe('VERIFIED enforcement (stub identity)', () => {
  it('VERIFIED seller -> 201', async () => {
    const r = await api('POST', '/api/listings', sellerToken(), listingBody());
    expect(r.status).toBe(201);
  });

  it('PENDING seller -> 403 SELLER_NOT_VERIFIED', async () => {
    const r = await api('POST', '/api/listings', pendingToken(), listingBody());
    expect(r.status).toBe(403);
    expect(r.json.error).toBe('SELLER_NOT_VERIFIED');
  });

  it('identity error (500) -> 503 IDENTITY_UNAVAILABLE (fail closed)', async () => {
    const r = await api('POST', '/api/listings', stub500Token(), listingBody());
    expect(r.status).toBe(503);
    expect(r.json.error).toBe('IDENTITY_UNAVAILABLE');
  });
});

// ---------------------------------------------------------------------------
// 3. Offer negotiation state machine
// ---------------------------------------------------------------------------

describe('offer state machine', () => {
  let listingId: string;

  beforeAll(async () => {
    const listing = await createListing(sellerToken(), {
      title: `Negotiable desk lamp ${Date.now()}`,
      category: 'Electronics',
      price: '800.00',
      quantity: 3,
    });
    listingId = listing.id;
  });

  it('lets a buyer propose an offer on an ACTIVE listing (201)', async () => {
    const r = await createOffer(buyerToken(), listingId);
    expect(r.status).toBe(201);
    expect(r.json.offer).toMatchObject({ status: 'PENDING', offeredPrice: '400.00' });
  });

  it('rejects offers on own listing (409), over stock (400) and dead listings (404)', async () => {
    const own = await createOffer(sellerToken(), listingId);
    expect(own.status).toBe(409);
    expect(own.json.error).toBe('OWN_LISTING');

    const over = await createOffer(buyerToken(), listingId, { quantity: 99 });
    expect(over.status).toBe(400);
    expect(over.json.error).toBe('QUANTITY_EXCEEDS_STOCK');

    const ghost = await createOffer(buyerToken(), '99999999-9999-4999-8999-999999999999');
    expect(ghost.status).toBe(404);
  });

  it('ACCEPT: seller-only, PENDING → ACCEPTED (terminal deal confirmation)', async () => {
    const offer = (await createOffer(buyerToken(), listingId)).json.offer;

    const notSeller = await api('PATCH', `/api/offers/${offer.id}/accept`, buyerToken());
    expect(notSeller.status).toBe(403);
    expect(notSeller.json.error).toBe('FORBIDDEN');

    const ok = await api('PATCH', `/api/offers/${offer.id}/accept`, sellerToken());
    expect(ok.status).toBe(200);
    expect(ok.json.offer.status).toBe('ACCEPTED');

    // This GET is exactly what transaction-service calls to confirm a deal.
    const verify = await api('GET', `/api/offers/${offer.id}`, buyerToken());
    expect(verify.status).toBe(200);
    expect(verify.json.offer.status).toBe('ACCEPTED');
  });

  it('REJECT after ACCEPT → 409 INVALID_TRANSITION (terminal states are final)', async () => {
    const offer = (await createOffer(buyerToken(), listingId)).json.offer;
    const acc = await api('PATCH', `/api/offers/${offer.id}/accept`, sellerToken());
    expect(acc.status).toBe(200);

    const rej = await api('PATCH', `/api/offers/${offer.id}/reject`, sellerToken());
    expect(rej.status).toBe(409);
    expect(rej.json.error).toBe('INVALID_TRANSITION');

    const reAcc = await api('PATCH', `/api/offers/${offer.id}/accept`, sellerToken());
    expect(reAcc.status).toBe(409);
  });

  it('REJECT: PENDING → REJECTED; afterwards accept/withdraw also 409', async () => {
    const offer = (await createOffer(buyerToken(), listingId)).json.offer;

    const ok = await api('PATCH', `/api/offers/${offer.id}/reject`, sellerToken());
    expect(ok.status).toBe(200);
    expect(ok.json.offer.status).toBe('REJECTED');

    const lateAccept = await api('PATCH', `/api/offers/${offer.id}/accept`, sellerToken());
    expect(lateAccept.status).toBe(409);
    const lateWithdraw = await api('PATCH', `/api/offers/${offer.id}/withdraw`, buyerToken());
    expect(lateWithdraw.status).toBe(409);
  });

  it('COUNTER: finalises parent as COUNTERED and creates a child PENDING offer', async () => {
    const parent = (await createOffer(buyerToken(), listingId)).json.offer;

    const bad = await api('PATCH', `/api/offers/${parent.id}/counter`, buyerToken());
    expect(bad.status).toBe(403);

    const ok = await api(
      'PATCH',
      `/api/offers/${parent.id}/counter`,
      sellerToken(),
      { offeredPrice: '650.00', quantity: 2 },
    );
    expect(ok.status).toBe(201);
    expect(ok.json.offer.status).toBe('PENDING');
    expect(ok.json.offer.counterOf).toBe(parent.id);
    expect(ok.json.offer.offeredPrice).toBe('650.00');

    const parentAfter = await api('GET', `/api/offers/${parent.id}`, sellerToken());
    expect(parentAfter.json.offer.status).toBe('COUNTERED');
  });

  it('WITHDRAW: buyer-only, PENDING → WITHDRAWN (then final)', async () => {
    const offer = (await createOffer(buyerToken(), listingId)).json.offer;

    const notBuyer = await api('PATCH', `/api/offers/${offer.id}/withdraw`, sellerToken());
    expect(notBuyer.status).toBe(403);

    const ok = await api('PATCH', `/api/offers/${offer.id}/withdraw`, buyerToken());
    expect(ok.status).toBe(200);
    expect(ok.json.offer.status).toBe('WITHDRAWN');

    const again = await api('PATCH', `/api/offers/${offer.id}/withdraw`, buyerToken());
    expect(again.status).toBe(409);
  });

  it('hides offers from unrelated users (404, no existence leak)', async () => {
    const offer = (await createOffer(buyerToken(), listingId)).json.offer;
    const stranger = await api('GET', `/api/offers/${offer.id}`, pendingToken());
    expect(stranger.status).toBe(404);
    const buyer = await api('GET', `/api/offers/${offer.id}`, buyerToken());
    expect(buyer.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// 4. 48h auto-expire
// ---------------------------------------------------------------------------

describe('offer auto-expiry (48h cron, JWT-protected per Q5)', () => {
  it('rejects unauthenticated calls (401)', async () => {
    const r = await api('POST', '/api/offers/expire');
    expect(r.status).toBe(401);
  });

  it('EXPIRES PENDING offers older than the TTL and is idempotent (authorized)', async () => {
    const listing = await createListing(sellerToken(), { title: `Cron item ${Date.now()}` });

    // Backdate one offer directly in the DB (as the cron scenario requires).
    const old = await createOffer(buyerToken(), listing.id);
    const fresh = await createOffer(buyerToken(), listing.id);
    const sep = h.appDbUrl.includes('?') ? '&' : '?';
const client = new Client({ connectionString: `${h.appDbUrl}${sep}options=--search_path%3Dmarketplace_test` });
    await client.connect();
    try {
      await client.query(`UPDATE offers SET created_at = now() - interval '49 hours' WHERE id = $1`, [old.json.offer.id]);
    } finally {
      await client.end();
    }

    const run = await api('POST', '/api/offers/expire', buyerToken());
    expect(run.status).toBe(200);
    expect(run.json.expired).toBeGreaterThanOrEqual(1);

    const afterOld = await api('GET', `/api/offers/${old.json.offer.id}`, buyerToken());
    expect(afterOld.json.offer.status).toBe('EXPIRED');

    const afterFresh = await api('GET', `/api/offers/${fresh.json.offer.id}`, buyerToken());
    expect(afterFresh.json.offer.status).toBe('PENDING');

    // Idempotent: nothing left to expire.
    const rerun = await api('POST', '/api/offers/expire', buyerToken());
    expect(rerun.json.expired).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Sold stats (Phase 5 — ai-service consumes these aggregates)
// ---------------------------------------------------------------------------

describe('sold stats (Phase 5)', () => {
  it('rejects unauthenticated calls (401)', async () => {
    const { status } = await api('GET', '/api/stats/sold');
    expect(status).toBe(401);
  });

  it('rejects invalid category/condition (400)', async () => {
    const { status } = await api('GET', '/api/stats/sold?category=Cars', sellerToken());
    expect(status).toBe(400);
  });

  it('aggregates medians over SOLD rows only (sampleSize + p25/median/p75)', async () => {
    // No phase transitions listings to SOLD yet (transaction-service comes
    // later), so seed SOLD fixtures directly in the test schema — same
    // direct-DB technique the expiry test uses. 100 + 300 -> median 200.
    // An ACTIVE listing at 999 must NOT influence the aggregates.
    const sep = h.appDbUrl.includes('?') ? '&' : '?';
    const client = new Client({ connectionString: `${h.appDbUrl}${sep}options=--search_path%3Dmarketplace_test` });
    await client.connect();
    try {
      await client.query(
        `INSERT INTO listings (seller_id, seller_block, title, category, condition, price, quantity, status)
         VALUES ($1,'LH-2','Sold Mixer 1','Appliances','Good',100,1,'SOLD'),
                ($1,'LH-2','Sold Mixer 2','Appliances','Good',300,1,'SOLD'),
                ($1,'LH-1','Active Mixer','Appliances','Good',999,1,'ACTIVE')`,
        [LH_SELLER_ID],
      );
    } finally {
      await client.end();
    }

    // A matching MH pair, so the group boundary can be asserted from both
    // sides (400 + 600 -> median 500): the aggregates are scoped to the
    // caller's own group and never mix the two markets.
    const sepMh = h.appDbUrl.includes('?') ? '&' : '?';
    const clientMh = new Client({ connectionString: `${h.appDbUrl}${sepMh}options=--search_path%3Dmarketplace_test` });
    await clientMh.connect();
    try {
      await clientMh.query(
        `INSERT INTO listings (seller_id, seller_block, title, category, condition, price, quantity, status)
         VALUES ($1,'MH-2','Sold Mixer 3','Appliances','Good',400,1,'SOLD'),
                ($1,'MH-2','Sold Mixer 4','Appliances','Good',600,1,'SOLD'),
                ($1,'MH-1','Active Mixer 2','Appliances','Good',1200,1,'ACTIVE')`,
        [SELLER2_ID],
      );
    } finally {
      await clientMh.end();
    }

    // LH resident sees ONLY the LH-2 SOLD rows.
    const lhStats = await api('GET', '/api/stats/sold?category=Appliances&condition=Good', lhBuyerToken());
    expect(lhStats.status).toBe(200);
    expect(lhStats.json.stats.sampleSize).toBe(2);
    expect(lhStats.json.stats.median).toBe(200);
    expect(lhStats.json.stats.p25).toBe(150);
    expect(lhStats.json.stats.p75).toBe(250);

    // MH resident sees ONLY the MH SOLD rows — the LH rows and the ACTIVE rows
    // on either side are excluded.
    const { status, json } = await api('GET', '/api/stats/sold?category=Appliances&condition=Good', buyerToken());
    expect(status).toBe(200);
    expect(json.stats.sampleSize).toBe(2);
    expect(json.stats.median).toBe(500);
    expect(json.stats.p25).toBe(450);
    expect(json.stats.p75).toBe(550);
  });

  it('returns nulls + sampleSize 0 when no SOLD history matches', async () => {
    const { status, json } = await api('GET', '/api/stats/sold?category=Food&condition=Worn', sellerToken());
    expect(status).toBe(200);
    expect(json.stats.sampleSize).toBe(0);
    expect(json.stats.median).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Audit Step 1 (N1 fix, user decisions Q1+Q2): the internal listing-SOLD
// endpoint consumed by transaction-service before payout. Guarded ONLY by the
// shared internal API key (x-internal-api-key) — never a user JWT. After a
// SOLD flip the listing disappears from search, GET-by-id 404s, and new
// offers are rejected (N1's second-buyer scenario is closed).
// ---------------------------------------------------------------------------
describe('audit step 1: internal listing-SOLD endpoint (N1+Q1)', () => {
  const INTERNAL_KEY = process.env.TEST_INTERNAL_KEY || 'test-internal-key';

  async function internalApi(method: string, path: string, key?: string, body?: unknown): Promise<Res> {
    const res = await fetch(`${h.baseUrl}${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        'x-service-key': process.env.TEST_SERVICE_KEY || 'test-internal-key',
        ...(key !== undefined ? { 'x-internal-api-key': key } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = (await res.json().catch(() => ({}))) as any;
    return { status: res.status, json };
  }

  it('rejects a missing or wrong internal key (401) and an unconfigured guard never silently opens', async () => {
    const listing = await createListing(sellerToken());
    const noKey = await internalApi('PATCH', `/api/internal/listings/${listing.id}/status`, undefined, { status: 'SOLD' });
    expect(noKey.status).toBe(401);
    const badKey = await internalApi('PATCH', `/api/internal/listings/${listing.id}/status`, 'wrong-key-value', { status: 'SOLD' });
    expect(badKey.status).toBe(401);
    const { status, json } = await api('GET', `/api/listings/${listing.id}`, buyerToken());
    expect(status).toBe(200); // untouched — still ACTIVE
    void json;
  });

  it('rejects an end-user JWT as a credential for the internal write (401)', async () => {
    const listing = await createListing(sellerToken());
    const res = await fetch(`${h.baseUrl}/api/internal/listings/${listing.id}/status`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', 'x-service-key': process.env.TEST_SERVICE_KEY || 'test-internal-key', authorization: `Bearer ${sellerToken()}` },
      body: JSON.stringify({ status: 'SOLD' }),
    });
    // A user JWT is NOT the internal key: must be rejected even though the
    // guard also accepts the key via Bearer for operator convenience.
    expect(res.status).toBe(401);
  });

  it('validates the body: only status=SOLD is accepted (400)', async () => {
    const listing = await createListing(sellerToken());
    const res = await internalApi('PATCH', `/api/internal/listings/${listing.id}/status`, INTERNAL_KEY, { status: 'DELETED' });
    expect(res.status).toBe(400);
  });

  it('flips ACTIVE → SOLD with the correct key; listing then vanishes from search/GET and rejects new offers (N1 second-buyer scenario closed)', async () => {
    const listing = await createListing(sellerToken());

    const ok = await internalApi('PATCH', `/api/internal/listings/${listing.id}/status`, INTERNAL_KEY, { status: 'SOLD' });
    expect(ok.status).toBe(200);
    expect(ok.json.listing.status).toBe('SOLD');

    // N1 regression: no longer ACTIVE → not searchable, not GET-able.
    const search = await api('GET', `/api/listings?q=${encodeURIComponent('Gate Study Table')}`, buyerToken());
    expect(search.status).toBe(200);
    expect(search.json.listings.some((l: { id: string }) => l.id === listing.id)).toBe(false);
    const gone = await api('GET', `/api/listings/${listing.id}`, buyerToken());
    expect(gone.status).toBe(404);

    // N1 second-buyer scenario: offer creation AND acceptance must now fail.
    const offer = await createOffer(buyerToken(), listing.id);
    expect(offer.status).toBe(404); // offers on non-ACTIVE listings are not found/allowed

    // Idempotent: a second SOLD call is a 200 no-op, not an error.
    const again = await internalApi('PATCH', `/api/internal/listings/${listing.id}/status`, INTERNAL_KEY, { status: 'SOLD' });
    expect(again.status).toBe(200);
    expect(again.json.alreadySold).toBe(true);
  });

  it('409s when the listing is not ACTIVE (e.g. soft-deleted) — Q2 hard-failure path', async () => {
    const listing = await createListing(sellerToken());
    const del = await api('DELETE', `/api/listings/${listing.id}`, sellerToken());
    expect(del.status).toBe(200);
    const res = await internalApi('PATCH', `/api/internal/listings/${listing.id}/status`, INTERNAL_KEY, { status: 'SOLD' });
    expect(res.status).toBe(409);
  });
});

// teardown runs via afterAll above
void teardown;
