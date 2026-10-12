import { NextResponse } from 'next/server';
import { pool } from '../db';
import {
  requireAuth,
  parseJsonBody,
  parseQuery,
  jsonError,
  notFound,
  internalError,
  requireAdmin,
} from '../handlers';
import { createTransactionSchema } from '../schemas';
import { bearerToken } from '../auth';
import { fetchOfferFromMarketplace } from '../marketplace';
import { TxnRow } from '../state-machine';
import { recoverPendingReleasesFromDb } from '../release';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// POST /api/transactions — called only after marketplace-service confirms an
// offer is ACCEPTED (verified by CALLING marketplace, never trusting the
// client). Creates the row DEAL_CONFIRMED and boots the lazy release runtime
// (BullMQ worker + DB recovery) on first request.
// ---------------------------------------------------------------------------

const listTxnQuery = z.object({
  role: z.enum(['buying', 'selling']).default('buying'),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export function serializeTransaction(row: TxnRow) {
  return {
    id: row.id,
    offerId: row.offer_id,
    listingId: row.listing_id,
    buyerId: row.buyer_id,
    sellerId: row.seller_id,
    amountPaise: Number(row.amount_paise), // integer paise out
    quantity: row.quantity,
    currency: row.currency,
    status: row.status,
    razorpayOrderId: row.razorpay_order_id,
    payoutId: row.payout_id,
    releaseDeadline: isoOrNull(row.release_deadline),
    handoverLocked: row.handover_locked,
    failedAttempts: row.failed_attempts,
    disputeId: row.dispute_id,
    /** TRUE only for orders created through the development-only demo adapter
     *  (SIMULATION MODE). The UI renders the "DEMO TRANSACTION - SIMULATED -
     *  NO PAYMENT PROCESSED" banner on these and the admin console can filter
     *  them out of the live view. */
    demo: row.demo ?? false,
    createdAt: isoOrNull(row.created_at),
    updatedAt: isoOrNull(row.updated_at),
  };
}

function isoOrNull(v: Date | string | null): string | null {
  if (v === null) return null;
  return v instanceof Date ? v.toISOString() : new Date(v).toISOString();
}

export async function createTransaction(request: Request) {
  try {
    const auth = await requireAuth(request);
    if ('response' in auth) return auth.response;

    const token = bearerToken(request) ?? '';
    const parsed = await parseJsonBody(request, createTransactionSchema);
    if (!parsed.ok) return parsed.response;
    const { offerId } = parsed.data;

    // 1. Verify with marketplace (fail-closed): offer must be ACCEPTED and
    //    belong to the caller (buyer).
    const offerResult = await fetchOfferFromMarketplace(offerId, token);
    if (!offerResult.ok) {
      return jsonError(502, 'MARKETPLACE_UNAVAILABLE', 'Could not verify the offer; refusing to create a transaction (fail-closed)');
    }
    const offer = offerResult.offer;
    if (offer.status !== 'ACCEPTED') {
      return jsonError(409, 'OFFER_NOT_ACCEPTED', `Offer status is ${offer.status}; only ACCEPTED offers can become transactions`);
    }
    if (offer.buyerId !== auth.auth.sub) {
      return jsonError(403, 'FORBIDDEN', 'Only the buyer of the offer can create the transaction');
    }

    // 2. Create the row (DEAL_CONFIRMED). offer_id UNIQUE → an accepted offer
    //    can only ever produce ONE transaction.
    const sellerId = offer.listing?.sellerId ?? null;
    if (!sellerId) {
      return jsonError(502, 'MARKETPLACE_RESPONSE_INVALID', 'Offer response did not include the listing seller');
    }
    const res = await pool.query<TxnRow>(
      `INSERT INTO transactions (offer_id, listing_id, buyer_id, seller_id, amount_paise, quantity, demo)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (offer_id) DO UPDATE SET updated_at = now()
       RETURNING *`,
      // offeredPrice is a RUPEES decimal string ("800.00"); the column is
      // integer PAISE — convert, don't store the rupee number as paise.
      // A DEMO listing (marketplace `demo` flag) makes its orders demo too, so
      // a simulated item can never silently become a real-looking order.
      [
        offer.id,
        offer.listingId,
        auth.auth.sub,
        sellerId,
        Math.round(Number(offer.offeredPrice) * 100),
        offer.quantity,
        offer.listing?.demo === true,
      ],
    );
    const row = res.rows[0];

    // 3. Lazy runtime boot + DB recovery of pending release jobs (survives
    //    restarts; BullMQ delayed jobs alone do not).
    let recovered = 0;
    try {
      recovered = await recoverPendingReleasesFromDb();
    } catch (err) {
      console.error('[transaction:createTransaction] release runtime recovery failed', err);
    }

    return NextResponse.json(
      {
        transaction: serializeTransaction(row),
        recoveredReleaseJobs: recovered,
      },
      { status: 201 },
    );
  } catch (err) {
    return internalError('createTransaction', err);
  }
}

// GET /api/transactions?role=buying|selling — the caller's transactions.
export async function listTransactions(request: Request) {
  try {
    const auth = await requireAuth(request);
    if ('response' in auth) return auth.response;

    const q = parseQuery(new URL(request.url), listTxnQuery);
    if (!q.ok) return q.response;
    const { role, page, limit } = q.data;

    const col = role === 'buying' ? 'buyer_id' : 'seller_id';
    const res = await pool.query<TxnRow>(
      `SELECT * FROM transactions WHERE ${col} = $1
       ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
      [auth.auth.sub, limit, (page - 1) * limit],
    );

    return NextResponse.json({
      transactions: res.rows.map(serializeTransaction),
      pagination: { page, limit },
    });
  } catch (err) {
    return internalError('listTransactions', err);
  }
}

// GET /api/transactions/:id — buyer, seller, or admin.
export async function getTransaction(request: Request, id: string) {
  try {
    const auth = await requireAuth(request);
    if ('response' in auth) return auth.response;

    const res = await pool.query<TxnRow>('SELECT * FROM transactions WHERE id = $1', [id]);
    const row = res.rows[0];
    if (!row) return notFound();

    const isParty = row.buyer_id === auth.auth.sub || row.seller_id === auth.auth.sub;
    if (!isParty) {
      // QA2 closeout: admin access is decided by the SIGNED role claim minted
      // by identity-service (same requireAdmin guard as disputes/audit), with
      // the env allowlist as legacy fallback. Non-parties always get 404 —
      // no existence leak.
      if (requireAdmin(auth.auth) !== null) return notFound();
    }

    // PIN/QR material NEVER leaves this service after generation moment.
    return NextResponse.json({ transaction: serializeTransaction(row) });
  } catch (err) {
    return internalError('getTransaction', err);
  }
}
