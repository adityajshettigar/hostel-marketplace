import { NextResponse } from 'next/server';
import { z } from 'zod';
import { pool } from '../db';
import { requireAuth, parseQuery, jsonError, notFound, internalError } from '../handlers';
import { bearerToken } from '../auth';
import { fetchListingsByIds } from '../marketplace';
import { fetchUsersByIds } from '../identity';
import { TxnRow } from '../state-machine';

function isoOrNull(v: Date | string | null): string | null {
  if (v === null) return null;
  return v instanceof Date ? v.toISOString() : new Date(v).toISOString();
}

type PurchaseRow = TxnRow & {
  buyer_id: string;
  seller_id: string;
  amount_paise: string | number;
  status: string;
  created_at: Date | string;
  updated_at: Date | string;
  listing_id: string;
  offer_id: string;
  quantity: number;
  currency: string;
  image_urls?: string[] | null;
};

type PurchaseEntry = {
  id: string;
  offerId: string;
  listingId: string;
  buyerId: string;
  sellerId: string;
  amountPaise: number;
  quantity: number;
  currency: string;
  status: string;
  createdAt: string | null;
  updatedAt: string | null;
  role: 'buyer' | 'seller';
  category: 'PURCHASE' | 'SALE' | 'FAILURE';
};

type PurchaseDetail = {
  id: string;
  offerId: string;
  listingId: string;
  buyerId: string;
  sellerId: string;
  amountPaise: number;
  quantity: number;
  currency: string;
  status: string;
  createdAt: string | null;
  updatedAt: string | null;
  role: 'buyer' | 'seller';
  category: 'PURCHASE' | 'SALE' | 'FAILURE';
  buyer: {
    id: string;
    fullName: string;
    hostelBlock: string | null;
    roomNumber: string | null;
    phone: string | null;
  } | null;
  seller: {
    id: string;
    fullName: string;
    hostelBlock: string | null;
    roomNumber: string | null;
    phone: string | null;
  } | null;
  listing: { id: string; title: string; sellerId: string; price: string; status: string } | null;
  imageUrl: string | null;
};

function entryFromRow(row: PurchaseRow, partyId: string): PurchaseEntry {
  const isBuyer = row.buyer_id === partyId;
  return {
    id: row.id,
    offerId: row.offer_id,
    listingId: row.listing_id,
    buyerId: row.buyer_id,
    sellerId: row.seller_id,
    amountPaise: Number(row.amount_paise),
    quantity: row.quantity,
    currency: row.currency,
    status: row.status,
    createdAt: isoOrNull(row.created_at),
    updatedAt: isoOrNull(row.updated_at),
    role: isBuyer ? 'buyer' : 'seller',
    category: classifyPurchaseCategory(row.status, isBuyer),
  };
}

function classifyPurchaseCategory(status: string, isBuyer: boolean): 'PURCHASE' | 'SALE' | 'FAILURE' {
  if (status === 'REFUNDED') return 'FAILURE';
  return isBuyer ? 'PURCHASE' : 'SALE';
}

// GET /api/purchases?role=buying|selling&from=&to= — authenticated user's own
// purchase history. Returns entries classified by PURCHASE (user = buyer),
// SALE (user = seller), or FAILURE (transaction status REFUNDED).
//
// `from`/`to` are ISO timestamps that the BROWSER computes from its own local
// day boundaries (server timestamps compared against them, so "today" is
// timezone-correct instead of a naive string comparison). Both optional.
export async function listPurchases(request: Request) {
  try {
    const auth = await requireAuth(request);
    if (typeof auth === 'object' && 'response' in auth) return (auth as { response: unknown }).response as unknown as Response;
    const user = (auth as { auth: { sub: string } }).auth;

    const listSchema = z.object({
      role: z.enum(['buying', 'selling']).default('buying'),
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(50).default(20),
      // ISO instants. `offset: true` accepts both `...Z` (what
      // Date#toISOString sends) and `+05:30`-style offsets, so the browser's
      // local-day boundary is never rejected on a technicality.
      from: z.string().datetime({ offset: true }).optional(),
      to: z.string().datetime({ offset: true }).optional(),
    });
    const q = parseQuery(new URL(request.url), listSchema);
    if (!q.ok) return q.response;
    const { role, page, limit, from, to } = q.data;

    const isBuyer = role === 'buying';
    const partyColumn = isBuyer ? 'buyer_id' : 'seller_id';
    const partyId = user.sub;

    const filters: string[] = [`${partyColumn} = $1`];
    const values: unknown[] = [partyId];
    if (from) {
      values.push(from);
      filters.push(`created_at >= $${values.length}`);
    }
    if (to) {
      values.push(to);
      filters.push(`created_at < $${values.length}`);
    }
    values.push(limit, (page - 1) * limit);

    // NOTE: transactions is the only table this service owns. Listing and user
    // display data (title, cover image) is fetched over the internal HTTP APIs
    // below — least-privilege roles, no cross-schema joins.
    const res = await pool.query<PurchaseRow>(
      `SELECT * FROM transactions
       WHERE ${filters.join(' AND ')}
       ORDER BY created_at DESC
       LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values,
    );

    const listingsResult = await fetchListingsByIds(res.rows.map((r) => r.listing_id));
    if (!listingsResult.ok) {
      return jsonError(502, 'MARKETPLACE_UNAVAILABLE', listingsResult.error);
    }
    const listingById = new Map(listingsResult.listings.map((l) => [l.id, l]));

    return NextResponse.json({
      purchases: res.rows.map((r) => {
        const listing = listingById.get(r.listing_id);
        return {
          ...entryFromRow(r, partyId),
          // Item name + first image come from marketplace-service, are
          // server-selected (never client-supplied) and are what the history
          // cards and the details dialog render.
          listingTitle: listing?.title ?? null,
          imageUrl: listing?.images?.[0] ?? null,
        };
      }),
      // hasMore lets the client page through history without a second count
      // round-trip (a full page means "ask for the next one").
      pagination: { page, limit, hasMore: res.rows.length === limit },
    });
  } catch (err) {
    return internalError('listPurchases', err);
  }
}

// GET /api/purchases/:id — one transaction's details: buyer, seller, item,
// status, first image (server-selected). Buyer/seller party only;
// strangers get 404 (no existence leak).
export async function getPurchaseDetail(request: Request, transactionId: string) {
  try {
    const auth = await requireAuth(request);
    if (typeof auth === 'object' && 'response' in auth) return (auth as { response: unknown }).response as unknown as Response;
    const user = (auth as { auth: { sub: string } }).auth;

    const c = await pool.connect();
    try {
      const txnRes = await c.query<PurchaseRow>(
        `SELECT * FROM transactions WHERE id = $1`,
        [transactionId],
      );
      const txn = txnRes.rows[0];
      if (!txn) return notFound();

      if (!(txn.buyer_id === user.sub || txn.seller_id === user.sub)) {
        return notFound();
      }      const [partyResult, listingResult] = await Promise.all([
        fetchUsersByIds([txn.buyer_id, txn.seller_id]),
        fetchListingsByIds([txn.listing_id]),
      ]);
      if (!partyResult.ok) {
        return jsonError(502, 'IDENTITY_UNAVAILABLE', partyResult.error);
      }
      if (!listingResult.ok) {
        return jsonError(502, 'MARKETPLACE_UNAVAILABLE', listingResult.error);
      }
      const buyer = partyResult.users.find((u) => u.id === txn.buyer_id) ?? null;
      const seller = partyResult.users.find((u) => u.id === txn.seller_id) ?? null;
      const listing = listingResult.listings.find((l) => l.id === txn.listing_id) ?? null;

      const firstImage = listing?.images[0] ?? null;
      const isBuyer = txn.buyer_id === user.sub;
      return NextResponse.json({
        purchase: {
          id: txn.id,
          offerId: txn.offer_id,
          listingId: txn.listing_id,
          buyerId: txn.buyer_id,
          sellerId: txn.seller_id,
          amountPaise: Number(txn.amount_paise),
          quantity: txn.quantity,
          currency: txn.currency,
          status: txn.status,
          createdAt: isoOrNull(txn.created_at),
          updatedAt: isoOrNull(txn.updated_at),
          role: isBuyer ? 'buyer' : 'seller',
          category: classifyPurchaseCategory(txn.status, isBuyer),
          // Contact numbers are only ever surfaced to a party of THIS
          // transaction (the guard above returns 404 for strangers), and the
          // seller needs the buyer's number for the physical handover.
          buyer: buyer
            ? {
                id: buyer.id,
                fullName: buyer.fullName,
                hostelBlock: buyer.hostelBlock,
                roomNumber: buyer.roomNumber,
                phone: buyer.phone,
              }
            : null,
          seller: seller
            ? {
                id: seller.id,
                fullName: seller.fullName,
                hostelBlock: seller.hostelBlock,
                roomNumber: seller.roomNumber,
                phone: seller.phone,
              }
            : null,
          listing: listing
            ? { id: listing.id, title: listing.title, sellerId: listing.sellerId, price: listing.price, status: listing.status }
            : null,
          imageUrl: firstImage,
        },
      });
    } finally {
      c.release();
    }
  } catch (err) {
    return internalError('getPurchaseDetail', err);
  }
}
