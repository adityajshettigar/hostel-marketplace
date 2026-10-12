import { NextResponse } from 'next/server';
import { requireAuth, parseQuery, jsonError, internalError } from '../handlers';
import { recommendationsQuery } from '../schemas';
import { bearerToken } from '../auth';
import { rankListings, recentCategories, fetchCandidateListings, RECOMMENDER_MODEL_VERSION } from '../rank';

// ---------------------------------------------------------------------------
// GET /api/recommendations?userId=... — E7.11 cold-start-safe BASELINE
// (category matching). Structured so a real model swaps into rankListings()
// without changing this route or the response contract.
//
// Authorization: a user may only fetch their OWN recommendations (userId must
// equal the JWT sub) — recommendation profiles are personal data.
// ---------------------------------------------------------------------------

export async function getRecommendations(request: Request) {
  try {
    const auth = await requireAuth(request);
    if ('response' in auth) return auth.response;

    const url = new URL(request.url);
    const q = parseQuery(url, recommendationsQuery);
    if (!q.ok) return q.response;
    const { userId, limit } = q.data;

    if (userId !== auth.auth.sub) {
      return jsonError(403, 'FORBIDDEN', 'You can only request your own recommendations');
    }

    // 1. Recent category signal from the interactions log (may be empty —
    //    cold start is EXPECTED and handled, not an error).
    const preferred = await recentCategories(userId);

    // 2. Candidate listings from marketplace-service (fail-closed on error).
    const token = bearerToken(request) ?? '';
    const candidates = await fetchCandidateListings(token);
    if (candidates === null) {
      return jsonError(502, 'MARKETPLACE_UNAVAILABLE', 'Cannot fetch listings; try again');
    }

    // 3. Exclude what the user already owns (sellerId === user); rejected
    //    offers join this exclusion set in a later phase.
    const pool = candidates.filter((c) => c.sellerId !== userId);

    // 4. Rank via the swappable baseline.
    const ranked = rankListings({ userId, candidates: pool, preferredCategories: preferred });

    return NextResponse.json({
      recommendations: ranked.slice(0, limit).map((c) => ({
        listingId: c.id,
        title: c.title,
        category: c.category,
        price: c.price,
      })),
      preferredCategories: preferred,
      modelVersion: RECOMMENDER_MODEL_VERSION,
      // Frontend contract: ALWAYS true — AI ranking is assistive only.
      aiSuggestion: true,
    });
  } catch (err) {
    return internalError('getRecommendations', err);
  }
}
