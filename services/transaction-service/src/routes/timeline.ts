import { NextResponse } from 'next/server';
import { pool } from '../db';
import { requireAuth, jsonError, notFound, internalError, requireAdmin } from '../handlers';
import { TxnRow, FulfRequestRow } from '../state-machine';
import { buildTransactionTimeline, AuditEvent, TimelineActor } from '../timeline';
import { fetchListingsByIds } from '../marketplace';

// ---------------------------------------------------------------------------
// GET /api/transactions/:id/timeline — the buyer, the seller, or an admin.
//
// Returns the chronological order timeline derived from AUTHORITATIVE backend
// state (audit rows + fulfilment columns + transaction timestamps), plus the
// sanitized audit history. It never includes PIN/QR material, payment secrets
// or another party's private data, and a stranger gets the same 404 as
// getTransaction (no existence leak).
//
// Listing display fields come from marketplace over HTTP (the transaction role
// has no cross-schema grant). That call is FAIL-SOFT on purpose: if the
// marketplace is unavailable the timeline still renders with
// listingPublishedAt: null and an explicit `sourced: false` marker instead of
// inventing a date or failing the whole page.
// ---------------------------------------------------------------------------

/** Strip anything credential- or PII-shaped before the audit leaves the service. */
const DROP_DETAIL_KEY = /(pin|secret|token|password|api[_-]?key|signature|phone|room|email|cipher)/i;

function sanitizeDetail(detail: unknown): Record<string, unknown> {
  if (!detail || typeof detail !== 'object' || Array.isArray(detail)) return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(detail as Record<string, unknown>)) {
    if (DROP_DETAIL_KEY.test(k)) continue;
    if (typeof v === 'string' && v.length > 300) {
      out[k] = `${v.slice(0, 300)}…`;
      continue;
    }
    out[k] = v;
  }
  return out;
}

function isoOrNull(v: Date | string | null): string | null {
  if (v === null) return null;
  return v instanceof Date ? v.toISOString() : new Date(v).toISOString();
}

export async function getTransactionTimeline(request: Request, id: string) {
  try {
    const auth = await requireAuth(request);
    if ('response' in auth) return auth.response;

    const res = await pool.query<TxnRow>('SELECT * FROM transactions WHERE id = $1', [id]);
    const txn = res.rows[0];
    if (!txn) return notFound();

    const isParty = txn.buyer_id === auth.auth.sub || txn.seller_id === auth.auth.sub;
    let actorRole: TimelineActor = isParty ? (txn.buyer_id === auth.auth.sub ? 'buyer' : 'seller') : 'admin';
    if (!isParty) {
      // Same rule as getTransaction: only a signed admin may read a
      // transaction they are not a party to; everyone else gets 404.
      if (requireAdmin(auth.auth) !== null) return notFound();
    }

    const auditRes = await pool.query<{
      action: string;
      actor_id: string | null;
      created_at: Date | string;
      detail: unknown;
    }>(
      `SELECT action, actor_id, created_at, detail FROM transaction_audit
       WHERE transaction_id = $1 ORDER BY id ASC LIMIT 200`,
      [id],
    );

    const fulfRes = await pool.query<FulfRequestRow>(
      `SELECT * FROM fulfilment_tracking WHERE transaction_id = $1`,
      [id],
    );

    // Fail-soft listing summary (display only).
    let listingPublishedAt: string | null = null;
    let listingTitle: string | null = null;
    let listingSourced = false;
    const listing = await fetchListingsByIds([txn.listing_id]);
    if (listing.ok) {
      const l = listing.listings[0];
      if (l) {
        listingSourced = true;
        listingTitle = l.title;
        listingPublishedAt = l.createdAt ?? null;
      }
    }

    const audit: AuditEvent[] = auditRes.rows.map((r) => ({
      action: r.action,
      actorId: r.actor_id,
      createdAt: isoOrNull(r.created_at),
      detail: sanitizeDetail(r.detail),
    }));

    const timeline = buildTransactionTimeline({
      txn,
      audit,
      fulfilment: fulfRes.rows[0] ?? null,
      listingPublishedAt,
      listingTitle,
    });

    return NextResponse.json({
      ...timeline,
      /** Who is reading: the UI uses it to decide which actions to show. */
      viewerRole: actorRole,
      listingSourced,
      audit: audit.map((e) => ({
        action: e.action,
        at: e.createdAt,
        actorId: e.actorId,
        actorRole:
          e.actorId === txn.buyer_id ? 'buyer' : e.actorId === txn.seller_id ? 'seller' : e.actorId ? 'admin' : 'system',
        detail: e.detail,
      })),
    });
  } catch (err) {
    return internalError('getTransactionTimeline', err);
  }
}
