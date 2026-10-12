// ---------------------------------------------------------------------------
// Recommendations (SRS Phase 5 / E7.11 cold-start-safe BASELINE).
//
// There is no real interaction data yet, so this is deliberately the simple
// "category matching" baseline: fetch the user's last N interaction
// categories (view/search events logged via POST /api/interactions), then
// return that service's ACTIVE listings from those categories via
// marketplace-service's public listing search, excluding the user's own
// listings (the "owns/rejected" exclusion available today; offer-rejections
// can be added to the exclusion set when transaction-service exists).
//
// SWAP SEAM: `rankListings()` is the ONLY ranking decision point and has a
// stable signature (candidate listings + user category profile -> ordered
// listings). A real learned model replaces its internals without touching
// the HTTP contract, route code, or response shape.
// ---------------------------------------------------------------------------

import { env } from './env';
import { pool } from './db';

export const RECOMMENDER_MODEL_VERSION = 'category-baseline-v1';

export type RankerInput = {
  userId: string;
  candidates: Array<{
    id: string;
    sellerId: string;
    title: string;
    category: string;
    price: number;
    createdAt: string;
  }>;
  preferredCategories: string[]; // ordered, most-recent-first
};

// BASELINE ranker: candidates in a preferred category first (earlier
// preference = higher rank), then everything else newest-first. Deterministic
// and explainable; replace internals with a real model later.
export function rankListings(input: RankerInput): RankerInput['candidates'] {
  const preferenceIndex = new Map(input.preferredCategories.map((c, i) => [c, i]));
  return [...input.candidates].sort((a, b) => {
    const ai = preferenceIndex.get(a.category);
    const bi = preferenceIndex.get(b.category);
    if (ai !== undefined && bi !== undefined && ai !== bi) return ai - bi;
    if (ai !== undefined && bi === undefined) return -1;
    if (ai === undefined && bi !== undefined) return 1;
    // Both same-tier: newest first.
    return a.createdAt < b.createdAt ? 1 : -1;
  });
}

// The user's recent category signal from the ai.interactions log
// (most-recent-first, distinct, capped).
export async function recentCategories(userId: string, limit = 5): Promise<string[]> {
  const res = await pool.query(
    `SELECT DISTINCT ON (category) category, created_at
     FROM interactions WHERE user_id = $1 AND category IS NOT NULL
     ORDER BY category, created_at DESC`,
    [userId],
  );
  const rows = res.rows as { category: string; created_at: Date }[];
  return rows
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
    .slice(0, limit)
    .map((r) => r.category);
}

// Fetch ACTIVE listings from marketplace-service's public search (any valid
// JWT) and map to the ranker's candidate shape. Returns null on failure —
// the route responds 502 per fail-closed convention.
export async function fetchCandidateListings(
  accessToken: string,
  max = 50,
): Promise<Array<RankerInput['candidates'][number]> | null> {
  try {
    const res = await fetch(`${env.MARKETPLACE_SERVICE_URL}/api/listings?limit=${max}`, {
      headers: {
        authorization: `Bearer ${accessToken}`,
        'x-service-key': env.INTERNAL_SERVICE_API_KEY, // audit Step 2a
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as {
      listings?: Array<{
        id: string;
        sellerId: string;
        title: string;
        category: string;
        price: string | number;
        createdAt: string;
      }>;
    };
    if (!Array.isArray(body.listings)) return null;
    return body.listings.map((l) => ({
      id: l.id,
      sellerId: l.sellerId,
      title: l.title,
      category: l.category,
      price: typeof l.price === 'string' ? Number(l.price) : l.price,
      createdAt: l.createdAt,
    }));
  } catch {
    return null;
  }
}
