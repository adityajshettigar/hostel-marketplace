import { pool } from './db';
import { demoModeEnabled } from './demo-policy';
import { TxnRow, transition, writeAudit } from './state-machine';
import { generatePin, encryptQrPayload, encryptSecret, newQrExpiry } from './qr-crypto';
// NOTE: release.ts is NOT imported here on purpose. It imports this module
// (for the demo payout), and importing it back would create a module cycle
// that evaluates at load time in the Next.js route bundle. The caller
// (routes/demo.ts) schedules the normal auto-release job instead.

// ---------------------------------------------------------------------------
// SIMULATION MODE (project demonstration task)
//
// The ordinary walkthrough needs a payment provider at exactly two points:
//
//   1. payment.captured webhook -> escrow LOCKED + handover PIN/QR + release
//      deadline (routes/webhook.ts), and
//   2. the Razorpay payout inside settleTransaction (release.ts).
//
// This module performs those two steps WITHOUT contacting Razorpay, so a
// demonstration can be driven interactively through the real APIs. It is
// deliberately NOT a general bypass:
//
//   • NODE_ENV=production is a hard stop that ignores the flag entirely;
//   • the flag must be EXACTLY 'enabled' in the service env (empty by default,
//     so the adapter is dead code everywhere until someone opts in);
//   • it only ever acts on a transaction the caller is already authorised to
//     act on (the route re-checks buyer/seller ownership with the real JWT);
//   • it only ever acts on rows flagged demo=TRUE, so a normal student's order
//     can never be simulated;
//   • it does NOT skip any state, any gate, or the state machine — it calls
//     the same transition() / writeAudit() / PIN+QR helpers the webhook uses,
//     so the buyer-receipt gate, attempt limits and dispute flow all still
//     apply to a demo transaction exactly as they do to a real one.
//
// Nothing here is ever reported as a real payment: the audit rows are named
// DEMO_*, the payout id is prefixed demo_, and the UI shows the
// "DEMO TRANSACTION - SIMULATED - NO PAYMENT PROCESSED" banner.
// ---------------------------------------------------------------------------

const RELEASE_WINDOW_HOURS = 48;

// Activation policy lives in demo-policy.ts (re-exported for convenience).
export { demoModeEnabled, demoModeRefusal } from './demo-policy';

export type DemoAction =
  | { ok: true; status: string; alreadyDone?: boolean; releaseDeadline?: string }
  | { ok: false; status: string; reason: string };

/**
 * Mirrors the `payment.captured` webhook step for ONE demo transaction:
 * ESCROW_PENDING -> ESCROW_LOCKED -> HANDOVER_PENDING, writing the handover
 * PIN (argon2 hash + AES-256-GCM ciphertext), the QR payload and the release
 * deadline in the same DB transaction, then scheduling the normal auto-release
 * job. Never touches the provider.
 */
export async function simulateEscrowLock(
  txnId: string,
  opts: { actorId: string | null },
): Promise<DemoAction> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const cur = await client.query<TxnRow>(
      'SELECT * FROM transactions WHERE id = $1 FOR UPDATE',
      [txnId],
    );
    const txn = cur.rows[0];
    if (!txn) {
      await client.query('ROLLBACK');
      return { ok: false, status: 'NOT_FOUND', reason: 'transaction not found' };
    }
    if (!txn.demo) {
      await client.query('ROLLBACK');
      return { ok: false, status: txn.status, reason: 'transaction is not a demo transaction' };
    }

    // Recheck under the lock, exactly like the webhook: an idempotent replay,
    // or a row that already moved on, must not re-lock escrow.
    if (txn.status === 'HANDOVER_PENDING' || txn.status === 'HANDOVER_VERIFIED' || txn.status === 'COMPLETED') {
      await client.query('COMMIT');
      return { ok: true, status: txn.status, alreadyDone: true };
    }
    if (txn.status !== 'DEAL_CONFIRMED' && txn.status !== 'ESCROW_PENDING') {
      await client.query('ROLLBACK');
      return { ok: false, status: txn.status, reason: `status is ${txn.status}` };
    }

    if (txn.status === 'DEAL_CONFIRMED') {
      await transition(client, txnId, 'ESCROW_PENDING');
    }
    await transition(client, txnId, 'ESCROW_LOCKED');
    await client.query(
      `UPDATE transactions SET escrow_locked_at = COALESCE(escrow_locked_at, now()) WHERE id = $1`,
      [txnId],
    );

    const { pin, pinHash } = await generatePin();
    const expiresAt = newQrExpiry();
    const qr = encryptQrPayload(txn.id, expiresAt);
    const pinEnc = encryptSecret(pin);
    const releaseDeadline = new Date(Date.now() + RELEASE_WINDOW_HOURS * 60 * 60 * 1000);

    await transition(client, txnId, 'HANDOVER_PENDING');
    await client.query(
      `UPDATE transactions
         SET pin_hash = $2, pin_ciphertext = $3, pin_nonce = $4, pin_generated_at = now(),
             qr_ciphertext = $5, qr_nonce = $6, qr_expires_at = $7,
             release_deadline = $8, failed_attempts = 0, handover_locked = false
       WHERE id = $1`,
      [txn.id, pinHash, pinEnc.ciphertext, pinEnc.nonce, qr.ciphertext, qr.nonce, expiresAt, releaseDeadline],
    );
    await writeAudit(client, {
      transactionId: txnId,
      actorId: opts.actorId,
      action: 'DEMO_ESCROW_LOCKED',
      detail: {
        simulated: true,
        provider: null,
        amountPaise: Number(txn.amount_paise),
        note: 'SIMULATED escrow funding — no payment provider was contacted and no money moved',
      },
    });
    await client.query('COMMIT');

    return { ok: true, status: 'HANDOVER_PENDING', releaseDeadline: releaseDeadline.toISOString() };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** Shape-compatible with razorpay.PayoutResult (plus a simulated marker). */
export type DemoPayout = { ok: true; payoutId: string; status: number; error?: undefined; simulated: true };

/**
 * Drop-in stand-in for createPayout(), used by settleTransaction ONLY when the
 * row is demo-flagged and SIMULATION MODE is on. The id is intentionally
 * obvious (`demo_payout_…`) and is never a Razorpay id, so no report, log or
 * receipt can present it as a real transfer.
 */
export async function simulateDemoPayout(params: {
  txnId: string;
  amountPaise: number;
}): Promise<DemoPayout> {
  return {
    ok: true,
    payoutId: `demo_payout_${params.txnId.replace(/-/g, '').slice(0, 16)}`,
    status: 200,
    simulated: true,
  };
}
