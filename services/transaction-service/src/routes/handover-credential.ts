import { NextResponse } from 'next/server';
import { pool } from '../db';
import { requireAuth, jsonError, notFound, internalError, isAdminUserId } from '../handlers';
import { TxnRow } from '../state-machine';
import { decryptSecret, decryptQrPayload } from '../qr-crypto';

// ---------------------------------------------------------------------------
// GET /api/transactions/:id/handover-credential — BUYER ONLY (H1 closeout).
//
// Returns the 4-digit PIN and the QR payload string so the buyer can actually
// see their credential on the transaction page (previously the plaintext PIN
// existed only inside the Razorpay webhook response, which is addressed to
// Razorpay's servers — the buyer could never see it).
//
// - requireAuth: same JWT pattern as every other authenticated route here.
// - Only the buyer of THIS transaction may call it. The seller learns the PIN
//   in person (or scans the QR) — never by querying the API for it. Admins are
//   rejected too: the credential is a buyer secret, not an oversight surface.
// - Strangers get the same no-existence-leak 404 as getTransaction.
// - Returned only while handover is genuinely pending: status
//   HANDOVER_PENDING, not admin-locked, within the release window. Any other
//   state (COMPLETED / DISPUTED / REFUNDED / expired window) → 409 with no
//   credential material. Expired/consumed credentials are not queryable.
// - The PIN is stored AES-256-GCM-encrypted (pin_ciphertext + pin_nonce,
//   written by the webhook); pin_hash stays the verification authority.
// ---------------------------------------------------------------------------

const QR_SCHEME = 'txn://';

type AuthLike = { sub: string; role?: unknown };

function isAdminCaller(auth: AuthLike): boolean {
  // Same precedence as requireAdmin: signed role claim first, env allowlist
  // fallback for legacy tokens.
  if (typeof auth.role === 'string' && auth.role.length > 0) return auth.role === 'admin';
  return isAdminUserId(auth.sub);
}

export async function getHandoverCredential(request: Request, id: string) {
  try {
    const auth = await requireAuth(request);
    if ('response' in auth) return auth.response;

    const res = await pool.query<TxnRow>('SELECT * FROM transactions WHERE id = $1', [id]);
    const txn = res.rows[0];
    if (!txn) return notFound();

    if (txn.buyer_id === auth.auth.sub) {
      // ok — the only caller who may proceed
    } else if (txn.seller_id === auth.auth.sub || isAdminCaller(auth.auth)) {
      return jsonError(403, 'FORBIDDEN', 'Only the buyer can retrieve the handover credential');
    } else {
      return notFound(); // no existence leak for strangers
    }

    // Only while handover is actually pending: usable state + not locked.
    if (txn.status !== 'HANDOVER_PENDING' || txn.handover_locked) {
      return jsonError(
        409,
        'NOT_AVAILABLE',
        `No handover credential available while the transaction is ${txn.status}${txn.handover_locked ? ' (handover locked)' : ''}`,
      );
    }

    // Not past the handover window.
    if (txn.release_deadline && new Date(txn.release_deadline).getTime() <= Date.now()) {
      return jsonError(409, 'NOT_AVAILABLE', 'The handover window has expired');
    }

    if (!txn.pin_ciphertext || !txn.pin_nonce) {
      return jsonError(409, 'NOT_AVAILABLE', 'No PIN has been generated for this transaction yet');
    }

    const pin = decryptSecret(txn.pin_ciphertext, txn.pin_nonce);
    if (!pin) {
      return internalError('getHandoverCredential', new Error('PIN decryption failed (key mismatch?)'));
    }

    // QR: rebuild the same string format the seller's scanner feed accepts
    // (txn://<ciphertext>|<nonce>) — what a QR code rendered from this value
    // would encode. Only if the stored payload is intact.
    let qr: string | null = null;
    if (txn.qr_ciphertext && txn.qr_nonce) {
      const payload = decryptQrPayload(txn.qr_ciphertext, txn.qr_nonce);
      if (payload && qrIsValidForTransactionSafe(payload, txn.id)) {
        qr = `${QR_SCHEME}${txn.qr_ciphertext}|${txn.qr_nonce}`;
      }
    }

    return NextResponse.json({
      transactionId: txn.id,
      status: txn.status,
      releaseDeadline:
        txn.release_deadline instanceof Date ? txn.release_deadline.toISOString() : txn.release_deadline,
      credential: {
        pin,
        qr,
      },
    });
  } catch (err) {
    return internalError('getHandoverCredential', err);
  }
}

function qrIsValidForTransactionSafe(payload: { transactionId: string; expiresAt: string }, txnId: string): boolean {
  return payload.transactionId === txnId;
}
