import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import {
  api,
  fetchTxnRow,
  insertTxnRow,
  INTERNAL_KEY,
  offerId,
  poolQuery,
  setBuyerReceipt,
  setup,
  stubMarkSold,
  teardown,
  TestHarness,
  tokenFor,
} from './setup';

// ---------------------------------------------------------------------------
// Release-path suite: proves the auto-release worker behaviour and the
// HANDOVER_VERIFIED-stays-on-payout-failure rule against the REAL compose
// Redis (BullMQ) and the REAL settle path. Runs under the same
// test-integration server as integration.test.ts.
// ---------------------------------------------------------------------------

let h: TestHarness;

beforeAll(async () => {
  h = await setup();
});

afterAll(async () => {
  await teardown();
});

// Redis DB 1 — MUST match the harness server (scripts/test-integration.sh).
// DB 0 is the live compose stack's Redis; its BullMQ worker shares this queue
// name and would steal test jobs if we seeded DB 0.
const REDIS_URL = 'redis://localhost:16379/1';

function releaseQueue(): Queue {
  const connection = new IORedis(REDIS_URL, { maxRetriesPerRequest: null });
  return new Queue('txn-release', { connection });
}

// A HANDOVER_PENDING row with a release_deadline 3 seconds in the past and a
// delayed BullMQ job — mirrors exactly what escrow-lock schedules. Stale jobs
// from earlier runs are wiped first (obliterate) so only THIS run's worker
// consumes THIS run's jobs.
//
// `buyerReceived` records the buyer's receipt answer BEFORE the job is queued:
// escrow may only be released once the buyer has confirmed (default true for
// the payout-mechanics tests; R1 passes false to prove the gate).
async function seededExpiredPending(fireInMs = 10, existingTxnId?: string, buyerReceived: boolean | null = true) {
  const txn = existingTxnId
    ? { id: existingTxnId }
    : await insertTxnRow(h.appDbUrl, { status: 'HANDOVER_PENDING' });
  await setBuyerReceipt(h.appDbUrl, txn.id as string, buyerReceived);
  const past = new Date(Date.now() - 3000);
  await poolQuery(h.appDbUrl, `UPDATE transactions SET release_deadline = $2 WHERE id = $1`, [
    txn.id,
    past,
  ]);
  const q = releaseQueue();
  await q.obliterate({ force: true }).catch(() => {});
  await q.add(
    `release-${txn.id}`,
    { transactionId: txn.id, releaseDeadlineIso: past.toISOString() },
    { delay: fireInMs, jobId: `release-${txn.id}` },
  );
  await q.close();
  return txn.id as string;
}

describe('Phase 6 — release path (worker + payout failure)', () => {
  it('R1 auto-release CANNOT pay an order the buyer has not confirmed — it escalates instead', async () => {
    // CONTEXT: the 48h auto-release timer is the "buyer went silent" path. It
    // used to pay the seller unconditionally; since the buyer-receipt
    // requirement it must NOT release unconfirmed escrow. The timer is still
    // scheduled and still fires — it now records the block and leaves the row
    // for the buyer's answer or an admin resolution.
    await api(h.baseUrl, 'POST', '/api/transactions', {
      token: tokenFor(h, 'buyer'),
      body: { offerId: offerId('ACCEPTED') },
    });
    const txnId = await seededExpiredPending(10, undefined, null);

    // The worker moves HANDOVER_PENDING → HANDOVER_VERIFIED, then stops.
    let row = await fetchTxnRow(h.appDbUrl, txnId);
    for (let i = 0; i < 30 && row.status === 'HANDOVER_PENDING'; i++) {
      await new Promise((r) => setTimeout(r, 500));
      row = await fetchTxnRow(h.appDbUrl, txnId);
    }
    expect(row.status).toBe('HANDOVER_VERIFIED');
    expect(row.payout_id).toBeNull();

    // The escalation is audited and no payout key was ever created.
    const audit = await poolQuery(
      h.appDbUrl,
      'SELECT action FROM transaction_audit WHERE transaction_id = $1 ORDER BY created_at',
      [txnId],
    );
    expect(audit.rows.map((r: { action: string }) => r.action)).toContain(
      'RELEASE_BLOCKED_BUYER_UNCONFIRMED',
    );
    const idem = await poolQuery(
      h.appDbUrl,
      'SELECT * FROM handover_idempotency WHERE transaction_id = $1',
      [txnId],
    );
    expect(idem.rows.length).toBe(0);
  });

  it('R1b auto-release DOES complete once the buyer has confirmed receipt', async () => {
    const txnId = await seededExpiredPending(); // buyer_confirmed_at set

    let row = await fetchTxnRow(h.appDbUrl, txnId);
    for (let i = 0; i < 40 && row.status !== 'COMPLETED'; i++) {
      await new Promise((r) => setTimeout(r, 500));
      row = await fetchTxnRow(h.appDbUrl, txnId);
    }
    expect(row.status).toBe('COMPLETED');
    expect(row.payout_id).toMatch(/^pout_stub_/);

    // Settled exactly once: one idempotency row, marked COMPLETED.
    const idem = await poolQuery(
      h.appDbUrl,
      'SELECT status FROM handover_idempotency WHERE transaction_id = $1',
      [txnId],
    );
    expect(idem.rows[0]?.status).toBe('COMPLETED');
  });

  it('R2 dispute-freezes-auto-release: a DISPUTED row is never released by the settle path', async () => {
    // Job scheduled for the future (as at escrow-lock time): the dispute must
    // freeze the row BEFORE any release can fire.
    const txnId = await seededExpiredPending(60000);

    // Buyer disputes; the route cancels the delayed job (best-effort) and the
    // settle path's recheck-then-act is the hard guarantee.
    const dispute = await api(h.baseUrl, 'POST', `/api/transactions/${txnId}/dispute`, {
      token: tokenFor(h, 'buyer'),
      body: {
        reason: 'Damaged item, refusing handover',
        evidenceUrls: ['https://res.cloudinary.com/demo/image/upload/evidenceR2.jpg'],
      },
    });
    expect(dispute.status).toBe(201);

    // Give the worker a window to (NOT) act.
    await new Promise((r) => setTimeout(r, 4000));
    const row = await fetchTxnRow(h.appDbUrl, txnId);
    expect(row.status).toBe('DISPUTED');
    expect(row.payout_id).toBeNull();

    // The frozen row cannot be settled even manually while disputed.
    const verify = await api(h.baseUrl, 'POST', `/api/transactions/${txnId}/verify-handover`, {
      token: tokenFor(h, 'seller'),
      body: { pin: '1234' },
    });
    expect(verify.status).toBe(409);
  });

  it('R3 payout failure keeps HANDOVER_VERIFIED with retry; success then completes', async () => {
    // Drive the REAL settle path against a FAILING payout endpoint: the
    // server's RAZORPAY_API_BASE is the stub, and the stub fails payouts
    // when the amount is the sentinel 133700 paise (per-key flake/fail
    // without touching other tests).
    const txn = await insertTxnRow(h.appDbUrl, { status: 'HANDOVER_PENDING', amountPaise: 133700 });
    // Buyer already confirmed receipt: this test is about payout retry/same-key
    // behaviour, not the receipt gate (covered by R1/R1b).
    await setBuyerReceipt(h.appDbUrl, txn.id as string, true);
    await poolQuery(h.appDbUrl, `UPDATE transactions SET release_deadline = now() - interval '3 seconds' WHERE id = $1`, [txn.id]);

    const q = releaseQueue();
    await q.add(
      `release-${txn.id}`,
      { transactionId: txn.id, releaseDeadlineIso: new Date(Date.now() - 3000).toISOString() },
      { delay: 10, jobId: `release-${txn.id}` },
    );
    await q.close();

    // Worker runs → payout fails → row must be HANDOVER_VERIFIED (or retry
    // backoff pending), NEVER COMPLETED without a successful payout call.
    let row = await fetchTxnRow(h.appDbUrl, txn.id);
    let sawVerified = false;
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 500));
      row = await fetchTxnRow(h.appDbUrl, txn.id);
      if (row.status === 'HANDOVER_VERIFIED') sawVerified = true;
      if (row.status === 'COMPLETED') break; // must NOT happen before stub success
      if (sawVerified && i > 10) break;
    }
    expect(row.status).not.toBe('COMPLETED');
    expect(sawVerified || row.status === 'HANDOVER_VERIFIED').toBe(true);

    // Now let the payout succeed (stub succeeds for non-sentinel amounts on
    // retry with the SAME idempotency key). Recovery runs on the production
    // path — the next POST /api/transactions boots it lazily — re-queues the
    // row, and the settle path completes it with the SAME key (no double-pay).
    await poolQuery(h.appDbUrl, `UPDATE transactions SET amount_paise = 250000 WHERE id = $1`, [txn.id]);
    await api(h.baseUrl, 'POST', '/api/transactions', {
      token: tokenFor(h, 'buyer'),
      body: { offerId: offerId('ACCEPTED') },
    });

    row = await fetchTxnRow(h.appDbUrl, txn.id);
    for (let i = 0; i < 40 && row.status !== 'COMPLETED'; i++) {
      await new Promise((r) => setTimeout(r, 500));
      row = await fetchTxnRow(h.appDbUrl, txn.id);
    }
    expect(row.status).toBe('COMPLETED');
    expect(row.payout_id).toMatch(/^pout_stub_/);

    const idem = await poolQuery(
      h.appDbUrl,
      'SELECT key, status FROM handover_idempotency WHERE transaction_id = $1',
      [txn.id],
    );
    expect(idem.rows[0]?.status).toBe('COMPLETED');
    expect(idem.rows[0]?.key).toBe(`release:${txn.id}`); // SAME key throughout
  });

  it('R4 job recovery: pending releases are re-queued FROM DB after Redis job loss (restart-proof)', async () => {
    const txnId = await seededExpiredPending();

    // Remove the Redis job to simulate restart data loss.
    const q = releaseQueue();
    const before = await q.getJobs(['delayed', 'waiting']);
    for (const j of before) {
      if ((j.data as { transactionId?: string })?.transactionId === txnId) await j.remove();
    }
    const mid = await q.getJobs(['delayed', 'waiting']);
    expect(mid.some((j) => (j.data as { transactionId?: string })?.transactionId === txnId)).toBe(false);
    await q.close();

    // Recovery runs on the production lazy path: any POST /api/transactions
    // re-queues DB rows that lost their Redis job.
    await api(h.baseUrl, 'POST', '/api/transactions', {
      token: tokenFor(h, 'buyer'),
      body: { offerId: offerId('ACCEPTED') },
    });

    // The row now has a live delayed job again and will complete via worker.
    let row = await fetchTxnRow(h.appDbUrl, txnId);
    for (let i = 0; i < 40 && row.status !== 'COMPLETED'; i++) {
      await new Promise((r) => setTimeout(r, 500));
      row = await fetchTxnRow(h.appDbUrl, txnId);
    }
    expect(row.status).toBe('COMPLETED');
  });
});

// -------------------------------------------------------------------------
// Audit Step 1 (N1 fix, user decisions Q1+Q2): the pre-payout SOLD write.
// Q1: transaction-service calls marketplace with the INTERNAL service key.
// Q2: the write MUST succeed before payout — failure aborts settlement with
// the row at HANDOVER_VERIFIED (retryable), never "paid but still listed".
// The stub marketplace records SOLD flips and reports them on /_state.
// -------------------------------------------------------------------------
describe('audit step 1: listing-SOLD write gates payout (N1+Q1+Q2)', () => {
  const stubBase = process.env.TEST_STUB_MARKETPLACE_URL || 'http://localhost:14102';

  async function stubState() {
    const res = await fetch(`${stubBase}/_state`);
    return (await res.json()) as { sold: Record<string, string>; lastKeyValid: boolean };
  }

  it('S1a settle path marks the listing SOLD via the internal key, then completes', async () => {
    // Fresh ACTIVE listing (fixture suffix keeps it off the 409/404 codes).
    const listingId = crypto.randomUUID().replace(/....$/, '0007');
    const txn = await insertTxnRow(h.appDbUrl, { status: 'HANDOVER_PENDING', listingId });
    const txnId = await seededExpiredPending(10, txn.id as string);

    // REAL worker settles it end to end.
    let row = await fetchTxnRow(h.appDbUrl, txnId);
    for (let i = 0; i < 40 && row.status !== 'COMPLETED'; i++) {
      await new Promise((r) => setTimeout(r, 500));
      row = await fetchTxnRow(h.appDbUrl, txnId);
    }
    expect(row.status).toBe('COMPLETED');

    // The stub marketplace SAW the internal-key PATCH with the shared key.
    const state = await stubState();
    expect(state.sold[listingId]).toBe('SOLD');
    expect(state.lastKeyValid).toBe(true);
  });

  it('S1b when marketplace fails, payout is NOT attempted and the row stays retryable at HANDOVER_VERIFIED', async () => {
    // Fixture: a listing id ending in 0008 makes the stub REJECT the internal
    // SOLD write deterministically (no global one-shot flag to race over).
    const failingListingId = crypto.randomUUID().replace(/....$/, '0008');
    const txn = await insertTxnRow(h.appDbUrl, { status: 'HANDOVER_PENDING', listingId: failingListingId });
    await setBuyerReceipt(h.appDbUrl, txn.id as string, true);

    const past = new Date(Date.now() - 3000);
    await poolQuery(h.appDbUrl, `UPDATE transactions SET release_deadline = $2 WHERE id = $1`, [
      txn.id,
      past,
    ]);
    const q = releaseQueue();
    await q.obliterate({ force: true }).catch(() => {});
    await q.add(
      `release-${txn.id}`,
      { transactionId: txn.id, releaseDeadlineIso: past.toISOString() },
      { delay: 10, jobId: `release-${txn.id}` },
    );
    await q.close();

    // The worker hits the SOLD failure; the row must be left at
    // HANDOVER_VERIFIED, never COMPLETED, with no payout attempted.
    let row = await fetchTxnRow(h.appDbUrl, txn.id as string);
    await new Promise((r) => setTimeout(r, 2500));
    row = await fetchTxnRow(h.appDbUrl, txn.id as string);
    expect(row.status).toBe('HANDOVER_VERIFIED');
    expect(row.payout_id).toBeNull();
    const idemBefore = await poolQuery(
      h.appDbUrl,
      'SELECT count(*)::int AS n FROM handover_idempotency WHERE transaction_id = $1',
      [txn.id],
    );
    expect(idemBefore.rows[0].n).toBe(0); // gate failed BEFORE any payout key
    const audit = await poolQuery(
      h.appDbUrl,
      'SELECT action FROM transaction_audit WHERE transaction_id = $1',
      [txn.id],
    );
    expect(audit.rows.map((r: { action: string }) => r.action)).toContain('LISTING_SOLD_WRITE_FAILED');

    // Point the SAME row at a healthy listing and retry: now it settles with
    // the SAME idempotency key — the payout is attempted exactly once.
    await poolQuery(h.appDbUrl, `UPDATE transactions SET listing_id = $2 WHERE id = $1`, [
      txn.id,
      crypto.randomUUID().replace(/....$/, '0007'),
    ]);
    const q2 = releaseQueue();
    await q2.obliterate({ force: true }).catch(() => {});
    await q2.add(
      `release-retry-${txn.id}`,
      { transactionId: txn.id, releaseDeadlineIso: past.toISOString() },
      { delay: 10, jobId: `release-retry-${txn.id}` },
    );
    await q2.close();
    for (let i = 0; i < 40 && row.status !== 'COMPLETED'; i++) {
      await new Promise((r) => setTimeout(r, 500));
      row = await fetchTxnRow(h.appDbUrl, txn.id as string);
    }
    expect(row.status).toBe('COMPLETED');
    const idem = await poolQuery(
      h.appDbUrl,
      'SELECT count(*)::int AS n, max(key) AS key FROM handover_idempotency WHERE transaction_id = $1',
      [txn.id],
    );
    expect(idem.rows[0].n).toBe(1);
    expect(idem.rows[0].key).toBe(`release:${txn.id}`);
  });
});
