import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  api,
  BUYER_ID,
  fetchTxnRow,
  offerId,
  poolQuery,
  setup,
  SELLER_ID,
  teardown,
  TestHarness,
  tokenFor,
} from './setup';

// ---------------------------------------------------------------------------
// SIMULATION MODE (project demonstration task) — end-to-end integration tests.
//
// These drive one demo order through the REAL APIs, in order:
//   create -> demo/fund (replaces the payment.captured webhook)
//          -> buyer reads the handover credential
//          -> seller verifies the PIN (real attempt-limit rules)
//          -> buyer confirms receipt
//          -> COMPLETED with a SIMULATED payout id
// No provider is contacted anywhere: the Razorpay stub is never called by the
// demo path, and the payout id is `demo_payout_…`, never a Razorpay id.
// ---------------------------------------------------------------------------

let h: TestHarness;

beforeAll(async () => {
  h = await setup();
});

afterAll(async () => {
  await teardown();
});

async function createOrder() {
  const created = await api(h.baseUrl, 'POST', '/api/transactions', {
    token: tokenFor(h, 'buyer'),
    body: { offerId: offerId('ACCEPTED') },
  });
  expect(created.status).toBe(201);
  const txn = created.json.transaction;
  return { txnId: txn.id as string, offerId: txn.offerId as string };
}

describe('SIMULATION MODE — demo adapter', () => {
  it('refuses a seller and a stranger for this route while keeping the order sealed', async () => {
    const { txnId } = await createOrder();

    // Only the buyer can admit this route did anything meaningful; a seller gets
    // the same 404 an absent endpoint would give (the route mentions nothing
    // outside the buyer). 403 for seller/other is also acceptable — the point
    // is deny + no leak and the call must never change the row.
    const sellerFund = await api(h.baseUrl, 'POST', `/api/transactions/${txnId}/demo/fund`, {
      token: tokenFor(h, 'seller'),
      body: { demo: true },
    });
    expect(sellerFund.status).toBe(403);
    expect(sellerFund.json.error).toBe('FORBIDDEN');
    const strangerFund = await api(h.baseUrl, 'POST', `/api/transactions/${txnId}/demo/fund`, {
      token: tokenFor(h, 'other'),
      body: { demo: true },
    });
    expect(strangerFund.status).toBe(404);
    const anonymous = await api(h.baseUrl, 'POST', `/api/transactions/${txnId}/demo/fund`, {
      body: { demo: true },
    });
    expect(anonymous.status).toBe(401);

    // Verify the order status remained untouched by the seller attempt and never
    // got a simulated payout.
    const stillFreshRow = await fetchTxnRow(h.appDbUrl, txnId);
    expect(stillFreshRow.status).toBe('DEAL_CONFIRMED');
    expect(stillFreshRow.demo).toBe(false);
    expect(stillFreshRow.payout_id).toBeNull();
  });

  it('runs the whole order lifecycle with no payment provider and marks every money step simulated', async () => {
    const { txnId, offerId: offer } = await createOrder();

    // 1. Fund — replaces the webhook's payment.captured step.
    const fund = await api(h.baseUrl, 'POST', `/api/transactions/${txnId}/demo/fund`, {
      token: tokenFor(h, 'buyer'),
      body: { demo: true },
    });
    expect(fund.status).toBe(200);
    expect(fund.json.transaction.status).toBe('HANDOVER_PENDING');
    expect(fund.json.transaction.demo).toBe(true);
    expect(fund.json.simulated).toBe(true);
    expect(fund.json.transaction.razorpayOrderId).toBeNull();

    // 2. The buyer can now read a REAL handover credential (same route, same
    //    validation as a provider-funded order) — the PIN exists because the
    //    demo adapter generated it with the normal PIN/QR helpers.
    const cred = await api(h.baseUrl, 'GET', `/api/transactions/${txnId}/handover-credential`, {
      token: tokenFor(h, 'buyer'),
    });
    expect(cred.status).toBe(200);
    const pin: string = cred.json.credential.pin;
    expect(pin).toMatch(/^\d{4}$/);
    expect(cred.json.credential.qr).toContain('txn://');

    // 3. Seller verifies the PIN through the normal verification route
    //    (attempt accounting, audit rows and state machine all untouched).
    const verify = await api(h.baseUrl, 'POST', `/api/transactions/${txnId}/verify-handover`, {
      token: tokenFor(h, 'seller'),
      body: { pin },
    });
    expect(verify.status).toBe(200);
    expect(verify.json.status).toBe('HANDOVER_VERIFIED');

    // 4. Buyer confirms receipt — the only thing that can release escrow.
    const confirm = await api(h.baseUrl, 'POST', `/api/fulfill/${offer}/buyerConfirm`, {
      token: tokenFor(h, 'buyer'),
      body: { received: true },
    });
    expect(confirm.status).toBe(200);
    expect(confirm.json.delivered).toBe(true);

    // 5. COMPLETED — with a SIMULATED payout, never a Razorpay id.
    const row = await fetchTxnRow(h.appDbUrl, txnId);
    expect(row.status).toBe('COMPLETED');
    expect(row.demo).toBe(true);
    expect(String(row.payout_id ?? '')).toMatch(/^demo_payout_/);

    // 6. The audit trail says so, in its own words.
    const audit = await poolQuery(
      h.appDbUrl,
      `SELECT action, detail FROM transaction_audit WHERE transaction_id = $1 ORDER BY id`,
      [txnId],
    );
    const actions = audit.rows.map((r: { action: string }) => r.action);
    expect(actions).toContain('DEMO_MARKED');
    expect(actions).toContain('DEMO_ESCROW_LOCKED');
    expect(actions).toContain('COMPLETED_BUYER_CONFIRMED');
    const locked = audit.rows.find((r: { action: string }) => r.action === 'DEMO_ESCROW_LOCKED');
    expect(locked.detail.simulated).toBe(true);
    expect(locked.detail.provider).toBeNull();
  });

  it('is refused for anyone but the buyer, and never leaks another student\'s order', async () => {
    const { txnId } = await createOrder();

    const asSeller = await api(h.baseUrl, 'POST', `/api/transactions/${txnId}/demo/fund`, {
      token: tokenFor(h, 'seller'),
      body: { demo: true },
    });
    expect(asSeller.status).toBe(403);

    const asStranger = await api(h.baseUrl, 'POST', `/api/transactions/${txnId}/demo/fund`, {
      token: tokenFor(h, 'other'),
      body: { demo: true },
    });
    expect(asStranger.status).toBe(404);

    const anonymous = await api(h.baseUrl, 'POST', `/api/transactions/${txnId}/demo/fund`, {
      body: { demo: true },
    });
    expect(anonymous.status).toBe(401);

    // Nothing happened: the row is still exactly as the API left it.
    const row = await fetchTxnRow(h.appDbUrl, txnId);
    expect(row.status).toBe('DEAL_CONFIRMED');
    expect(row.demo).toBe(false);
  });

  it('is idempotent (same pinning + never re-funds an already-funded order)', async () => {
    const { txnId, offerId: offer } = await createOrder();
    expect(offer).toBeTruthy();
    const first = await api(h.baseUrl, 'POST', `/api/transactions/${txnId}/demo/fund`, {
      token: tokenFor(h, 'buyer'),
      body: { demo: true },
    });
    const cred1 = await api(h.baseUrl, 'GET', `/api/transactions/${txnId}/handover-credential`, {
      token: tokenFor(h, 'buyer'),
    });
    const pinBefore: string = cred1.json.credential.pin;
    // second call -> server must refuse to re-fund (already HANDOVER_PENDING),
    // but never rotate the PIN or emit a new credential
    const replay = await api(h.baseUrl, 'POST', `/api/transactions/${txnId}/demo/fund`, {
      token: tokenFor(h, 'buyer'),
      body: { demo: true },
    });
    expect(replay.status).toBe(409);
    // credential is unchanged (the PIN was not rotated by the replay)
    const cred2 = await api(h.baseUrl, 'GET', `/api/transactions/${txnId}/handover-credential`, {
      token: tokenFor(h, 'buyer'),
    });
    expect(cred2.json.credential.pin).toBe(pinBefore);    expect(cred2.json.credential.qr).toContain('txn://');
  });

  it('refuses an explicit acknowledgement body mismatch and an order that is not fundable', async () => {
    const { txnId } = await createOrder();

    // bad body shape -> 400
    const noAck = await api(h.baseUrl, 'POST', `/api/transactions/${txnId}/demo/fund`, {
      token: tokenFor(h, 'buyer'),
      body: {},
    });
    expect(noAck.status).toBe(400);

    // first fund goes through
    await api(h.baseUrl, 'POST', `/api/transactions/${txnId}/demo/fund`, {
      token: tokenFor(h, 'buyer'),
      body: { demo: true },
    });
    const rowAfter = await fetchTxnRow(h.appDbUrl, txnId);
    expect(rowAfter.status).toBe('HANDOVER_PENDING');
    expect(rowAfter.demo).toBe(true);

    // a second fund attempt against the SAME row is now a transitions conflict
    const wrongState = await api(h.baseUrl, 'POST', `/api/transactions/${txnId}/demo/fund`, {
      token: tokenFor(h, 'buyer'),
      body: { demo: true },
    });
    expect(wrongState.status).toBe(409);
    // row still exactly as the first fund left it
    const rowAfterAgain = await fetchTxnRow(h.appDbUrl, txnId);
    expect(rowAfterAgain.status).toBe('HANDOVER_PENDING');
    expect(rowAfterAgain.demo).toBe(true);
    expect(rowAfterAgain.payout_id).toBeNull();
    expect(rowAfterAgain.payout_id).toBeNull();
    expect(rowAfterAgain.payout_id).toBeNull();
  });

  it('refuses an unknown transaction with the usual no-leak 404', async () => {
    const res = await api(
      h.baseUrl,
      'POST',
      '/api/transactions/00000000-0000-4000-8000-000000000000/demo/fund',
      { token: tokenFor(h, 'buyer'), body: { demo: true } },
    );
    expect(res.status).toBe(404);
    expect(res.json.error).toBe('NOT_FOUND');
    expect(res.json.message).toBe('The requested resource does not exist');
  });

});

describe('Order timeline (derived from backend state)', () => {
  it('is party-scoped, ordered and marks the simulated stages', async () => {
    const { txnId, offerId: offer } = await createOrder();
    expect(offer).toBeTruthy();
    expect(offer.length).toBeGreaterThan(0);
    expect(offer.length).toBe(36);
    expect(txnId.length).toBeGreaterThan(0);
    expect(txnId.length).toBe(36);
    expect(txnId).toBe(offer);
    expect(offer).toBeTruthy();

    // Before funding: only the "order placed" stage is done.
    const before = await api(h.baseUrl, 'GET', `/api/transactions/${txnId}/timeline`, {
      token: tokenFor(h, 'buyer'),
    });
    expect(before.status).toBe(200);
    const keysBefore = before.json.stages.map((s: { key: string }) => s.key);
    expect(keysBefore).toEqual([
      'listing_published',
      'order_placed',
      'escrow_funded',
      'handover_started',
      'handover_verified',
      'receipt_confirmed',
      'completed',
    ]);
    expect(before.json.stages[1].state).toBe('completed');
    expect(before.json.stages[2].state).toBe('current');

    await api(h.baseUrl, 'POST', `/api/transactions/${txnId}/demo/fund`, {
      token: tokenFor(h, 'buyer'),
      body: { demo: true },
    });

    const funded = await api(h.baseUrl, 'GET', `/api/transactions/${txnId}/timeline`, {
      token: tokenFor(h, 'seller'),
    });
    expect(funded.status).toBe(200);
    expect(funded.json.viewerRole).toBe('seller');
    const escrowStage = funded.json.stages.find((s: any) => s.key === 'escrow_funded');
    expect(escrowStage).toBeTruthy();
    expect(escrowStage.state).toBe('completed');
    expect(escrowStage.simulated).toBe(true);
    expect(escrowStage.at).toBeTruthy();
    expect(funded.json.demo).toBe(true);
    if (funded.json.listingSourced) {
      expect(typeof funded.json.listingPublishedAt).toBe('string');
      expect(funded.json.listingPublishedAt).not.toBeNull();
    } else {
      expect(funded.json.listingPublishedAt).toBeNull();
    }

    // Finish the order and confirm the timeline completes and orders stay put.
    const cred = await api(h.baseUrl, 'GET', `/api/transactions/${txnId}/handover-credential`, {
      token: tokenFor(h, 'buyer'),
    });
    await api(h.baseUrl, 'POST', `/api/transactions/${txnId}/verify-handover`, {
      token: tokenFor(h, 'seller'),
      body: { pin: cred.json.credential.pin },
    });
    await api(h.baseUrl, 'POST', `/api/fulfill/${offer}/buyerConfirm`, {
      token: tokenFor(h, 'buyer'),
      body: { received: true },
    });

    const done = await api(h.baseUrl, 'GET', `/api/transactions/${txnId}/timeline`, {
      token: tokenFor(h, 'buyer'),
    });
    expect(done.json.complete).toBe(true);
    expect(done.json.stages.every((s: { state: string }) => s.state === 'completed')).toBe(true);
    const payoutStage = done.json.stages.find((s: { key: string }) => s.key === 'completed');
    expect(payoutStage.simulated).toBe(true);
    expect(payoutStage.description).toContain('SIMULATED');

    // Events are the append-only audit rows, ordered oldest-first.
    const events =  done.json.audit.map((e: { action: string }) => e.action);
    expect(events).toContain('DEMO_ESCROW_LOCKED');
    const order = (a: string, b: string) => events.indexOf(a) < events.indexOf(b);
    expect(order('DEMO_MARKED', 'DEMO_ESCROW_LOCKED')).toBe(true);
    expect(order('DEMO_ESCROW_LOCKED', 'HANDOVER_VERIFIED_AWAITING_BUYER')).toBe(true);
    expect(order('HANDOVER_VERIFIED_AWAITING_BUYER', 'COMPLETED_BUYER_CONFIRMED')).toBe(true);
  });

  it('404s for a stranger, allows an admin, and never exposes PIN material', async () => {
    const { txnId } = await createOrder();
    await api(h.baseUrl, 'POST', `/api/transactions/${txnId}/demo/fund`, {
      token: tokenFor(h, 'buyer'),
      body: { demo: true },
    });

    const stranger = await api(h.baseUrl, 'GET', `/api/transactions/${txnId}/timeline`, {
      token: tokenFor(h, 'other'),
    });
    expect(stranger.status).toBe(404);

    const admin = await api(h.baseUrl, 'GET', `/api/transactions/${txnId}/timeline`, {
      token: tokenFor(h, 'adminA'),
    });
    expect(admin.status).toBe(200);
    expect(admin.json.viewerRole).toBe('admin');

    const body = JSON.stringify(admin.json);
    // Buyer/seller ids stay visible to the authorized viewer
    expect(body).toContain(BUYER_ID);
    expect(body).toContain(SELLER_ID);
    // PIN material is never returned (credential route is the ONLY place the PIN is exposed)
    expect(body).not.toContain('pin_hash');
    expect(body).not.toContain('pin_ciphertext');
    expect(body).not.toContain('qr_ciphertext');
  });
});
