import { NextResponse } from 'next/server';
import { pool } from '../db';
import { requireAuth, jsonError, notFound, internalError } from '../handlers';
import { TxnRow, transition, writeAudit, transitionErrorResponse } from '../state-machine';
import { createRazorpayOrder, RazorpayApiError, RazorpayConfigError } from '../razorpay';
import { serializeTransaction } from './transactions';

// ---------------------------------------------------------------------------
// POST /api/transactions/:id/escrow/init — buyer only. Creates a Razorpay
// Order (TEST MODE) for the agreed amount (integer paise), status
// DEAL_CONFIRMED → ESCROW_PENDING, returns the order id for Razorpay Checkout.
// ---------------------------------------------------------------------------

export async function initEscrow(request: Request, id: string) {
  const client = await pool.connect();
  try {
    const auth = await requireAuth(request);
    if ('response' in auth) return auth.response;

    await client.query('BEGIN');
    const cur = await client.query<TxnRow>('SELECT * FROM transactions WHERE id = $1 FOR UPDATE', [id]);
    const txn = cur.rows[0];
    if (!txn) {
      await client.query('ROLLBACK');
      return notFound();
    }
    if (txn.buyer_id !== auth.auth.sub) {
      await client.query('ROLLBACK');
      return jsonError(403, 'FORBIDDEN', 'Only the buyer can initiate escrow');
    }
    if (txn.status !== 'DEAL_CONFIRMED') {
      await client.query('ROLLBACK');
      return jsonError(
        409,
        'INVALID_TRANSITION',
        `Transaction is ${txn.status}; escrow can only be initiated from DEAL_CONFIRMED`,
      );
    }

    // Razorpay Order for the agreed price. The row lock is held across the
    // API call so check + transition + order-id write are atomic (single DB
    // transaction, per Phase 6 non-negotiables).
    let order;
    try {
      order = await createRazorpayOrder({
        amountPaise: Number(txn.amount_paise),
        receipt: `txn_${txn.id.slice(0, 8)}`,
      });
    } catch (err) {
      await client.query('ROLLBACK');
      if (err instanceof RazorpayConfigError) {
        return jsonError(503, 'RAZORPAY_NOT_CONFIGURED', err.message);
      }
      if (err instanceof RazorpayApiError) {
        return jsonError(502, 'RAZORPAY_ORDER_FAILED', err.message);
      }
      throw err;
    }

    const updated = await transition(client, txn.id, 'ESCROW_PENDING');
    await client.query(`UPDATE transactions SET razorpay_order_id = $2 WHERE id = $1`, [
      txn.id,
      order.id,
    ]);
    await writeAudit(client, {
      transactionId: txn.id,
      actorId: auth.auth.sub,
      action: 'ESCROW_INITIATED',
      detail: { razorpayOrderId: order.id, amountPaise: Number(txn.amount_paise) },
    });
    await client.query('COMMIT');

    return NextResponse.json({
      transaction: serializeTransaction({ ...updated, razorpay_order_id: order.id }),
      razorpayOrder: { id: order.id, amount: order.amount, currency: order.currency },
      keyIdHint: 'frontend uses RAZORPAY_KEY_ID with Razorpay Checkout (test mode)',
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    const tr = transitionErrorResponse(err);
    if (tr) return tr;
    return internalError('initEscrow', err);
  } finally {
    client.release();
  }
}
