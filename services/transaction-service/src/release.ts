import { Queue, Worker, JobsOptions } from 'bullmq';
import IORedis from 'ioredis';
import { env } from './env';
import { pool } from './db';
import { transition, writeAudit, TxnRow } from './state-machine';
import { createPayout } from './razorpay';
import { markListingSoldInMarketplace } from './marketplace';
import { demoModeEnabled, simulateDemoPayout } from './demo';

// ---------------------------------------------------------------------------
// Auto-release (48h) — BullMQ delayed jobs on the compose Redis (user
// decision: lazy IN-PROCESS worker + DB recovery; next dev has no boot hook,
// so ensureReleaseRuntime() runs on first request, like communication's
// realtime.ts singleton). Release uses the SAME settle code path as manual
// verification: recheck-then-act inside one FOR UPDATE DB transaction.
// ---------------------------------------------------------------------------

const QUEUE_NAME = 'txn-release';

type ReleaseJobData = { transactionId: string; releaseDeadlineIso: string };

const globalForRelease = globalThis as unknown as {
  txnReleaseRuntime?: { queue: Queue; connection: IORedis; worker: Worker };
};

function redisConnection(): IORedis {
  // BullMQ requires maxRetriesPerRequest: null on the shared connection.
  return new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });
}

export function ensureReleaseRuntime() {
  if (globalForRelease.txnReleaseRuntime) return globalForRelease.txnReleaseRuntime;

  const connection = redisConnection();
  const queue = new Queue(QUEUE_NAME, { connection });
  const worker = new Worker<ReleaseJobData>(
    QUEUE_NAME,
    async (job) => {
      await autoReleaseTransaction(job.data.transactionId);
    },
    { connection, concurrency: 2 },
  );
  worker.on('completed', (job) => {
    console.log(`[transaction:release] job ${job?.id ?? '?'} completed`);
  });
  worker.on('failed', (job, err) => {
    console.error(`[transaction:release] job ${job?.id ?? '?'} failed:`, err?.message);
  });

  globalForRelease.txnReleaseRuntime = { queue, connection, worker };
  return globalForRelease.txnReleaseRuntime;
}

// Scheduled at escrow-lock time for release_deadline (48h later).
export async function scheduleReleaseJob(params: {
  transactionId: string;
  releaseDeadline: Date;
}): Promise<void> {
  const { queue } = ensureReleaseRuntime();
  const delay = Math.max(0, params.releaseDeadline.getTime() - Date.now());
  const data: ReleaseJobData = {
    transactionId: params.transactionId,
    releaseDeadlineIso: params.releaseDeadline.toISOString(),
  };
  await queue.add(
    `release:${params.transactionId}`,
    data,
    {
      delay,
      // Payout failure inside the job throws → BullMQ retries with backoff
      // (the row stays HANDOVER_VERIFIED until a payout REALLY succeeds).
      attempts: 5,
      backoff: { type: 'fixed', delay: 30000 },
      removeOnComplete: 500,
      removeOnFail: 500,
      // BullMQ v6 forbids ':' in custom ids.
      jobId: `release-${params.transactionId}-${params.releaseDeadline.toISOString()}`,
    } satisfies JobsOptions,
  );
}

// Dispute → the scheduled job is CANCELLED (removed); even if it already
// fired, autoReleaseTransaction re-checks status and no-ops (never releases
// while DISPUTED).
export async function cancelReleaseJob(transactionId: string): Promise<void> {
  try {
    const { queue } = ensureReleaseRuntime();
    const jobs = await queue.getJobs(['delayed', 'waiting']);
    for (const j of jobs) {
      if ((j.data as ReleaseJobData)?.transactionId === transactionId) {
        await j.remove();
      }
    }
  } catch (err) {
    // Cancellation is best-effort; the recheck-then-act inside the settle
    // path is the real guarantee (dispute-freezes test proves it).
    console.error('[transaction:cancelReleaseJob]', err);
  }
}

// Boot-time recovery (SRS 5.4.5): BullMQ delayed jobs can be lost on restart;
// so for every HANDOVER_PENDING row past its deadline (or lacking a live
// Redis job), a recovered job is re-scheduled. Runs inside
// ensureReleaseRuntime on first request.
export async function recoverPendingReleasesFromDb(): Promise<number> {
  const { queue } = ensureReleaseRuntime();
  const res = await pool.query<{ id: string; release_deadline: Date | string }>(
    `SELECT id, release_deadline FROM transactions
     WHERE release_deadline IS NOT NULL
       AND (status = 'HANDOVER_PENDING'
            OR (status = 'HANDOVER_VERIFIED' AND payout_id IS NULL))`,
  );
  const existing = new Set(
    (await queue.getJobs(['delayed', 'waiting']))
      .map((j) => (j.data as ReleaseJobData)?.transactionId)
      .filter(Boolean) as string[],
  );
  let recovered = 0;
  for (const row of res.rows) {
    if (existing.has(row.id)) continue;
    const deadline = new Date(row.release_deadline);
    await scheduleReleaseJob({ transactionId: row.id, releaseDeadline: deadline });
    recovered += 1;
  }
  return recovered;
}

// ---------------------------------------------------------------------------
// THE single release path — shared by the worker (auto) and by manual
// verify-handover success. recheck-then-act in one DB txn with FOR UPDATE.
// ---------------------------------------------------------------------------

export type SettleResult =
  | { ok: true; status: 'COMPLETED'; payoutId: string }
  | { ok: true; status: 'HANDOVER_VERIFIED'; reason: string; retriable: true }
  | { ok: false; status: TxnRow['status']; reason: string; retriable?: boolean };

export type SettleSource = 'AUTO_RELEASE' | 'MANUAL_VERIFY' | 'BUYER_CONFIRM';

/**
 * Seller-side handover verification step: PIN/QR already checked by the
 * caller. Advances HANDOVER_PENDING → HANDOVER_VERIFIED and STOPS — the
 * payout is deliberately NOT attempted here any more. Release now needs the
 * authenticated buyer's own receipt confirmation (settleTransaction with
 * source BUYER_CONFIRM), or an admin dispute resolution (MANUAL_VERIFY)
 * when the buyer does not answer.
 *
 * Idempotent: a replay on an already-verified/completed row reports success.
 */
export async function markHandoverVerified(
  txnId: string,
  opts: { actorId: string | null },
): Promise<
  | { ok: true; status: 'HANDOVER_VERIFIED'; alreadyVerified: boolean }
  | { ok: false; status: TxnRow['status']; reason: string }
> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const cur = await client.query<TxnRow>('SELECT * FROM transactions WHERE id = $1 FOR UPDATE', [
      txnId,
    ]);
    const txn = cur.rows[0];
    if (!txn) {
      await client.query('ROLLBACK');
      return { ok: false, status: 'DEAL_CONFIRMED', reason: 'transaction not found' };
    }
    if (txn.status === 'HANDOVER_VERIFIED' || txn.status === 'COMPLETED') {
      await client.query('COMMIT');
      return { ok: true, status: 'HANDOVER_VERIFIED', alreadyVerified: true };
    }
    if (txn.status !== 'HANDOVER_PENDING') {
      await client.query('ROLLBACK');
      return { ok: false, status: txn.status as TxnRow['status'], reason: `status is ${txn.status}` };
    }

    await transition(client, txnId, 'HANDOVER_VERIFIED');
    await writeAudit(client, {
      transactionId: txnId,
      actorId: opts.actorId,
      action: 'HANDOVER_VERIFIED_AWAITING_BUYER',
      detail: { note: 'PIN/QR verified; escrow release held until the buyer confirms receipt' },
    });
    await client.query('COMMIT');
    return { ok: true, status: 'HANDOVER_VERIFIED', alreadyVerified: false };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function settleTransaction(
  txnId: string,
  opts: { actorId: string | null; source: SettleSource },
): Promise<SettleResult> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const cur = await client.query<TxnRow>('SELECT * FROM transactions WHERE id = $1 FOR UPDATE', [
      txnId,
    ]);
    const txn = cur.rows[0];
    if (!txn) {
      await client.query('ROLLBACK');
      return { ok: false, status: 'DEAL_CONFIRMED', reason: 'transaction not found' };
    }
    // Recheck-then-act. AUTO_RELEASE (the 48h worker) settles rows still
    // HANDOVER_PENDING, and retries rows left HANDOVER_VERIFIED by a failed
    // payout (never disputed, never already completed). MANUAL_VERIFY
    // additionally accepts RESOLVED (admin dispute resolution in the
    // seller's favour). DISPUTED/terminal rows are refused — always.
    const settleable =
      opts.source === 'BUYER_CONFIRM'
        ? txn.status === 'HANDOVER_VERIFIED'
        : opts.source === 'AUTO_RELEASE'
          ? txn.status === 'HANDOVER_PENDING' || txn.status === 'HANDOVER_VERIFIED'
          : txn.status === 'HANDOVER_PENDING' ||
            txn.status === 'RESOLVED' ||
            txn.status === 'HANDOVER_VERIFIED';
    if (!settleable) {
      await client.query('ROLLBACK');
      return { ok: false, status: txn.status as TxnRow['status'], reason: `status is ${txn.status}` };
    }

    // Mark verified FIRST (HANDOVER_PENDING → HANDOVER_VERIFIED; from
    // RESOLVED the state machine goes RESOLVED → COMPLETED directly;
    // HANDOVER_VERIFIED retries stay put until the payout really succeeds).
    if (txn.status === 'HANDOVER_PENDING') {
      await transition(client, txnId, 'HANDOVER_VERIFIED');
    }

    // Buyer-receipt gate. Money leaves escrow only after the authenticated
    // buyer answered "yes, I received it" (fulfilment_tracking.buyer_received
    // set by POST /api/fulfill/:offerId/buyerConfirm). Consequences:
    //  - the 48h auto-release timer can no longer pay an unconfirmed order;
    //    it escalates to the audit trail and leaves the row for a human.
    //  - an ADMIN resolution (disputes.ts, source MANUAL_VERIFY) is the
    //    authorised override when the buyer never answers.
    //  - BUYER_CONFIRM is the normal path and has just recorded the receipt.
    if (opts.source !== 'MANUAL_VERIFY') {
      const receipt = await client.query<{ buyer_received: boolean | null }>(
        `SELECT buyer_received FROM fulfilment_tracking WHERE transaction_id = $1`,
        [txnId],
      );
      if (receipt.rows[0]?.buyer_received !== true) {
        await writeAudit(client, {
          transactionId: txnId,
          actorId: opts.actorId,
          action: 'RELEASE_BLOCKED_BUYER_UNCONFIRMED',
          detail: { source: opts.source, buyerReceived: receipt.rows[0]?.buyer_received ?? null },
        });
        await client.query('COMMIT');
        return {
          ok: false,
          status: 'HANDOVER_VERIFIED',
          reason: 'buyer receipt not confirmed',
          retriable: false,
        };
      }
    }

    // AUDIT N1 (user decisions Q1+Q2): before any payout, flip the listing to
    // a terminal state via the internal key — and REQUIRE it to succeed. A
    // failure (marketplace down, listing not ACTIVE, key unconfigured) aborts
    // settlement with the row safely at HANDOVER_VERIFIED so the seller can
    // simply retry; no "paid but still listed" drift is possible.
    // (COMMIT first: the transition above must persist so the retry resumes
    // at HANDOVER_VERIFIED; the payout has not been attempted yet.)
    const sold = await markListingSoldInMarketplace(txn.listing_id);
    if (!sold.ok) {
      await writeAudit(client, {
        transactionId: txnId,
        actorId: opts.actorId,
        action: 'LISTING_SOLD_WRITE_FAILED',
        detail: { source: opts.source, listingId: txn.listing_id, status: sold.status, error: sold.error },
      });
      await client.query('COMMIT');
      return {
        ok: false,
        status: 'HANDOVER_VERIFIED',
        reason: `listing could not be marked sold: ${sold.error}`,
        retriable: true,
      };
    }

    // Idempotency key STORED BEFORE the payout call (no double-pay). A
    // PENDING row from a failed/in-flight attempt is retried with the SAME
    // key; a COMPLETED row means the money already moved — refuse.
    const existingKey = await client.query<{ key: string; status: string }>(
      `SELECT key, status FROM handover_idempotency WHERE transaction_id = $1 FOR UPDATE`,
      [txnId],
    );
    let payoutKey: string;
    if (existingKey.rows.length === 0) {
      payoutKey = `release:${txnId}`;
      await client.query(
        `INSERT INTO handover_idempotency (transaction_id, key, status)
         VALUES ($1, $2, 'PENDING')`,
        [txnId, payoutKey],
      );
    } else if (existingKey.rows[0].status === 'COMPLETED') {
      await client.query('ROLLBACK');
      return { ok: false, status: txn.status as TxnRow['status'], reason: 'payout already completed' };
    } else {
      payoutKey = existingKey.rows[0].key; // retry with the SAME key
    }

    const amount = Number(txn.amount_paise);
    // SIMULATION MODE (project demonstration task). A DEMO-flagged transaction
    // settles with a clearly-labelled synthetic payout id instead of a Razorpay
    // transfer — never with a real one, and never for an ordinary order. The
    // idempotency row, the state machine, the listing write and the audit trail
    // are all identical to the real path; only the provider call is replaced.
    // demoModeEnabled() is a hard no under NODE_ENV=production, so a demo row
    // in any other environment simply keeps failing the payout like a real one.
    const simulatedPayout = Boolean(txn.demo) && demoModeEnabled();
    const payout = simulatedPayout
      ? await simulateDemoPayout({ txnId, amountPaise: amount })
      : await createPayout({ amountPaise: amount, idempotencyKey: payoutKey });
    await writeAudit(client, {
      transactionId: txnId,
      actorId: opts.actorId,
      action: 'PAYOUT_ATTEMPT',
      detail: {
        source: opts.source,
        ok: payout.ok,
        status: payout.status,
        error: payout.error ?? null,
        ...(simulatedPayout ? { simulated: true, provider: null } : {}),
      },
    });

    if (!payout.ok) {
      // Row stays HANDOVER_VERIFIED (or RESOLVED); a retry job (or retry
      // request) re-runs this. COMPLETED only ever after a real payout.
      await client.query('COMMIT');
      return { ok: true, status: 'HANDOVER_VERIFIED', reason: payout.error ?? 'payout failed', retriable: true };
    }

    const updated = await transition(client, txnId, 'COMPLETED');
    await client.query(
      `UPDATE handover_idempotency SET status = 'COMPLETED' WHERE transaction_id = $1`,
      [txnId],
    );
    await client.query(`UPDATE transactions SET payout_id = $2 WHERE id = $1`, [txnId, payout.payoutId]);
    await writeAudit(client, {
      transactionId: txnId,
      actorId: opts.actorId,
      action:
        opts.source === 'AUTO_RELEASE'
          ? 'AUTO_RELEASED'
          : opts.source === 'BUYER_CONFIRM'
            ? 'COMPLETED_BUYER_CONFIRMED'
            : 'COMPLETED_MANUAL',
      detail: { payoutId: payout.payoutId, listingSold: true },
    });
    await client.query('COMMIT');
    return { ok: true, status: 'COMPLETED', payoutId: payout.payoutId ?? updated.id };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// Worker entry point. A fired job re-checks status (skips anything that is no
// longer HANDOVER_PENDING) and retries a few times on transient payout
// failure (HANDOVER_VERIFIED rows are picked up again by recovery too? No —
// recovery only re-queues HANDOVER_PENDING; retries come from job retries).
export async function autoReleaseTransaction(transactionId: string): Promise<void> {
  const result = await settleTransaction(transactionId, { actorId: null, source: 'AUTO_RELEASE' });
  if (!result.ok) {
    // "buyer receipt not confirmed" is a TERMINAL no-op for the timer: the row
    // stays HANDOVER_VERIFIED, the block is audited, and the order waits on
    // the buyer's answer or an admin resolution. Retrying cannot help, so we
    // deliberately do not throw (no pointless BullMQ backoff loop).
    console.log(`[transaction:release] ${transactionId} not settled: ${result.reason}`);
    return;
  }
  if (result.status === 'HANDOVER_VERIFIED') {
    throw new Error(`payout failed (${result.reason}); BullMQ will retry`);
  }
}
