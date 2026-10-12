import { NextResponse } from 'next/server';
import { pool } from '../db';
import {
  requireAuth,
  parseJsonBody,
  getConversationRow,
  jsonError,
  internalError,
  ConversationRow,
} from '../handlers';
import { conversationCreateSchema } from '../schemas';
import { bearerToken } from '../auth';
import { env } from '../env';

// ---------------------------------------------------------------------------
// Conversations — POST (buyer starts a thread on a listing) / GET (own threads)
// ---------------------------------------------------------------------------

function serializeConversation(row: ConversationRow) {
  return {
    id: row.id,
    listingId: row.listing_id,
    buyerId: row.buyer_id,
    sellerId: row.seller_id,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
  };
}

// Authoritative seller lookup: communication-service calls marketplace-service
// GET /api/listings/:id (Phase 4 hard requirement). The caller's own Bearer
// token is forwarded — marketplace accepts any valid JWT on that route — so
// the seller_id ALWAYS comes from marketplace's row, never from the client.
async function fetchListingFromMarketplace(
  listingId: string,
  accessToken: string,
): Promise<{ ok: true; sellerId: string } | { ok: false; status: number; error: string; message: string }> {
  try {
    const res = await fetch(`${env.MARKETPLACE_SERVICE_URL}/api/listings/${listingId}`, {
      headers: {
        authorization: `Bearer ${accessToken}`,
        'x-service-key': env.INTERNAL_SERVICE_API_KEY, // audit Step 2a
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
    });

    if (res.status === 404) {
      return { ok: false, status: 404, error: 'LISTING_NOT_FOUND', message: 'Listing does not exist' };
    }
    if (res.status === 401) {
      // Caller's token rejected by marketplace (expired/invalid).
      return { ok: false, status: 502, error: 'MARKETPLACE_REJECTED_TOKEN', message: 'marketplace-service rejected the caller token' };
    }
    if (!res.ok) {
      // marketplace down / 5xx -> fail closed (audit pattern).
      return { ok: false, status: 502, error: 'MARKETPLACE_UNAVAILABLE', message: 'Cannot fetch listing; try again' };
    }
    const body = (await res.json()) as { listing?: { sellerId?: string } };
    const sellerId = body.listing?.sellerId;
    if (!sellerId) {
      return { ok: false, status: 502, error: 'MARKETPLACE_BAD_RESPONSE', message: 'marketplace response missing sellerId' };
    }
    return { ok: true, sellerId };
  } catch {
    return { ok: false, status: 502, error: 'MARKETPLACE_UNAVAILABLE', message: 'Cannot fetch listing; try again' };
  }
}

// POST /api/conversations — body { listing_id }. Only the LISTING'S BUYER (the
// JWT sub) becomes buyer_id; seller_id is fetched from marketplace-service.
export async function createConversation(request: Request) {
  try {
    const auth = await requireAuth(request);
    if ('response' in auth) return auth.response;

    const parsed = await parseJsonBody(request, conversationCreateSchema);
    if (!parsed.ok) return parsed.response;
    const { listing_id } = parsed.data;

    // Hard requirement: seller_id from marketplace-service, never client input.
    const listing = await fetchListingFromMarketplace(listing_id, bearerToken(request) ?? '');
    if (!listing.ok) {
      return jsonError(listing.status, listing.error, listing.message);
    }

    if (listing.sellerId === auth.auth.sub) {
      return jsonError(409, 'OWN_LISTING', 'You cannot start a conversation on your own listing');
    }

    // Idempotent: same (listing, buyer) returns the existing thread.
    const existing = await pool.query(
      `SELECT * FROM conversations WHERE listing_id = $1 AND buyer_id = $2`,
      [listing_id, auth.auth.sub],
    );
    if (existing.rows[0]) {
      return NextResponse.json({ conversation: serializeConversation(existing.rows[0] as ConversationRow), existing: true });
    }

    const inserted = await pool.query(
      `INSERT INTO conversations (listing_id, buyer_id, seller_id)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [listing_id, auth.auth.sub, listing.sellerId],
    );

    return NextResponse.json({ conversation: serializeConversation(inserted.rows[0] as ConversationRow), existing: false }, { status: 201 });
  } catch (err) {
    return internalError('createConversation', err);
  }
}

// GET /api/conversations — threads where I am buyer or seller (newest first).
export async function listConversations(request: Request) {
  try {
    const auth = await requireAuth(request);
    if ('response' in auth) return auth.response;

    const res = await pool.query(
      `SELECT * FROM conversations WHERE buyer_id = $1 OR seller_id = $1 ORDER BY created_at DESC`,
      [auth.auth.sub],
    );
    return NextResponse.json({ conversations: (res.rows as ConversationRow[]).map(serializeConversation) });
  } catch (err) {
    return internalError('listConversations', err);
  }
}

// GET /api/conversations/:id — single thread, participants only.
export async function getConversation(request: Request, id: string) {
  try {
    const auth = await requireAuth(request);
    if ('response' in auth) return auth.response;

    const row = await getConversationRow(id);
    if (!row) return jsonError(404, 'NOT_FOUND', 'Conversation does not exist');
    if (row.buyer_id !== auth.auth.sub && row.seller_id !== auth.auth.sub) {
      return jsonError(403, 'FORBIDDEN', 'You are not a participant in this conversation');
    }
    return NextResponse.json({ conversation: serializeConversation(row) });
  } catch (err) {
    return internalError('getConversation', err);
  }
}
