import { NextResponse } from 'next/server';
import { pool } from '../db';
import {
  requireAuth,
  jsonError,
  notFound,
  internalError,
} from '../handlers';
import { bearerToken } from '../auth';
import { TxnRow, FulfRequestRow, FulfillmentStatus, transitionFulfillment, writeAudit, FULFILMENT_STATUSES } from '../state-machine';
import { fetchOfferFromMarketplace } from '../marketplace';

function isoOrNull(v: Date | string | null): string | null {
  if (v === null) return null;
  return v instanceof Date ? v.toISOString() : new Date(v).toISOString();
}

function isoNow(v: Date | string | null): string | null {
  return isoOrNull(v);
}

type OrderRow = {
  id: string;
  offerId: string;
  transactionId: string | null;
  status: FulfillmentStatus;
  createdAt: string | null;
  updatedAt: string | null;
} | null;

type MinTxn = {
  id: string;
  status: string;
  amountPaise: number;
  createdAt: string | null;
} | null;

async function txnFromOffer(offerId: string): Promise<MinTxn> {
  const r = await pool.query<TxnRow>('SELECT * FROM transactions WHERE offer_id = $1', [offerId]);
  if (!r.rows[0]) return null;
  return {
    id: r.rows[0].id,
    status: r.rows[0].status,
    amountPaise: Number(r.rows[0].amount_paise),
    createdAt: isoOrNull(r.rows[0].created_at),
  };
}

function fulfillFromRow(row: FulfRequestRow): OrderRow {
  return {
    id: row.id,
    offerId: row.offer_id,
    transactionId: row.transaction_id,
    status: row.status as FulfillmentStatus,
    createdAt: isoNow(row.created_at),
    updatedAt: isoNow(row.updated_at),
  };
}

// GET /api/fulfill/:offerId — reads the fulfilment tracking row for an
// accepted deal. Serves the buyer's My Orders timeline (and seller's relevant
// order detail). Only the buyer/seller of the offer may read it (404 for
// others — no existence leak).
export async function getFulfillment(request: Request, offerId: string) {
  try {
    const auth = await requireAuth(request);
    if ('response' in auth) return auth.response;
    const token = bearerToken(request) ?? '';
    const offerResult = await fetchOfferFromMarketplace(offerId, token);
    if (!offerResult.ok) {
      if (offerResult.status === 404 || offerResult.status === undefined) return notFound();
      return jsonError(502, 'MARKETPLACE_RESPONSE_FAILED', 'Could not verify the offer from marketplace');
    }
    const offer = offerResult.offer;
    if (!offer) return notFound();
    const party =
      offer.buyerId === auth.auth.sub
        ? 'buyer'
        : offer.listing?.sellerId === auth.auth.sub
          ? 'seller'
          : null;
    if (!party) return notFound();

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const row = await client.query<FulfRequestRow>(
        'SELECT * FROM fulfilment_tracking WHERE offer_id = $1 FOR UPDATE',
        [offerId],
      );
      await client.query('COMMIT');
      if (!row.rows[0]) return notFound();
      const txn = await txnFromOffer(offerId);
      return NextResponse.json({
        fulfill: fulfillFromRow(row.rows[0]),
        transaction: txn,
      });
    } finally {
      client.release();
    }
  } catch (err) {
    return internalError('getFulfillment', err);
  }
}

// POST /api/fulfill/:offerId/deliver — buyer-side "Yes" branch: the buyer
// confirms they received the item. Requires the seller to have already posted
// IN_DELIVERY. Advances to DELIVERED via a guarded transition inside a FOR
// UPDATE transaction; rejected/withdrawn deals never reach this path.
export async function deliver(request: Request, offerId: string) {
  try {
    const auth = await requireAuth(request);
    if ('response' in auth) return auth.response;
    const token = bearerToken(request) ?? '';
    const offerResult = await fetchOfferFromMarketplace(offerId, token);
    if (!offerResult.ok || !offerResult.offer) return notFound();

    const offer = offerResult.offer;
    if (!offer.buyerId || offer.buyerId !== auth.auth.sub) {
      return jsonError(403, 'FORBIDDEN', 'Only the buyer of this offer can confirm delivery received');
    }
    if (offer.status !== 'ACCEPTED') {
      return jsonError(409, 'OFFER_NOT_ACCEPTED', `Offer is ${offer.status}; delivery requires an accepted offer`);
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const prepared = await client.query<FulfRequestRow>(
        'SELECT * FROM fulfilment_tracking WHERE offer_id = $1 FOR UPDATE',
        [offerId],
      );
      const row = prepared.rows[0];
      if (!row) {
        await client.query('ROLLBACK');
        return notFound();
      }
      if (row.status !== 'IN_DELIVERY') {
        await client.query('ROLLBACK');
        return jsonError(409, 'INVALID_TRANSITION', `Delivery requires IN_DELIVERY first; current stage is ${row.status}`);
      }

      const delivered = await transitionFulfillment(client, offerId, 'DELIVERED');
      await writeAudit(client, {
        transactionId: delivered.transaction_id,
        actorId: auth.auth.sub,
        action: 'FULFILLMENT_DELIVERED',
        detail: { offerId, buyerConfirmed: true },
      });
      await client.query('COMMIT');

      const txn = await txnFromOffer(offerId);
      return NextResponse.json({
        fulfill: fulfillFromRow(delivered),
        transaction: txn,
        message: 'Order marked delivered. The seller will be notified by the existing handover flow.',
      });
    } catch (err) {
      await client.query('ROLLBACK');
      if (err instanceof Error && err.message.includes('Illegal fulfilment transition')) {
        const refreshed = await pool.query<FulfRequestRow>('SELECT * FROM fulfilment_tracking WHERE offer_id = $1', [offerId]);
        const row = refreshed.rows[0];
        if (row?.status === 'DELIVERED') {
          const txn = await txnFromOffer(offerId);
          return NextResponse.json({
            fulfill: fulfillFromRow(row),
            transaction: txn,
          });
        }
      }
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    return internalError('deliver', err);
  }
}
