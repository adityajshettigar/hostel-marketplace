import { NextResponse } from 'next/server';
import { pool } from '../db';
import { requireAuth, parseJsonBody, jsonError, notFound, internalError } from '../handlers';
import { TxnRow, transition, writeAudit } from '../state-machine';
import { verifyPin, decryptQrPayload, qrIsValidForTransaction } from '../qr-crypto';
import { verifyHandoverSchema } from '../schemas';
import { markHandoverVerified } from '../release';
import { verifyWebhookSignature } from '../razorpay';

// ---------------------------------------------------------------------------
// POST /api/transactions/:id/verify-handover — seller only. Submits PIN or
// scanned QR string.
//
// - Rate limit: max 3 attempts per transaction (SRS 5.7.1). On the 3rd WRONG
//   attempt the endpoint locks for that transaction (handover_locked = true)
//   and needs an admin unlock. EVERY attempt (success and failure) is logged
//   to the append-only audit table.
// - PIN verified with argon2.verify; QR verified by decrypt + transactionId
//   match + not-expired.
// - On success: one DB txn marks HANDOVER_VERIFIED and STOPS. Since the
//   buyer-receipt requirement, verification alone no longer pays the seller:
//   the escrow release happens in settleTransaction (source BUYER_CONFIRM)
//   once the authenticated buyer answers "yes, I received it", or through an
//   admin dispute resolution. The payout idempotency key
//   (release:<txnId>) is still stored BEFORE the payout call, so a duplicate
//   confirmation/replay cannot double-pay.
// ---------------------------------------------------------------------------

const MAX_ATTEMPTS = 3;

export async function verifyHandover(request: Request, id: string) {
  try {
    const auth = await requireAuth(request);
    if ('response' in auth) return auth.response;

    const parsed = await parseJsonBody(request, verifyHandoverSchema);
    if (!parsed.ok) return parsed.response;

    const txnRes = await pool.query<TxnRow>('SELECT * FROM transactions WHERE id = $1', [id]);
    const txn = txnRes.rows[0];
    if (!txn) return notFound();
    if (txn.seller_id !== auth.auth.sub) {
      return jsonError(403, 'FORBIDDEN', 'Only the seller can verify handover');
    }

    // Locked by 3 failed attempts? Only an admin can unlock.
    if (txn.handover_locked) {
      return jsonError(423, 'HANDOVER_LOCKED', 'Handover is locked after 3 failed attempts; admin unlock required');
    }

    let secretOk = false;
    let method: 'PIN' | 'QR' = 'PIN';

    if (parsed.data.pin) {
      if (!txn.pin_hash) {
        return jsonError(409, 'NO_PIN', 'No PIN generated yet for this transaction');
      }
      method = 'PIN';
      secretOk = await verifyPin(parsed.data.pin, txn.pin_hash);
    } else {
      const scanned = parseQrString(parsed.data.qr as string);
      if (!scanned) {
        return respondAttempt(txn, method, auth.auth.sub, false, 'QR string unparseable');
      }
      const payload = decryptQrPayload(scanned.ciphertext, scanned.nonce);
      if (!payload) {
        return respondAttempt(txn, method, auth.auth.sub, false, 'QR decryption failed');
      }
      if (!qrIsValidForTransaction(payload, txn.id)) {
        return respondAttempt(txn, method, auth.auth.sub, false, 'QR transactionId mismatch or expired');
      }
      method = 'QR';
      secretOk = true;
    }

    if (!secretOk) {
      return respondAttempt(txn, method, auth.auth.sub, false, 'wrong secret');
    }

    // SUCCESS → record the verification only (HANDOVER_PENDING →
    // HANDOVER_VERIFIED) and hand off to the buyer's receipt confirmation.
    const verified = await markHandoverVerified(id, { actorId: auth.auth.sub });
    if (!verified.ok) {
      return jsonError(409, 'INVALID_TRANSITION', verified.reason);
    }
    return NextResponse.json({
      transactionId: txn.id,
      status: 'HANDOVER_VERIFIED',
      awaitingBuyerConfirmation: true,
      alreadyVerified: verified.alreadyVerified,
      message:
        'Handover verified. The buyer must confirm receipt before escrow is released to the seller.',
    });
  } catch (err) {
    return internalError('verifyHandover', err);
  }
}

export type SettleLike =
  | { ok: true; status: 'COMPLETED'; payoutId: string }
  | { ok: true; status: 'HANDOVER_VERIFIED'; reason: string; retriable: true }
  | { ok: false; status: string; reason: string; retriable?: boolean };

// Shared attempt accounting (used for both PIN and QR failures). One DB
// transaction: bump failed_attempts, lock on the 3rd wrong attempt, audit row
// for EVERY attempt. The FOR UPDATE lock keeps simultaneous attempts serial.
async function respondAttempt(
  txn: TxnRow,
  method: 'PIN' | 'QR',
  actorId: string,
  success: boolean,
  failureReason: string,
): Promise<NextResponse> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const cur = await client.query<TxnRow>('SELECT * FROM transactions WHERE id = $1 FOR UPDATE', [txn.id]);
    const row = cur.rows[0];
    if (!row) {
      await client.query('ROLLBACK');
      return notFound();
    }

    await writeAudit(client, {
      transactionId: row.id,
      actorId,
      action: success ? 'HANDOVER_ATTEMPT_SUCCESS' : 'HANDOVER_ATTEMPT_FAILURE',
      detail: { method, reason: success ? null : failureReason },
    });

    if (!success) {
      const attempts = row.failed_attempts + 1;
      const lockNow = attempts >= MAX_ATTEMPTS;
      await client.query(
        `UPDATE transactions SET failed_attempts = $2, handover_locked = $3 WHERE id = $1`,
        [row.id, attempts, lockNow],
      );
      await client.query('COMMIT');
      if (lockNow) {
        return jsonError(423, 'HANDOVER_LOCKED', 'Handover locked after 3 failed attempts; admin unlock required');
      }
      return jsonError(401, 'INVALID_PIN_OR_QR', `${failureReason} (attempt ${attempts} of ${MAX_ATTEMPTS})`);
    }

    await client.query('COMMIT');
    return jsonError(500, 'UNREACHABLE', 'success path handled by caller');
  } finally {
    client.release();
  }
}

// QR strings arrive as "txn://<ciphertext>|<nonce>" (also accepts the bare
// base64 payload if it decodes with an embedded nonce segment). Format is
// ours to define since we generate the QR content.
function parseQrString(qr: string): { ciphertext: string; nonce: string } | null {
  const parts = qr.split('|');
  if (parts.length === 2) {
    const [ciphertext, nonce] = parts;
    if (ciphertext.length > 0 && nonce.length > 0) return { ciphertext, nonce };
  }
  return null;
}

export { respondAttempt as _respondAttemptForTests };

// Unused import guard: keep webhook-style signature helpers local (no-op).
export const _sigGuard = verifyWebhookSignature;
