import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { z } from 'zod';
import { pool } from '../db';
import {
  requireAuth,
  requireVerifiedSeller,
  parseJsonBody,
  parseQuery,
  getListingRow,
  notFound,
  internalError,
  jsonError,
  ListingRow,
} from '../handlers';
import { listingCreateSchema, listingUpdateSchema, listingListQuery, listingStatusSchema } from '../schemas';
import { env } from '../env';
import { hostelGroup, groupSql } from '../hostels';

// ---------------------------------------------------------------------------
// Listings — POST / PATCH/:id / DELETE/:id / GET (search+filters) / GET /:id
// ---------------------------------------------------------------------------

export function serializeListing(row: ListingRow) {
  return {
    id: row.id,
    sellerId: row.seller_id,
    title: row.title,
    description: row.description,
    category: row.category,
    condition: row.condition,
    price: row.price,
    quantity: row.quantity,
    images: row.image_urls ?? [],
    status: row.status,
    /** TRUE only for the simulated demonstration listing — the UI shows the
     *  "DEMO TRANSACTION - SIMULATED - NO PAYMENT PROCESSED" marker on it. */
    demo: row.demo ?? false,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
  };
}

// POST /api/listings — seller only, account must be VERIFIED per identity-service.
export async function createListing(request: Request) {
  try {
    const seller = await requireVerifiedSeller(request);
    if ('response' in seller) return seller.response;

    // Fail closed: without the hostelBlock claim we cannot say which market
    // (MH or LH) this listing belongs to, so it must not be published.
    if (!seller.auth.hostelBlock) {
      return jsonError(
        403,
        'HOSTEL_UNKNOWN',
        'Your token carries no hostel assignment; log out and log in again.',
        request,
      );
    }

    const parsed = await parseJsonBody(request, listingCreateSchema);
    if (!parsed.ok) return parsed.response;
    const b = parsed.data;

    const res = await pool.query(
      `INSERT INTO listings
         (seller_id, seller_block, title, description, category, condition, price, quantity, image_urls)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        seller.auth.sub,
        seller.auth.hostelBlock, // denormalised for block-wise search (SRS 5.2.2) + MH/LH group
        b.title,
        b.description ?? null,
        b.category,
        b.condition,
        b.price,
        b.quantity,
        b.images ?? [],
      ],
    );

    return NextResponse.json({ listing: serializeListing(res.rows[0] as ListingRow) }, { status: 201 });
  } catch (err) {
    return internalError('createListing', err, request);
  }
}

// PATCH /api/listings/:id — owner only (seller_id === JWT sub).
export async function updateListing(request: Request, id: string) {
  try {
    const auth = await requireAuth(request);
    if ('response' in auth) return auth.response;

    const listing = await getListingRow(id);
    if (!listing) return notFound(request);
    if (listing.seller_id !== auth.auth.sub) {
      return jsonError(403, 'FORBIDDEN', 'You do not own this listing', request);
    }

    const parsed = await parseJsonBody(request, listingUpdateSchema);
    if (!parsed.ok) return parsed.response;
    const b = parsed.data;

    // No-op patch: nothing to change.
    if (Object.keys(b).length === 0) {
      return NextResponse.json({ listing: serializeListing(listing) });
    }

    const columnFor: Record<string, string> = {
      title: 'title',
      description: 'description',
      category: 'category',
      condition: 'condition',
      price: 'price',
      quantity: 'quantity',
      images: 'image_urls',
    };

    const sets: string[] = [];
    const values: unknown[] = [];
    for (const [key, value] of Object.entries(b)) {
      values.push(value);
      sets.push(`${columnFor[key]} = $${values.length}`);
    }
    sets.push(`updated_at = now()`);
    values.push(id);

    const res = await pool.query(
      `UPDATE listings SET ${sets.join(', ')} WHERE id = $${values.length} RETURNING *`,
      values,
    );

    return NextResponse.json({ listing: serializeListing(res.rows[0] as ListingRow) }, { status: 200 });
  } catch (err) {
    return internalError('updateListing', err, request);
  }
}

// DELETE /api/listings/:id — owner only. Soft-delete keeps offer history intact.
export async function deleteListing(request: Request, id: string) {
  try {
    const auth = await requireAuth(request);
    if ('response' in auth) return auth.response;

    const listing = await getListingRow(id);
    if (!listing) return notFound(request);
    if (listing.seller_id !== auth.auth.sub) {
      return jsonError(403, 'FORBIDDEN', 'You do not own this listing', request);
    }

    const res = await pool.query(
      `UPDATE listings SET status = 'DELETED', updated_at = now()
       WHERE id = $1 AND seller_id = $2 AND status = 'ACTIVE'
       RETURNING id`,
      [id, auth.auth.sub],
    );
    if (!res.rows[0]) {
      return jsonError(409, 'INVALID_STATE', 'Listing is not active', request);
    }

    return NextResponse.json({ deleted: true, id });
  } catch (err) {
    return internalError('deleteListing', err, request);
  }
}

// GET /api/listings?q=...&category=...&block=...&page=1&limit=20
// Keyword search uses the Postgres full-text index on title+description.
// Block-wise filter (SRS 5.2.2) matches the seller's hostel block, taken from
// the listing row (denormalised from the seller's JWT at creation time).
// MH/LH segregation: the grid only ever shows the caller's OWN hostel group —
// men's (MH) and ladies' (LH) trades are two separate markets.
export async function listListings(request: Request) {
  try {
    const auth = await requireAuth(request);
    if ('response' in auth) return auth.response;

    const url = new URL(request.url);
    const q = parseQuery(url, listingListQuery);
    if (!q.ok) return q.response;
    const { q: keyword, category, block, page, limit } = q.data;

    const values: unknown[] = [];
    const where: string[] = [`status = 'ACTIVE'`, groupSql(hostelGroup(auth.auth.hostelBlock), 'seller_block')];

    if (keyword) {
      values.push(keyword);
      where.push(`tsv @@ plainto_tsquery('english', $${values.length})`);
    }
    if (category) {
      values.push(category);
      where.push(`category = $${values.length}`);
    }
    if (block) {
      values.push(block);
      where.push(`seller_block = $${values.length}`);
    }

    const whereSql = where.join(' AND ');
    const offset = (page - 1) * limit;

    const countRes = await pool.query(
      `SELECT count(*)::int AS total FROM listings WHERE ${whereSql}`,
      values,
    );
    const total = countRes.rows[0].total as number;

    values.push(limit, offset);
    const listRes = await pool.query(
      `SELECT id, seller_id, seller_block, title, description, category, condition,
              price, quantity, image_urls, status, demo, created_at, updated_at
       FROM listings
       WHERE ${whereSql}
       ORDER BY
         ${keyword ? `ts_rank(tsv, plainto_tsquery('english', $1)) DESC,` : ''}
         created_at DESC
       LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values,
    );

    return NextResponse.json({
      listings: (listRes.rows as ListingRow[]).map(serializeListing),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    });
  } catch (err) {
    return internalError('listListings', err, request);
  }
}

// ---------------------------------------------------------------------------
// Internal service-to-service write (audit N1 fix, Step 1): transaction-service
// marks a listing SOLD after handover verification, before payout. Guarded by
// the shared internal API key (x-internal-api-key) — explicitly NOT a user
// JWT. Timing-safe compare; 501 when the deployer never configured a key.
// PATCH /api/internal/listings/:id/status  body: { status: 'SOLD' }
// ---------------------------------------------------------------------------

// Phase 9 (item 3): the internal SOLD transition parses its body with Zod too,
// so no route touches the DB with an unvalidated payload.
const markSoldSchema = z.object({ status: z.literal('SOLD') });

// Shared key gate for every /api/internal/* handler: service-to-service only,
// never callable by an end user (the middleware already exempts /api/internal
// from the x-service-key gate, so the handler MUST check this itself).
export function requireInternalKey(request: Request): NextResponse | null {
  const configured = env.INTERNAL_SERVICE_API_KEY;
  if (!configured) {
    return jsonError(501, 'NOT_CONFIGURED', 'Internal API key is not configured', request);
  }
  const provided =
    request.headers.get('x-internal-api-key') ??
    request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ??
    '';
  const a = Buffer.from(provided);
  const b = Buffer.from(configured);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return jsonError(401, 'UNAUTHORIZED', 'Invalid internal API key', request);
  }
  return null;
}

// GET /api/internal/listings?ids=a,b,c — service-to-service BATCH read
// (x-internal-api-key). transaction-service uses it for the purchase history /
// fulfilment timeline (title, price, cover image) so it never needs a
// cross-schema DB grant. Returns ONLY display fields.
const internalIdsSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(50),
});

export async function getListingsByIdsInternal(request: Request) {
  try {
    const denied = requireInternalKey(request);
    if (denied) return denied;

    const raw = new URL(request.url).searchParams.get('ids') ?? '';
    const ids = [...new Set(raw.split(',').map((s) => s.trim()).filter(Boolean))];
    const parsed = internalIdsSchema.safeParse({ ids });
    if (!parsed.success) {
      return jsonError(
        400,
        'VALIDATION_ERROR',
        'ids must be 1-50 comma-separated listing UUIDs',
        request,
      );
    }

    const res = await pool.query<
      Pick<ListingRow, 'id' | 'seller_id' | 'title' | 'price' | 'status' | 'image_urls' | 'created_at' | 'demo'>
    >(
      `SELECT id, seller_id, title, price, status, image_urls, created_at, demo
       FROM listings WHERE id = ANY($1::uuid[])`,
      [parsed.data.ids],
    );

    return NextResponse.json({
      listings: res.rows.map((row) => ({
        id: row.id,
        sellerId: row.seller_id,
        title: row.title,
        price: row.price,
        status: row.status,
        images: row.image_urls ?? [],
        createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
        demo: row.demo ?? false,
      })),
    });
  } catch (err) {
    return internalError('getListingsByIdsInternal', err, request);
  }
}

export async function markListingSoldInternal(request: Request, id: string) {
  const denied = requireInternalKey(request);
  if (denied) return denied;

  const parsedBody = await parseJsonBody(request, markSoldSchema);
  if (!parsedBody.ok) return parsedBody.response;

  // Only an ACTIVE listing can be sold (idempotent no-op if already SOLD —
  // settlement retries must not fail on a second call).
  const updated = await pool.query<ListingRow>(
    `UPDATE listings SET status = 'SOLD', updated_at = now()
     WHERE id = $1 AND status = 'ACTIVE'
     RETURNING id, seller_id, seller_block, title, description, category, condition,
               price, quantity, image_urls, status, demo, created_at, updated_at`,
    [id],
  );
  if (updated.rows.length === 0) {
    const existing = await getListingRow(id);
    if (!existing) return notFound(request);
    if (existing.status === 'SOLD') {
      return NextResponse.json({ listing: serializeListing(existing), alreadySold: true });
    }
    return jsonError(409, 'INVALID_TRANSITION', `listing is ${existing.status}; only ACTIVE can be marked SOLD`, request);
  }
  return NextResponse.json({ listing: serializeListing(updated.rows[0]) });
}

// PATCH /api/listings/:id/status — owner only (QA3 closeout): the single
// seller-facing status transition, ACTIVE → SOLD. Admin/settlement flow keeps
// using the internal key-guarded route (markListingSoldInternal); a listing
// that is DELETED or already SOLD is 409, matching the internal route.
export async function updateListingStatus(request: Request, id: string) {
  try {
    const auth = await requireAuth(request);
    if ('response' in auth) return auth.response;

    const parsed = await parseJsonBody(request, listingStatusSchema);
    if (!parsed.ok) return parsed.response;

    const listing = await getListingRow(id);
    if (!listing) return notFound(request);
    if (listing.seller_id !== auth.auth.sub) {
      return jsonError(403, 'FORBIDDEN', 'You do not own this listing', request);
    }
    if (listing.status !== 'ACTIVE') {
      return jsonError(409, 'INVALID_TRANSITION', `listing is ${listing.status}; only ACTIVE can be marked SOLD`, request);
    }

    const res = await pool.query<ListingRow>(
      `UPDATE listings SET status = 'SOLD', updated_at = now()
       WHERE id = $1 AND seller_id = $2 AND status = 'ACTIVE'
       RETURNING id, seller_id, seller_block, title, description, category, condition,
                 price, quantity, image_urls, status, demo, created_at, updated_at`,
      [id, auth.auth.sub],
    );
    if (!res.rows[0]) {
      return jsonError(409, 'INVALID_TRANSITION', 'Listing is not active', request);
    }

    return NextResponse.json({ listing: serializeListing(res.rows[0]) });
  } catch (err) {
    return internalError('updateListingStatus', err, request);
  }
}

// GET /api/listings/mine — H2 closeout: the CALLER'S listings, ANY status
// (ACTIVE / SOLD / DELETED / PAUSED). Requires auth; never accepts a sellerId
// param — ownership is always taken from the verified JWT sub, so one user
// can never see another's non-public listings. Distinct route (not a param on
// the public search) so the anonymous browse behavior stays byte-identical.
export async function listMyListings(request: Request) {
  try {
    const auth = await requireAuth(request);
    if ('response' in auth) return auth.response;

    const url = new URL(request.url);
    const q = parseQuery(url, listingListQuery);
    if (!q.ok) return q.response;
    const { page, limit } = q.data;

    const offset = (page - 1) * limit;

    const countRes = await pool.query(`SELECT count(*)::int AS total FROM listings WHERE seller_id = $1`, [
      auth.auth.sub,
    ]);
    const total = countRes.rows[0].total as number;

    const res = await pool.query<ListingRow>(
      `SELECT id, seller_id, seller_block, title, description, category, condition,
              price, quantity, image_urls, status, demo, created_at, updated_at
       FROM listings
       WHERE seller_id = $1
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [auth.auth.sub, limit, offset],
    );

    return NextResponse.json({
      listings: res.rows.map(serializeListing),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    });
  } catch (err) {
    return internalError('listMyListings', err, request);
  }
}

// GET /api/listings/:id — public (any authenticated user).
export async function getListing(request: Request, id: string) {
  try {
    const auth = await requireAuth(request);
    if ('response' in auth) return auth.response;

    const listing = await getListingRow(id);
    if (!listing || listing.status !== 'ACTIVE') return notFound(request);

    // Cross-hostel isolation: an LH resident cannot even resolve an MH listing
    // (404, not 403 — the other market's rows do not exist from their POV).
    if (hostelGroup(listing.seller_block) !== hostelGroup(auth.auth.hostelBlock)) {
      return notFound(request);
    }

    return NextResponse.json({ listing: serializeListing(listing) });
  } catch (err) {
    return internalError('getListing', err, request);
  }
}
