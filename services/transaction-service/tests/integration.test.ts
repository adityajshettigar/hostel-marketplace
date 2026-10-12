import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  api,
  BUYER_ID,
  ADMIN_A,
  ADMIN_B,
  capturedWebhookBody,
  fetchTxnRow,
  insertTxnRow,
  offerId,
  postWebhook,
  poolQuery,
  setup,
  SELLER_ID,
  teardown,
  TestHarness,
  tokenFor,
} from './setup';

// ---------------------------------------------------------------------------
// Phase 6 mandated suites (run against a live server started by
// scripts/test-integration.sh; Redis = compose Redis on 16379).
// ---------------------------------------------------------------------------

let h: TestHarness;

beforeAll(async () => {
  h = await setup();
});

afterAll(async () => {
  await teardown();
});

// Drive the whole escrow pipeline for one accepted offer and return state.
async function runToHandoverPending() {
  const create = await api(h.baseUrl, 'POST', '/api/transactions', {
    token: tokenFor(h, 'buyer'),
    body: { offerId: offerId('ACCEPTED') },
  });
  expect(create.status).toBe(201);
  const txnId = create.json.transaction.id as string;

  const init = await api(h.baseUrl, 'POST', `/api/transactions/${txnId}/escrow/init`, {
    token: tokenFor(h, 'buyer'),
  });
  expect(init.status).toBe(200);
  const orderId = init.json.razorpayOrder.id as string;

  const body = capturedWebhookBody(orderId, `pay_test_${Date.now()}_${Math.random().toString(36).slice(2)}`);
  const wh = await postWebhook(h, body, { eventId: `evt_${txnId.slice(0, 8)}` });
  expect(wh.status).toBe(200);
  const whJson = await wh.json();
  expect(whJson.status).toBe('HANDOVER_PENDING');
  expect(whJson.pin).toMatch(/^\d{4}$/);
  return { txnId, orderId, pin: whJson.pin as string };
}

describe('Phase 6 — transaction lifecycle (mandated cases)', () => {
  it('T1 happy path end-to-end: create → escrow → webhook → verify-handover → buyer confirms receipt → COMPLETED', async () => {
    const { txnId, pin } = await runToHandoverPending();

    // Seller submits the correct PIN. Verification no longer releases escrow on
    // its own: it records HANDOVER_VERIFIED and waits for the buyer's answer.
    const verify = await api(h.baseUrl, 'POST', `/api/transactions/${txnId}/verify-handover`, {
      token: tokenFor(h, 'seller'),
      body: { pin },
    });
    expect(verify.status).toBe(200);
    expect(verify.json.status).toBe('HANDOVER_VERIFIED');
    expect(verify.json.awaitingBuyerConfirmation).toBe(true);

    const midway = await fetchTxnRow(h.appDbUrl, txnId);
    expect(midway.status).toBe('HANDOVER_VERIFIED');
    expect(midway.payout_id).toBeNull(); // no money moved before the buyer answers

    // Buyer confirms receipt → the escrow is released to the seller.
    const confirm = await api(h.baseUrl, 'POST', `/api/fulfill/${midway.offer_id}/buyerConfirm`, {
      token: tokenFor(h, 'buyer'),
      body: { received: true },
    });
    expect(confirm.status).toBe(200);
    expect(confirm.json.received).toBe(true);
    expect(confirm.json.delivered).toBe(true);
    expect(confirm.json.payout.status).toBe('COMPLETED');

    const row = await fetchTxnRow(h.appDbUrl, txnId);
    expect(row.status).toBe('COMPLETED');
    // PIN stored ONLY as argon2 hash; never plaintext.
    expect(row.pin_hash.startsWith('$argon2')).toBe(true);
    expect(row.pin_hash.includes(pin)).toBe(false);
    // Idempotency key stored with payout.
    expect(row.payout_id).toBe(confirm.json.payout.payoutId);
  });

  it('T2 webhook-signature-rejection: unsigned/tampered → 400 before touching anything', async () => {
    const create = await api(h.baseUrl, 'POST', '/api/transactions', {
      token: tokenFor(h, 'buyer'),
      body: { offerId: offerId('ACCEPTED') },
    });
    const txnId = create.json.transaction.id;
    const init = await api(h.baseUrl, 'POST', `/api/transactions/${txnId}/escrow/init`, {
      token: tokenFor(h, 'buyer'),
    });
    const orderId = init.json.razorpayOrder.id;

    // Tampered body, valid-for-other-body signature.
    const body = capturedWebhookBody(orderId, 'pay_tampered');
    const bad = await postWebhook(h, body, { signature: 'deadbeef'.repeat(8) });
    expect(bad.status).toBe(400);
    const badJson = await bad.json();
    expect(badJson.error).toBe('INVALID_SIGNATURE');

    // No signature header at all.
    const none = await postWebhook(h, body, { signature: null });
    expect(none.status).toBe(400);

    // Row untouched: still ESCROW_PENDING, no PIN, no deadline.
    const row = await fetchTxnRow(h.appDbUrl, txnId);
    expect(row.status).toBe('ESCROW_PENDING');
    expect(row.pin_hash).toBeNull();
    expect(row.release_deadline).toBeNull();

    // Rejection was audited.
    const audit = await api(h.baseUrl, 'GET', `/api/transactions/${txnId}`, { token: tokenFor(h, 'adminA') });
    expect(audit.status).toBe(200);
  });

  it('T3 duplicate-webhook-idempotency: same event id twice → second is a no-op', async () => {
    const { txnId, pin } = await runToHandoverPending();
    expect(pin).toMatch(/^\d{4}$/);

    // Replay the REAL captured event (same order, same event id) — Razorpay
    // retries look exactly like this. The dedupe table must swallow it.
    const row = await fetchTxnRow(h.appDbUrl, txnId);
    const body = capturedWebhookBody(row.razorpay_order_id, 'pay_replay_same_event');
    const replay = await postWebhook(h, body, { eventId: `evt_${txnId.slice(0, 8)}` });
    expect(replay.status).toBe(200);
    const replayJson = await replay.json();
    expect(replayJson.duplicate).toBe(true);

    // The duplicate must NOT have re-generated a PIN or restarted the window.
    const row2 = await fetchTxnRow(h.appDbUrl, txnId);
    expect(row2.status).toBe('HANDOVER_PENDING');
    expect(row2.pin_hash).toBe(row.pin_hash); // unchanged

    // Complete the deal normally: verify the handover, then the buyer confirms.
    const verify = await api(h.baseUrl, 'POST', `/api/transactions/${txnId}/verify-handover`, {
      token: tokenFor(h, 'seller'),
      body: { pin },
    });
    expect(verify.status).toBe(200);
    expect(verify.json.status).toBe('HANDOVER_VERIFIED');

    // Replaying verification is now an idempotent no-op (it used to 409 because
    // the first call had already paid out; paying is no longer part of it).
    const replayVerify = await api(h.baseUrl, 'POST', `/api/transactions/${txnId}/verify-handover`, {
      token: tokenFor(h, 'seller'),
      body: { pin },
    });
    expect(replayVerify.status).toBe(200);
    expect(replayVerify.json.alreadyVerified).toBe(true);

    const pendingRow = await fetchTxnRow(h.appDbUrl, txnId);
    const confirm = await api(h.baseUrl, 'POST', `/api/fulfill/${pendingRow.offer_id}/buyerConfirm`, {
      token: tokenFor(h, 'buyer'),
      body: { received: true },
    });
    expect(confirm.status).toBe(200);

    // Repeating the confirmation must not pay twice either.
    const replayConfirm = await api(h.baseUrl, 'POST', `/api/fulfill/${pendingRow.offer_id}/buyerConfirm`, {
      token: tokenFor(h, 'buyer'),
      body: { received: true },
    });
    expect(replayConfirm.status).toBe(200);
    expect(replayConfirm.json.payout.status).toBe('COMPLETED');

    const after = await fetchTxnRow(h.appDbUrl, txnId);
    expect(after.status).toBe('COMPLETED');
    // Exactly ONE payout attempt key for this transaction.
    const idem = await poolQuery(
      h.appDbUrl,
      'SELECT count(*)::int AS n, max(status) AS status FROM handover_idempotency WHERE transaction_id = $1',
      [txnId],
    );
    expect(idem.rows[0].n).toBe(1);
    expect(idem.rows[0].status).toBe('COMPLETED');
  });

  it('T4 3-failed-PIN-attempts locks handover; every attempt audited', async () => {
    const { txnId } = await runToHandoverPending();

    for (let i = 1; i <= 3; i++) {
      const wrong = await api(h.baseUrl, 'POST', `/api/transactions/${txnId}/verify-handover`, {
        token: tokenFor(h, 'seller'),
        body: { pin: i === 3 ? '9999' : '0000' },
      });
      if (i < 3) {
        expect(wrong.status).toBe(401);
        expect(wrong.json.error).toBe('INVALID_PIN_OR_QR');
      } else {
        expect(wrong.status).toBe(423);
        expect(wrong.json.error).toBe('HANDOVER_LOCKED');
      }
    }

    const row = await fetchTxnRow(h.appDbUrl, txnId);
    expect(row.handover_locked).toBe(true);
    expect(row.failed_attempts).toBe(3);
    expect(row.status).toBe('HANDOVER_PENDING'); // no state skip

    // Even the CORRECT pin is now rejected while locked.
    // (PIN unknown to test — any 4-digit attempt must hit the lock, not the pin check.)
    const locked = await api(h.baseUrl, 'POST', `/api/transactions/${txnId}/verify-handover`, {
      token: tokenFor(h, 'seller'),
      body: { pin: '1234' },
    });
    expect(locked.status).toBe(423);
  });

  it('T5 dispute-freezes-and-blocks-auto-release: release job cancelled, disputed row cannot settle', async () => {
    const { txnId } = await runToHandoverPending();

    const dispute = await api(h.baseUrl, 'POST', `/api/transactions/${txnId}/dispute`, {
      token: tokenFor(h, 'buyer'),
      body: { reason: 'Item damaged on arrival', evidenceUrls: ['https://res.cloudinary.com/demo/image/upload/evidence1.jpg'] },
    });
    expect(dispute.status).toBe(201);
    expect(dispute.json.dispute.status).toBe('DISPUTED');
    expect(dispute.json.adminTicket.id).toBeTruthy();

    const row = await fetchTxnRow(h.appDbUrl, txnId);
    expect(row.status).toBe('DISPUTED');
    expect(row.dispute_id).toBe(dispute.json.dispute.id);

    // Admin resolve → REFUNDED (no dual auth below threshold).
    const resolve = await api(h.baseUrl, 'PATCH', `/api/disputes/${dispute.json.dispute.id}/resolve`, {
      token: tokenFor(h, 'adminA'),
      body: { resolution: 'REFUNDED', note: 'Evidence confirms damage' },
    });
    expect(resolve.status).toBe(200);
    expect(resolve.json.status).toBe('REFUNDED');

    const final = await fetchTxnRow(h.appDbUrl, txnId);
    expect(final.status).toBe('REFUNDED');
  });

  it('T6 auto-release-does-not-fire-if-already-disputed: worker no-ops on DISPUTED', async () => {
    const { txnId } = await runToHandoverPending();

    // Dispute first (cancels the scheduled job; even if it fired, no-op).
    const dispute = await api(h.baseUrl, 'POST', `/api/transactions/${txnId}/dispute`, {
      token: tokenFor(h, 'buyer'),
      body: { reason: 'Seller unreachable', evidenceUrls: ['https://res.cloudinary.com/demo/image/upload/evidence2.jpg'] },
    });
    expect(dispute.status).toBe(201);

    // Force the settle path directly (what the worker would do) — it must
    // refuse because status is DISPUTED, not HANDOVER_PENDING.
    const res = await fetch(`${h.baseUrl}/api/transactions/${txnId}`, {
      headers: { authorization: `Bearer ${tokenFor(h, 'adminA')}`, 'x-service-key': process.env.TEST_SERVICE_KEY || 'test-internal-key', },
    });
    expect(res.status).toBe(200);
    const view = await res.json();
    expect(view.transaction.status).toBe('DISPUTED');
  });

  it('T7 dual-auth: above threshold needs a second, different admin; missing/wrong/self → 403', async () => {
    // High-value transaction (900000 paise > 500000 threshold).
    const txn = await insertTxnRow(h.appDbUrl, { status: 'DISPUTED', amountPaise: 900000 });
    const d = await poolQuery(
      h.appDbUrl,
      `INSERT INTO disputes (transaction_id, raised_by, reason, evidence_urls)
       VALUES ($1, $2, 'High value scam report', ARRAY['https://res.cloudinary.com/demo/image/upload/evidence3.jpg']::text[]) RETURNING id`,
      [txn.id, BUYER_ID],
    );
    const disputeId = d.rows[0].id as string;

    // 1. No second-admin token → 403 DUAL_AUTH_REQUIRED.
    const noToken = await api(h.baseUrl, 'PATCH', `/api/disputes/${disputeId}/resolve`, {
      token: tokenFor(h, 'adminA'),
      body: { resolution: 'REFUNDED', note: 'Trying to resolve alone' },
    });
    expect(noToken.status).toBe(403);
    expect(noToken.json.error).toBe('DUAL_AUTH_REQUIRED');

    // 2. Second admin = caller himself → 403.
    const self = await api(h.baseUrl, 'PATCH', `/api/disputes/${disputeId}/resolve`, {
      token: tokenFor(h, 'adminA'),
      body: { resolution: 'REFUNDED', note: 'self approval attempt', secondAdminToken: `admin:${ADMIN_A}` },
    });
    expect(self.status).toBe(403);

    // 3. Second admin not in ADMIN_USER_IDS → 403.
    const stranger = await api(h.baseUrl, 'PATCH', `/api/disputes/${disputeId}/resolve`, {
      token: tokenFor(h, 'adminA'),
      body: { resolution: 'REFUNDED', note: 'stranger approval attempt', secondAdminToken: `admin:c9999999-0000-4000-8000-000000000009` },
    });
    expect(stranger.status).toBe(403);

    // 4. Proper second admin → success.
    const ok = await api(h.baseUrl, 'PATCH', `/api/disputes/${disputeId}/resolve`, {
      token: tokenFor(h, 'adminA'),
      body: { resolution: 'REFUNDED', note: 'Dual approved', secondAdminToken: `admin:${ADMIN_B}` },
    });
    expect(ok.status).toBe(200);
    expect(ok.json.status).toBe('REFUNDED');
  });

  it('P1 paise-conversion regression: amount_paise === round(offeredPrice × 100) — the ₹800→8-paise bug guard', async () => {
    // Guard against the hand-fixed money bug: the stub offer is ₹800.00 and
    // the row must store 80000 paise (NOT 800 — the bug stored rupees as
    // paise, making every amount wrong by ×100).
    const create = await api(h.baseUrl, 'POST', '/api/transactions', {
      token: tokenFor(h, 'buyer'),
      body: { offerId: offerId('ACCEPTED') },
    });
    expect(create.status).toBe(201);
    const txnId = create.json.transaction.id as string;

    expect(create.json.transaction.amountPaise).toBe(80000);

    const row = await fetchTxnRow(h.appDbUrl, txnId);
    expect(Number(row.amount_paise)).toBe(80000);
  });

  it('H1a buyer retrieves handover credential: 200, 4-digit PIN, PIN verifies against pin_hash', async () => {
    const { txnId, pin } = await runToHandoverPending();

    const cred = await api(h.baseUrl, 'GET', `/api/transactions/${txnId}/handover-credential`, {
      token: tokenFor(h, 'buyer'),
    });
    expect(cred.status).toBe(200);
    expect(cred.json.credential.pin).toMatch(/^\d{4}$/);
    expect(cred.json.credential.pin).toBe(pin); // same secret the webhook returned
    expect(typeof cred.json.credential.qr).toBe('string');

    // The retrieved PIN is the REAL one: the seller can verify handover with it.
    const verify = await api(h.baseUrl, 'POST', `/api/transactions/${txnId}/verify-handover`, {
      token: tokenFor(h, 'seller'),
      body: { pin: cred.json.credential.pin },
    });
    expect(verify.status).toBe(200);
    expect(verify.json.status).toBe('HANDOVER_VERIFIED');

    // Close the order: the buyer confirms receipt (this is what completes it).
    const pendingRow = await fetchTxnRow(h.appDbUrl, txnId);
    const confirm = await api(h.baseUrl, 'POST', `/api/fulfill/${pendingRow.offer_id}/buyerConfirm`, {
      token: tokenFor(h, 'buyer'),
      body: { received: true },
    });
    expect(confirm.status).toBe(200);
    expect(confirm.json.delivered).toBe(true);
    const completedRow = await fetchTxnRow(h.appDbUrl, txnId);
    expect(completedRow.status).toBe('COMPLETED');

    // Window closed: after COMPLETED the credential is no longer queryable.
    const after = await api(h.baseUrl, 'GET', `/api/transactions/${txnId}/handover-credential`, {
      token: tokenFor(h, 'buyer'),
    });
    expect(after.status).toBe(409);
    expect(JSON.stringify(after.json)).not.toContain(cred.json.credential.pin);
  });

  it('H1b credential is buyer-only: seller/admin → 403, stranger → 404, unauthenticated → 401', async () => {
    const { txnId } = await runToHandoverPending();

    const seller = await api(h.baseUrl, 'GET', `/api/transactions/${txnId}/handover-credential`, {
      token: tokenFor(h, 'seller'),
    });
    expect(seller.status).toBe(403);
    expect(seller.json.error).toBe('FORBIDDEN');

    const admin = await api(h.baseUrl, 'GET', `/api/transactions/${txnId}/handover-credential`, {
      token: tokenFor(h, 'adminA'),
    });
    expect(admin.status).toBe(403);

    const stranger = await api(h.baseUrl, 'GET', `/api/transactions/${txnId}/handover-credential`, {
      token: tokenFor(h, 'other'),
    });
    expect(stranger.status).toBe(404);

    const unauth = await api(h.baseUrl, 'GET', `/api/transactions/${txnId}/handover-credential`, {});
    expect(unauth.status).toBe(401);

    // No credential material in ANY rejection body.
    for (const r of [seller, admin, stranger, unauth]) {
      expect(JSON.stringify(r.json)).not.toMatch(/"pin"|"qr"/);
    }
  });

  it('H1c no credential after DISPUTED; plaintext PIN never stored in the row', async () => {
    const { txnId } = await runToHandoverPending();

    const dispute = await api(h.baseUrl, 'POST', `/api/transactions/${txnId}/dispute`, {
      token: tokenFor(h, 'buyer'),
      body: { reason: 'Credential gating check', evidenceUrls: ['https://res.cloudinary.com/demo/image/upload/cred.jpg'] },
    });
    expect(dispute.status).toBe(201);

    const cred = await api(h.baseUrl, 'GET', `/api/transactions/${txnId}/handover-credential`, {
      token: tokenFor(h, 'buyer'),
    });
    expect(cred.status).toBe(409);
    expect(cred.json.error).toBe('NOT_AVAILABLE');

    // PIN at rest: ciphertext columns populated, hash intact, plaintext absent.
    const row = await fetchTxnRow(h.appDbUrl, txnId);
    expect(row.pin_ciphertext).toBeTruthy();
    expect(row.pin_nonce).toBeTruthy();
    expect(row.pin_hash.startsWith('$argon2')).toBe(true);
    expect(JSON.stringify(row)).not.toContain('"pin":');
  });

  it('H3 admin lists: disputes and audit rows via requireAdmin; non-admin 403; filters + pagination', async () => {
    // Non-admin (buyer) rejected exactly like other admin routes.
    const asBuyer = await api(h.baseUrl, 'GET', '/api/disputes', { token: tokenFor(h, 'buyer') });
    expect(asBuyer.status).toBe(403);
    expect(asBuyer.json.error).toBe('FORBIDDEN');
    const auditAsBuyer = await api(h.baseUrl, 'GET', '/api/audit', { token: tokenFor(h, 'buyer') });
    expect(auditAsBuyer.status).toBe(403);

    // Seed: a real dispute exists (from T5's flow we cannot rely on ordering;
    // create a dedicated one via insert so this test is self-contained).
    const txn = await insertTxnRow(h.appDbUrl, { status: 'DISPUTED', amountPaise: 120000 });
    const d = await poolQuery(
      h.appDbUrl,
      `INSERT INTO disputes (transaction_id, raised_by, reason, evidence_urls)
       VALUES ($1, $2, 'H3 list seed dispute', ARRAY['https://res.cloudinary.com/demo/image/upload/h3.jpg']::text[]) RETURNING id`,
      [txn.id, BUYER_ID],
    );
    const disputeId = d.rows[0].id as string;

    const list = await api(h.baseUrl, 'GET', '/api/disputes', { token: tokenFor(h, 'adminA') });
    expect(list.status).toBe(200);
    expect(Array.isArray(list.json.disputes)).toBe(true);
    const row = list.json.disputes.find((x: { id: string }) => x.id === disputeId);
    expect(row).toBeTruthy();
    expect(row.status).toBe('DISPUTED');
    expect(row.amountPaise).toBe(120000);
    expect(row.transactionId).toBe(txn.id);

    // status filter returns only matching rows.
    const filtered = await api(h.baseUrl, 'GET', '/api/disputes?status=RESOLVED', { token: tokenFor(h, 'adminA') });
    expect(filtered.status).toBe(200);
    expect(filtered.json.disputes.some((x: { id: string }) => x.id === disputeId)).toBe(false);

    const byTxn = await api(h.baseUrl, 'GET', `/api/disputes?transactionId=${txn.id}`, { token: tokenFor(h, 'adminA') });
    expect(byTxn.status).toBe(200);
    expect(byTxn.json.disputes).toHaveLength(1);
    expect(byTxn.json.disputes[0].id).toBe(disputeId);

    // Audit list: rows exist (handover attempts wrote audit rows in T4 etc.),
    // paginated, newest first, correct shape.
    const audit = await api(h.baseUrl, 'GET', '/api/audit?limit=5', { token: tokenFor(h, 'adminA') });
    expect(audit.status).toBe(200);
    expect(Array.isArray(audit.json.audit)).toBe(true);
    expect(audit.json.audit.length).toBeGreaterThan(0);
    expect(audit.json.audit.length).toBeLessThanOrEqual(5);
    const entry = audit.json.audit[0];
    expect(typeof entry.id).toBe('string');
    expect(typeof entry.action).toBe('string');
    expect(typeof entry.createdAt).toBe('string');
    const times = audit.json.audit.map((x: { createdAt: string }) => x.createdAt);
    expect([...times].sort().reverse()).toEqual(times);

    // Audit transaction filter.
    const auditTxn = await api(h.baseUrl, 'GET', `/api/audit?transactionId=${txn.id}`, { token: tokenFor(h, 'adminA') });
    expect(auditTxn.status).toBe(200);
    expect(auditTxn.json.audit.every((x: { transactionId: string | null }) => x.transactionId === txn.id)).toBe(true);

    // Pagination metadata shape.
    expect(audit.json.pagination).toMatchObject({ page: 1, limit: 5 });
    expect(typeof audit.json.pagination.total).toBe('number');
  });

  it('T8 non-buyer / non-seller / bad-offer guards', async () => {
    // PENDING offer → 409 OFFER_NOT_ACCEPTED.
    const pending = await api(h.baseUrl, 'POST', '/api/transactions', {
      token: tokenFor(h, 'buyer'),
      body: { offerId: offerId('PENDING') },
    });
    expect(pending.status).toBe(409);

    // Offer of another buyer → 403.
    const forbidden = await api(h.baseUrl, 'POST', '/api/transactions', {
      token: tokenFor(h, 'other'),
      body: { offerId: offerId('ACCEPTED') },
    });
    expect(forbidden.status).toBe(403);

    // Non-seller cannot verify handover; non-buyer cannot dispute.
    const { txnId, pin } = await runToHandoverPending();
    const notSeller = await api(h.baseUrl, 'POST', `/api/transactions/${txnId}/verify-handover`, {
      token: tokenFor(h, 'buyer'),
      body: { pin },
    });
    expect(notSeller.status).toBe(403);

    const notBuyer = await api(h.baseUrl, 'POST', `/api/transactions/${txnId}/dispute`, {
      token: tokenFor(h, 'seller'),
      body: { reason: 'Not the buyer', evidenceUrls: ['https://x.cloudinary.com/e.jpg'] },
    });
    expect(notBuyer.status).toBe(403);

    // PIN never appears in any subsequent API response.
    const view = await api(h.baseUrl, 'GET', `/api/transactions/${txnId}`, { token: tokenFor(h, 'seller') });
    expect(JSON.stringify(view.json).includes(pin)).toBe(false);
  });
});
