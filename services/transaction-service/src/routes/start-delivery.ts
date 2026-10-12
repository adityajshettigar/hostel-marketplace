import { NextResponse } from 'next/server';
import { pool } from '../db';
import { requireAuth, jsonError, notFound, internalError } from '../handlers';
import { bearerToken } from '../auth';
import { TxnRow, FulfRequestRow, transitionFulfillment, writeAudit } from '../state-machine';
import { fetchOfferFromMarketplace } from '../marketplace';

// ---------------------------------------------------------------------------
// POST /api/fulfill/:offerId/startDelivery — SELLER only. The ONE code path
// that moves an order to "Item being brought to your Room" (the POST
// /api/fulfill/:offerId alias calls straight through to this function, so the
// two entry points can never drift apart).
//
// Preconditions, all checked server-side:
//   - the caller is the listing seller of THIS offer (authoritative offer read)
//   - the offer is ACCEPTED
//   - the escrow transaction exists and is FUNDED (ESCROW_LOCKED or beyond):
//     stage 3 must be complete before stage 4 can begin.
// ---------------------------------------------------------------------------

const ESCROW_FUNDED_STATUSES = new Set([
  'ESCROW_LOCKED',
  'HANDOVER_PENDING',
  'HANDOVER_VERIFIED',
  'COMPLETED',
]);

function isoOrNull(v: Date | string | null): string | null {
  if (v === null) return null;
  return v instanceof Date ? v.toISOString() : new Date(v).toISOString();
}

export function serializeFulfill(row: FulfRequestRow) {
  return {
    id: row.id,
    offerId: row.offer_id,
    transactionId: row.transaction_id,
    status: row.status as 'ORDER_PLACED' | 'ORDER_ACCEPTED' | 'IN_DELIVERY' | 'DELIVERED',
    buyerReceived: row.buyer_received,
    buyerConfirmedAt: isoOrNull(row.buyer_confirmed_at),
    buyerDeclinedAt: isoOrNull(row.buyer_declined_at),
    createdAt: isoOrNull(row.created_at),
    updatedAt: isoOrNull(row.updated_at),
  };
}

export function serializeTxn(row: TxnRow) {
  return {
    id: row.id,
    offerId: row.offer_id,
    listingId: row.listing_id,
    buyerId: row.buyer_id,
    sellerId: row.seller_id,
    amountPaise: Number(row.amount_paise),
    quantity: row.quantity,
    currency: row.currency,
    status: row.status as string,
    razorpayOrderId: row.razorpay_order_id,
    payoutId: row.payout_id,
    releaseDeadline: isoOrNull(row.release_deadline),
    handoverLocked: row.handover_locked,
    failedAttempts: row.failed_attempts,
    disputeId: row.dispute_id,
    createdAt: isoOrNull(row.created_at),
    updatedAt: isoOrNull(row.updated_at),
  };
}

export async function txnForOffer(offerId: string): Promise<TxnRow | null> {
  const r = await pool.query<TxnRow>('SELECT * FROM transactions WHERE offer_id = $1', [offerId]);
  return r.rows[0] ?? null;
}

export async function startDelivery(request: Request, offerIdParam: string) {
  try {
    const auth = await requireAuth(request);
    if ('response' in auth) return auth.response;
    const user = auth.auth;
    const offerId = decodeURIComponent(offerIdParam);
    const token = bearerToken(request) ?? '';

    const offerResult = await fetchOfferFromMarketplace(offerId, token);
    if (!offerResult.ok) {
      if (offerResult.status === 404 || offerResult.status === undefined) return notFound();
      return jsonError(502, 'MARKETPLACE_RESPONSE_FAILED', 'Could not verify the offer from marketplace');
    }
    const offer = offerResult.offer;
    if (!offer) return notFound();
    const sellerId = offer.listing?.sellerId;
    if (!sellerId || sellerId !== user.sub) {
      return jsonError(403, 'FORBIDDEN', 'Only the listing seller can start delivery');
    }
    if (offer.status !== 'ACCEPTED') {
      return jsonError(409, 'OFFER_NOT_ACCEPTED', `Offer is ${offer.status}; startDelivery requires acceptance`);
    }

    // Escrow precondition (order timeline stage 3): never hand over an item
    // whose payment is not actually held in escrow.
    const existing = await txnForOffer(offerId);
    if (!existing) {
      return jsonError(409, 'NO_TRANSACTION', 'No escrow transaction exists for this offer yet');
    }
    if (!ESCROW_FUNDED_STATUSES.has(existing.status)) {
      return jsonError(
        409,
        'ESCROW_NOT_FUNDED',
        `Delivery requires the buyer's payment to be held in escrow (current escrow status: ${existing.status})`,
      );
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const created = await client.query<FulfRequestRow>(
        `INSERT INTO fulfilment_tracking (offer_id, transaction_id, status, created_at, updated_at)
         VALUES ($1, $2, 'ORDER_PLACED', now(), now())
         ON CONFLICT (offer_id) DO UPDATE SET updated_at = now()
         RETURNING *`,
        [offerId, existing.id],
      );
      const row = created.rows[0];
      if (!row) {
        await client.query('ROLLBACK');
        return internalError('startDelivery', new Error('Fulfillment tracking row could not be created'));
      }

      if (row.status === 'ORDER_PLACED') {
        try {
          await transitionFulfillment(client, offerId, 'ORDER_ACCEPTED');
        } catch {
          await client.query('ROLLBACK');
          return internalError('startDelivery', new Error('Cannot advance fulfilment from ORDER_PLACED'));
        }
      }

      const delivered = await transitionFulfillment(client, offerId, 'IN_DELIVERY');
      await writeAudit(client, {
        transactionId: delivered.transaction_id,
        actorId: user.sub,
        action: 'FULFILLMENT_START_DELIVERY',
        detail: { offerId },
      });
      await client.query('COMMIT');

      const txn = await txnForOffer(offerId);
      return NextResponse.json({
        fulfill: serializeFulfill(delivered),
        transaction: txn ? serializeTxn(txn) : null,
        message: 'Delivery started. The item is being brought to the buyer room.',
      });
    } catch (err) {
      await client.query('ROLLBACK');
      if (err instanceof Error && err.message.includes('Illegal fulfilment transition')) {
        const refreshed = await pool.query<FulfRequestRow>(
          'SELECT * FROM fulfilment_tracking WHERE offer_id = $1',
          [offerId],
        );
        const row = refreshed.rows[0];
        if (row?.status === 'IN_DELIVERY') {
          const txn = await txnForOffer(offerId);
          return NextResponse.json({
            fulfill: serializeFulfill(row),
            transaction: txn ? serializeTxn(txn) : null,
          });
        }
      }
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    return internalError('startDelivery', err);
  }
}
