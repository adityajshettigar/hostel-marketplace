import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/db';
import { requireAuth, jsonError, notFound, internalError } from '@/handlers';
import { bearerToken } from '@/auth';
import { TxnRow, FulfRequestRow } from '@/state-machine';
import { fetchOfferFromMarketplace } from '@/marketplace';
import { serializeFulfill, serializeTxn, startDelivery } from '@/routes/start-delivery';

/**
 * GET /api/transaction/fulfill/:offerId — the order view shared by My Orders,
 * the Purchases dialog and the transactions page. `role` and `offerStatus` come
 * from the authoritative marketplace offer; `fulfill` is null until the seller
 * starts delivery. Strangers get 404.
 */
export async function GET(request: NextRequest, ctx: { params: { offerId: string } }) {
  try {
    const auth = await requireAuth(request);
    if ('response' in auth) return auth.response;
    const user = auth.auth;
    const offerId = decodeURIComponent(ctx.params.offerId);
    const token = bearerToken(request) ?? '';

    const offerResult = await fetchOfferFromMarketplace(offerId, token);
    if (!offerResult.ok) {
      if (offerResult.status === 404 || offerResult.status === undefined) return notFound();
      return jsonError(502, 'MARKETPLACE_RESPONSE_FAILED', 'Could not verify the offer from marketplace');
    }
    const offer = offerResult.offer;
    if (!offer) return notFound();
    const party =
      offer.buyerId === user.sub
        ? 'buyer'
        : offer.listing?.sellerId === user.sub
          ? 'seller'
          : null;
    if (!party) return notFound();

    const row = await pool.query<FulfRequestRow>(
      'SELECT * FROM fulfilment_tracking WHERE offer_id = $1',
      [offerId],
    );
    const txnRow = await pool.query<TxnRow>('SELECT * FROM transactions WHERE offer_id = $1', [offerId]);

    return NextResponse.json({
      fulfill: row.rows[0] ? serializeFulfill(row.rows[0]) : null,
      transaction: txnRow.rows[0] ? serializeTxn(txnRow.rows[0]) : null,
      role: party,
      offerStatus: offer.status,
    });
  } catch (err) {
    return internalError('getFulfillment', err);
  }
}

/** Alias of POST /api/fulfill/:offerId/startDelivery — same code path. */
export async function POST(request: NextRequest, ctx: { params: { offerId: string } }) {
  return startDelivery(request, ctx.params.offerId);
}
