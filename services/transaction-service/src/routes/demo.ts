import { NextResponse } from 'next/server';
import { z } from 'zod';
import { pool } from '../db';
import { requireAuth, parseJsonBody, jsonError, notFound, internalError } from '../handlers';
import { TxnRow, writeAudit } from '../state-machine';
import { demoModeRefusal, simulateEscrowLock } from '../demo';
import { scheduleReleaseJob } from '../release';
import { serializeTransaction } from './transactions';

// ---------------------------------------------------------------------------
// POST /api/transactions/:id/demo/fund — SIMULATION MODE ONLY.
//
// Replaces the `payment.captured` webhook step for a demonstration so the
// walkthrough can be driven interactively without a payment provider:
// escrow LOCKED + handover PIN/QR + release deadline, through the SAME state
// machine and the same helpers the webhook uses.
//
// Guards (all of them, in order):
//   1. demoModeRefusal()  -> 404 unless NOT production AND DEMO_MODE=enabled
//      (so the endpoint does not even advertise itself outside the demo env);
//   2. real JWT via requireAuth, and the caller must be the BUYER of this
//      transaction — the same ownership rule as POST /escrow/init;
//   3. the row must be in a state that can still be funded (DEAL_CONFIRMED or
//      ESCROW_PENDING); anything else is a 409 from the state machine;
//   4. the body must explicitly acknowledge the simulation with demo:true.
//
// Side effects: sets demo = TRUE on the caller's own transaction (that flag is
// what the UI banner, the admin filter and the reset command key off) and
// writes an append-only DEMO_ESCROW_LOCKED audit row. No provider is called,
// no Razorpay id is minted, no money moves.
// ---------------------------------------------------------------------------

const demoFundBody = z.object({ demo: z.literal(true) });

export async function fundDemoEscrow(request: Request, id: string) {
  // 1. Environment gate first: refuse before doing any work, and refuse the
  //    same way an absent resource would (no feature advertisement).
  const refusal = demoModeRefusal();
  if (refusal) return jsonError(refusal.status, refusal.error, refusal.message);

  try {
    // 2. Real authentication + real ownership.
    const auth = await requireAuth(request);
    if ('response' in auth) return auth.response;

    const parsed = await parseJsonBody(request, demoFundBody);
    if (!parsed.ok) return parsed.response;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const cur = await client.query<TxnRow>(
        'SELECT * FROM transactions WHERE id = $1 FOR UPDATE',
        [id],
      );
      const txn = cur.rows[0];
      if (!txn) {
        await client.query('ROLLBACK');
        return notFound();
      }
      if (txn.buyer_id !== auth.auth.sub) {
        await client.query('ROLLBACK');
        return jsonError(403, 'FORBIDDEN', 'Only the buyer can fund the escrow');
      }
      if (txn.status !== 'DEAL_CONFIRMED' && txn.status !== 'ESCROW_PENDING') {
        await client.query('ROLLBACK');
        return jsonError(
          409,
          'INVALID_TRANSITION',
          `Transaction is ${txn.status}; it can only be funded from DEAL_CONFIRMED`,
        );
      }

      // 3. Flag THIS row as a demo transaction (idempotent) — the marker the
      //    UI, the admin filter and the reset command rely on.
      if (!txn.demo) {
        await client.query(`UPDATE transactions SET demo = TRUE, updated_at = now() WHERE id = $1`, [
          id,
        ]);
        await writeAudit(client, {
          transactionId: id,
          actorId: auth.auth.sub,
          action: 'DEMO_MARKED',
          detail: { simulated: true, note: 'transaction flagged as a simulated demonstration order' },
        });
      }
      await client.query('COMMIT');
    } finally {
      client.release();
    }

    // 4. The real simulation — same state machine, same PIN/QR helpers, no
    //    provider. Throws nothing back to the caller that could leak secrets.
    const result = await simulateEscrowLock(id, { actorId: auth.auth.sub });
    if (!result.ok) {
      if (result.status === 'NOT_FOUND') return notFound();
      return jsonError(409, 'INVALID_TRANSITION', result.reason);
    }

    // Same 48h auto-release job the webhook schedules, so a demo order has the
    // ordinary timer behaviour (and cannot sit funded forever).
    if (result.releaseDeadline) {
      try {
        await scheduleReleaseJob({ transactionId: id, releaseDeadline: new Date(result.releaseDeadline) });
      } catch (err) {
        console.error('[transaction:demoFundEscrow] release job scheduling failed', err);
      }
    }

    const fresh = await pool.query<TxnRow>('SELECT * FROM transactions WHERE id = $1', [id]);
    const row = fresh.rows[0];
    if (!row) return notFound();

    return NextResponse.json({
      transaction: serializeTransaction(row),
      simulated: true,
      alreadyDone: Boolean(result.alreadyDone),
      note: 'SIMULATED escrow funding — no payment provider was contacted and no money moved.',
    });
  } catch (err) {
    return internalError('fundDemoEscrow', err);
  }
}
