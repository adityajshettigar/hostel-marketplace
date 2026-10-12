import { NextResponse } from 'next/server';
import { z } from 'zod';
import { pool } from '../db';
import { env } from '../env';
import {
  requireAuth,
  parseJsonBody,
  parseQuery,
  getOfferRow,
  getListingRow,
  notFound,
  internalError,
  jsonError,
  ListingRow,
  OfferRow,
} from '../handlers';
import { offerCreateSchema, offerCounterSchema } from '../schemas';
import { hostelGroup } from '../hostels';

// ---------------------------------------------------------------------------
// Offers — negotiation state machine.
//
//   PENDING ──accept──> ACCEPTED        (terminal; only transaction-service
//     │ │                                reads ACCEPTED as "deal confirmed")
//     │ ├──reject───> REJECTED           (terminal)
//     ├──counter───> COUNTERED           (a new child offer is created PENDING)
//     ├──withdraw──> WITHDRAWN           (buyer only, terminal)
//     └──48h───────> EXPIRED             (auto via POST /api/offers/expire)
//
// All transitions are guarded: only the listed transition from PENDING is
// legal; a finalised offer can never change again (e.g. rejecting an
// already-accepted offer → 409 INVALID_TRANSITION).
// ---------------------------------------------------------------------------

export function serializeOffer(row: OfferRow, listing?: ListingRow) {
  return {
    id: row.id,
    listingId: row.listing_id,
    buyerId: row.buyer_id,
    offeredPrice: row.offered_price,
    quantity: row.quantity,
    status: row.status,
    counterOf: row.counter_of,
    ...(listing
      ? {
          listing: {
            id: listing.id,
            title: listing.title,
            sellerId: listing.seller_id,
            price: listing.price,
            status: listing.status,
            demo: listing.demo ?? false,
          },
        }
      : {}),
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
  };
}

// POST /api/offers — any authenticated student may propose on an ACTIVE listing.
export async function createOffer(request: Request) {
  try {
    const auth = await requireAuth(request);
    if ('response' in auth) return auth.response;

    const parsed = await parseJsonBody(request, offerCreateSchema);
    if (!parsed.ok) return parsed.response;
    const b = parsed.data;

    const listing = await getListingRow(b.listingId);
    if (!listing || listing.status !== 'ACTIVE') {
      return notFound(request);
    }
    // MH/LH segregation: no offers across hostels — the listing does not
    // exist as far as the other market's residents are concerned (404).
    if (hostelGroup(listing.seller_block) !== hostelGroup(auth.auth.hostelBlock)) {
      return notFound(request);
    }
    if (listing.seller_id === auth.auth.sub) {
      return jsonError(409, 'OWN_LISTING', 'You cannot make an offer on your own listing', request);
    }
    if (b.quantity > listing.quantity) {
      return jsonError(
        400,
        'QUANTITY_EXCEEDS_STOCK',
        `Listing has only ${listing.quantity} unit(s) available`,
        request,
      );
    }

    const res = await pool.query(
      `INSERT INTO offers (listing_id, buyer_id, offered_price, quantity)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [b.listingId, auth.auth.sub, b.offeredPrice, b.quantity],
    );

    return NextResponse.json(
      { offer: serializeOffer(res.rows[0] as OfferRow, listing) },
      { status: 201 },
    );
  } catch (err) {
    return internalError('createOffer', err, request);
  }
}

// GET /api/offers/:id — introspection endpoint. This is what transaction-service
// calls to verify a deal is confirmed: only status ACCEPTED counts.
export async function getOffer(request: Request, id: string) {
  try {
    const auth = await requireAuth(request);
    if ('response' in auth) return auth.response;

    const offer = await getOfferRow(id);
    if (!offer) return notFound(request);

    // Visible to the buyer, the seller, and any service principal; other users
    // get a 404 (do not leak offer existence).
    const listing = await getListingRow(offer.listing_id);
    if (
      listing &&
      offer.buyer_id !== auth.auth.sub &&
      listing.seller_id !== auth.auth.sub
    ) {
      return notFound(request);
    }

    return NextResponse.json({ offer: serializeOffer(offer, listing ?? undefined) });
  } catch (err) {
    return internalError('getOffer', err, request);
  }
}

// GET /api/offers?listingId=...&role=buying|selling — list own offers.
const offerListQuery = z.object({
  listingId: z.string().uuid().optional(),
  role: z.enum(['buying', 'selling']).default('buying'),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export async function listOffers(request: Request) {
  try {
    const auth = await requireAuth(request);
    if ('response' in auth) return auth.response;

    const q = parseQuery(new URL(request.url), offerListQuery);
    if (!q.ok) return q.response;
    const { listingId, role, page, limit } = q.data;

    const values: unknown[] = [];
    let joinSql = '';
    const where: string[] = [];

    if (role === 'buying') {
      values.push(auth.auth.sub);
      where.push(`o.buyer_id = $${values.length}`);
    } else {
      // Selling: offers on listings I own — join through listings.
      joinSql = 'JOIN listings l ON l.id = o.listing_id';
      values.push(auth.auth.sub);
      where.push(`l.seller_id = $${values.length}`);
    }
    if (listingId) {
      values.push(listingId);
      where.push(`o.listing_id = $${values.length}`);
    }

    values.push(limit, (page - 1) * limit);
    const res = await pool.query(
      `SELECT o.* FROM offers o ${joinSql} WHERE ${where.join(' AND ')}
       ORDER BY o.created_at DESC LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values,
    );

    return NextResponse.json({
      offers: (res.rows as OfferRow[]).map((o) => serializeOffer(o)),
      pagination: { page, limit },
    });
  } catch (err) {
    return internalError('listOffers', err, request);
  }
}

// ---------------------------------------------------------------------------
// Seller transitions: accept | reject | counter (listing owner only)
// ---------------------------------------------------------------------------

type TransitionContext = {
  offer: OfferRow;
  listing: ListingRow;
};

async function loadForSellerTransition(
  offerId: string,
  sellerId: string,
  request: Request,
): Promise<{ response?: NextResponse; ctx?: TransitionContext }> {
  const offer = await getOfferRow(offerId);
  if (!offer) return { response: notFound(request) };
  const listing = await getListingRow(offer.listing_id);
  if (!listing) return { response: notFound(request) };
  if (listing.seller_id !== sellerId) {
    return { response: jsonError(403, 'FORBIDDEN', 'Only the listing owner can do this', request) };
  }
  if (offer.status !== 'PENDING') {
    return {
      response: jsonError(
        409,
        'INVALID_TRANSITION',
        `Offer is ${offer.status}; only PENDING offers can be accepted, rejected or countered`,
        request,
      ),
    };
  }
  if (listing.status !== 'ACTIVE') {
    return {
      response: jsonError(409, 'LISTING_INACTIVE', 'The listing is no longer active', request),
    };
  }
  return { ctx: { offer, listing } };
}

// PATCH /api/offers/:id/accept — PENDING → ACCEPTED (terminal).
export async function acceptOffer(request: Request, id: string) {
  try {
    const auth = await requireAuth(request);
    if ('response' in auth) return auth.response;

    const loaded = await loadForSellerTransition(id, auth.auth.sub, request);
    if (!loaded.ctx) return loaded.response ?? notFound(request);
    const { offer, listing } = loaded.ctx;

    const res = await pool.query(
      `UPDATE offers SET status = 'ACCEPTED', updated_at = now()
       WHERE id = $1 AND status = 'PENDING' RETURNING *`,
      [id],
    );
    if (!res.rows[0]) {
      return jsonError(409, 'INVALID_TRANSITION', 'Offer is no longer pending', request);
    }

    return NextResponse.json({
      offer: serializeOffer(res.rows[0] as OfferRow, listing),
      message: 'Offer accepted. This offer id is the deal confirmation transaction-service reads.',
    });
  } catch (err) {
    return internalError('acceptOffer', err, request);
  }
}

// PATCH /api/offers/:id/reject — PENDING → REJECTED (terminal).
export async function rejectOffer(request: Request, id: string) {
  try {
    const auth = await requireAuth(request);
    if ('response' in auth) return auth.response;

    const loaded = await loadForSellerTransition(id, auth.auth.sub, request);
    if (!loaded.ctx) return loaded.response ?? notFound(request);

    const res = await pool.query(
      `UPDATE offers SET status = 'REJECTED', updated_at = now()
       WHERE id = $1 AND status = 'PENDING' RETURNING *`,
      [id],
    );
    if (!res.rows[0]) {
      return jsonError(409, 'INVALID_TRANSITION', 'Offer is no longer pending', request);
    }

    return NextResponse.json({ offer: serializeOffer(res.rows[0] as OfferRow) });
  } catch (err) {
    return internalError('rejectOffer', err, request);
  }
}

// PATCH /api/offers/:id/counter — PENDING → COUNTERED; a new child offer is
// created as PENDING. The counter terms come from the seller's body.
export async function counterOffer(request: Request, id: string) {
  try {
    const auth = await requireAuth(request);
    if ('response' in auth) return auth.response;

    const loaded = await loadForSellerTransition(id, auth.auth.sub, request);
    if (!loaded.ctx) return loaded.response ?? notFound(request);
    const { offer, listing } = loaded.ctx;

    const parsed = await parseJsonBody(request, offerCounterSchema);
    if (!parsed.ok) return parsed.response;
    const b = parsed.data;

    if (b.quantity > listing.quantity) {
      return jsonError(
        400,
        'QUANTITY_EXCEEDS_STOCK',
        `Listing has only ${listing.quantity} unit(s) available`,
        request,
      );
    }

    // One transaction: finalise the parent, insert the child.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const parentRes = await client.query(
        `UPDATE offers SET status = 'COUNTERED', updated_at = now()
         WHERE id = $1 AND status = 'PENDING' RETURNING id`,
        [id],
      );
      if (!parentRes.rows[0]) {
        await client.query('ROLLBACK');
        return jsonError(409, 'INVALID_TRANSITION', 'Offer is no longer pending', request);
      }
      const childRes = await client.query(
        `INSERT INTO offers (listing_id, buyer_id, offered_price, quantity, counter_of)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [offer.listing_id, offer.buyer_id, b.offeredPrice, b.quantity, id],
      );
      await client.query('COMMIT');

      return NextResponse.json(
        {
          counteredOfferId: id,
          offer: serializeOffer(childRes.rows[0] as OfferRow, listing),
          message:
            'Counter proposed. The buyer can accept it by making a new offer with these terms.',
        },
        { status: 201 },
      );
    } finally {
      client.release();
    }
  } catch (err) {
    return internalError('counterOffer', err, request);
  }
}

// ---------------------------------------------------------------------------
// Buyer transition: withdraw
// ---------------------------------------------------------------------------

// PATCH /api/offers/:id/withdraw — buyer only, PENDING → WITHDRAWN.
export async function withdrawOffer(request: Request, id: string) {
  try {
    const auth = await requireAuth(request);
    if ('response' in auth) return auth.response;

    const offer = await getOfferRow(id);
    if (!offer) return notFound(request);
    if (offer.buyer_id !== auth.auth.sub) {
      return jsonError(403, 'FORBIDDEN', 'Only the buyer can withdraw this offer', request);
    }
    if (offer.status !== 'PENDING') {
      return jsonError(
        409,
        'INVALID_TRANSITION',
        `Offer is ${offer.status}; only PENDING offers can be withdrawn`,
        request,
      );
    }

    const res = await pool.query(
      `UPDATE offers SET status = 'WITHDRAWN', updated_at = now()
       WHERE id = $1 AND status = 'PENDING' RETURNING *`,
      [id],
    );

    return NextResponse.json({ offer: serializeOffer(res.rows[0] as OfferRow) });
  } catch (err) {
    return internalError('withdrawOffer', err, request);
  }
}

// ---------------------------------------------------------------------------
// 48h expiry
// ---------------------------------------------------------------------------

// POST /api/offers/expire — auto-EXPIRE PENDING offers older than the TTL
// (default 48h). Called by cron / scheduled job; also safe to call manually.
// Idempotent: second run finds nothing to do.
export async function expireOffers(request: Request) {
  try {
    // Audit Step 3d (user decision Q5): this is a cron-triggered sweep, kept
    // behind standard end-user JWT auth (requireAuth) — an internal-key scheme
    // was declined, and an unauthenticated route would let anyone spam it.
    const auth = await requireAuth(request);
    if ('response' in auth) return auth.response;

    const ttlHours = env.OFFER_TTL_HOURS;
    const res = await pool.query(
      `UPDATE offers SET status = 'EXPIRED', updated_at = now()
       WHERE status = 'PENDING'
         AND created_at < now() - ($1 || ' hours')::interval
       RETURNING id`,
      [String(ttlHours)],
    );

    return NextResponse.json({ expired: res.rowCount ?? 0, ttlHours });
  } catch (err) {
    return internalError('expireOffers', err, request);
  }
}
