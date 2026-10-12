import { bearerToken } from './auth';
import crypto from 'node:crypto';

// ---------------------------------------------------------------------------
// Marketplace client — the ONLY trusted way to learn an offer's status.
// The caller's Bearer token is forwarded (communication-service precedent:
// fail-closed 502 on non-OK; never trust the client's claim).
// ---------------------------------------------------------------------------

import { env } from './env';

export type OfferView = {
  id: string;
  listingId: string;
  buyerId: string;
  offeredPrice: string;
  quantity: number;
  status: string;
  listing?: { id: string; title: string; sellerId: string; price: string; status: string; demo?: boolean };
};

// Fail-closed: returns { ok:false } for any non-200 or unparseable response.
// The marketplace endpoint only accepts end-user JWTs, so the caller's own
// token is forwarded — an attacker cannot mint an offer view for someone
// else's offer, and we re-check buyer/seller identity against the JWT sub
// afterwards anyway.
export async function fetchOfferFromMarketplace(
  offerId: string,
  callerToken: string,
): Promise<{ ok: true; offer: OfferView } | { ok: false; status: number; error: string }> {
  let res: Response;
  try {
    res = await fetch(`${env.MARKETPLACE_SERVICE_URL}/api/offers/${encodeURIComponent(offerId)}`, {
      headers: {
        authorization: `Bearer ${callerToken}`,
        'x-service-key': env.INTERNAL_SERVICE_API_KEY, // audit Step 2a
      },
      signal: AbortSignal.timeout(5000),
    });
  } catch (err) {
    return { ok: false, status: 0, error: `marketplace unreachable: ${String(err).slice(0, 200)}` };
  }

  if (!res.ok) {
    return { ok: false, status: res.status, error: `marketplace responded HTTP ${res.status}` };
  }
  return parseOfferBody(res);
}

// ---------------------------------------------------------------------------
// Internal system-to-system write (audit N1 fix, Step 1): mark the listing
// SOLD on successful handover verification. Authenticated with the shared
// internal API key (x-internal-api-key) — NOT a user JWT, mirroring the
// communication->notifications precedent. Fail-closed: any non-OK response
// (or unreachable marketplace) returns ok:false so the caller can refuse to
// proceed with the payout (user decision Q2: the SOLD write must succeed).
// ---------------------------------------------------------------------------
export async function markListingSoldInMarketplace(
  listingId: string,
): Promise<{ ok: true; alreadySold: boolean } | { ok: false; status: number; error: string }> {
  const key = env.INTERNAL_SERVICE_API_KEY;
  if (!key) {
    return { ok: false, status: 0, error: 'INTERNAL_SERVICE_API_KEY is not configured' };
  }
  let res: Response;
  try {
    res = await fetch(
      `${env.MARKETPLACE_SERVICE_URL}/api/internal/listings/${encodeURIComponent(listingId)}/status`,
      {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          'x-internal-api-key': key,
          // Mirrors communication-service's guard, which also accepts the key
          // as a Bearer credential.
          authorization: `Bearer ${key}`,
          'x-timing-nonce': crypto.randomBytes(8).toString('hex'),
        },
        body: JSON.stringify({ status: 'SOLD' }),
        signal: AbortSignal.timeout(5000),
      },
    );
  } catch (err) {
    return { ok: false, status: 0, error: `marketplace unreachable: ${String(err).slice(0, 200)}` };
  }

  if (res.status === 409) {
    // Listing exists but is not ACTIVE (e.g. DELETED): hard failure — Q2.
    const detail = (await res.json().catch(() => ({}))) as { message?: string };
    return { ok: false, status: 409, error: detail.message ?? 'listing not ACTIVE' };
  }
  if (!res.ok) {
    return { ok: false, status: res.status, error: `marketplace responded HTTP ${res.status}` };
  }
  const body = (await res.json().catch(() => ({}))) as { alreadySold?: boolean };
  return { ok: true, alreadySold: Boolean(body.alreadySold) };
}

// ---------------------------------------------------------------------------
// End-user-JWT-forwarding reads (existing behaviour, unchanged).
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Internal SYSTEM-TO-SYSTEM batch read (x-internal-api-key): listing display
// fields for the purchase history / fulfilment timeline. The transaction role
// owns no cross-schema DB grant (least privilege, one schema per service), so
// listing title/price/cover image always come from marketplace over HTTP —
// fail-closed 502, never a stale client-side guess.
// ---------------------------------------------------------------------------

export type ListingSummary = {
  id: string;
  sellerId: string;
  title: string;
  price: string;
  status: string;
  images: string[];
  /** ISO publication time — used by the order timeline's first stage. */
  createdAt?: string;
  /** TRUE only for the simulated demonstration listing. */
  demo?: boolean;
};

export async function fetchListingsByIds(
  ids: string[],
): Promise<{ ok: true; listings: ListingSummary[] } | { ok: false; status: number; error: string }> {
  const key = env.INTERNAL_SERVICE_API_KEY;
  if (!key) {
    return { ok: false, status: 0, error: 'INTERNAL_SERVICE_API_KEY is not configured' };
  }
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return { ok: true, listings: [] };

  let res: Response;
  try {
    res = await fetch(
      `${env.MARKETPLACE_SERVICE_URL}/api/internal/listings?ids=${encodeURIComponent(unique.join(','))}`,
      {
        headers: {
          'x-internal-api-key': key,
          authorization: `Bearer ${key}`,
        },
        signal: AbortSignal.timeout(5000),
      },
    );
  } catch (err) {
    return { ok: false, status: 0, error: `marketplace unreachable: ${String(err).slice(0, 200)}` };
  }

  if (!res.ok) {
    return { ok: false, status: res.status, error: `marketplace responded HTTP ${res.status}` };
  }
  const body = (await res.json().catch(() => ({}))) as { listings?: ListingSummary[] };
  if (!Array.isArray(body.listings)) {
    return { ok: false, status: res.status, error: 'marketplace response missing listings' };
  }
  return { ok: true, listings: body.listings };
}

async function parseOfferBody(res: Response): Promise<{ ok: true; offer: OfferView } | { ok: false; status: number; error: string }> {
  try {
    const body = (await res.json()) as { offer?: OfferView };
    if (!body?.offer?.id) {
      return { ok: false, status: res.status, error: 'marketplace response missing offer' };
    }
    return { ok: true, offer: body.offer };
  } catch {
    return { ok: false, status: res.status, error: 'marketplace response not JSON' };
  }
}
