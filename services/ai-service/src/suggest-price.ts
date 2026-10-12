// ---------------------------------------------------------------------------
// Price suggestion engine (SRS Phase 5).
//
// Looks up Median(price | category) and Median(price | category, condition)
// from marketplace-service's SOLD listings via its API (user-approved
// GET /api/stats/sold) and returns a { low, mid, high } RANGE — never a
// single "guaranteed" number. Tiered fallbacks keep the endpoint useful with
// thin history (ASSISTIVE, non-authoritative; the seller sets the price).
// ---------------------------------------------------------------------------

import { env } from './env';
import { clampPriceRange } from './clamp';
import { ListingCategory } from './categories';

export const PRICE_MODEL_VERSION = 'sold-median-v1';

export type PriceSuggestionInput = {
  category: ListingCategory;
  condition?: string | null;
};

export type PriceRange = { low: number; mid: number; high: number };

export type PriceSuggestion = {
  range: PriceRange;
  sampleSize: number;
  basis:
    | 'SOLD_CATEGORY_CONDITION'
    | 'SOLD_CATEGORY'
    | 'FALLBACK_DEFAULT';
  modelVersion: string;
};

type SoldStats = { p25: number | null; median: number | null; p75: number | null; sampleSize: number };

// Call marketplace-service's sold-stats endpoint with the caller's own Bearer
// token (marketplace requires any valid JWT). Returns null on any failure —
// callers fall back per SRS 7.12 (never hard-fail).
export async function fetchSoldStats(
  category: string,
  condition: string | null,
  accessToken: string,
): Promise<SoldStats | null> {
  try {
    const params = new URLSearchParams({ category });
    if (condition) params.set('condition', condition);
    const res = await fetch(`${env.MARKETPLACE_SERVICE_URL}/api/stats/sold?${params.toString()}`, {
      headers: {
        authorization: `Bearer ${accessToken}`,
        'x-service-key': env.INTERNAL_SERVICE_API_KEY, // audit Step 2a
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { stats?: SoldStats };
    if (!body.stats || typeof body.stats.sampleSize !== 'number') return null;
    return body.stats;
  } catch {
    return null;
  }
}

// Default band for a category with NO sold history at all — deliberately
// coarse and clearly labeled FALLBACK_DEFAULT in the response.
const DEFAULT_BAND: Record<ListingCategory, PriceRange> = {
  Books: { low: 50, mid: 150, high: 400 },
  Electronics: { low: 300, mid: 1500, high: 8000 },
  Furniture: { low: 200, mid: 800, high: 3000 },
  Appliances: { low: 250, mid: 1000, high: 4000 },
  Food: { low: 20, mid: 60, high: 150 },
};

export function widen(median: number, p25: number | null, p75: number | null): PriceRange {
  // Prefer the observed IQR; widen to at least ±10% so thin data still
  // communicates uncertainty. All clamped positive downstream.
  const low = p25 ?? Math.round(median * 0.9 * 100) / 100;
  const high = p75 ?? Math.round(median * 1.1 * 100) / 100;
  return { low, mid: median, high };
}

export async function generatePriceSuggestion(
  input: PriceSuggestionInput,
  accessToken: string,
): Promise<PriceSuggestion> {
  // 1. Median(price | category, condition) — most specific.
  if (input.condition) {
    const stats = await fetchSoldStats(input.category, input.condition, accessToken);
    const median = clampPositiveMedian(stats?.median);
    if (stats && median !== null && stats.sampleSize > 0) {
      const range = clampPriceRange(stats.p25, median, stats.p75);
      if (range) {
        return { range, sampleSize: stats.sampleSize, basis: 'SOLD_CATEGORY_CONDITION', modelVersion: PRICE_MODEL_VERSION };
      }
    }
  }

  // 2. Median(price | category) — category-wide.
  const catStats = await fetchSoldStats(input.category, null, accessToken);
  const catMedian = clampPositiveMedian(catStats?.median);
  if (catStats && catMedian !== null && catStats.sampleSize > 0) {
    const range = clampPriceRange(catStats.p25, catMedian, catStats.p75);
    if (range) {
      return { range, sampleSize: catStats.sampleSize, basis: 'SOLD_CATEGORY', modelVersion: PRICE_MODEL_VERSION };
    }
  }

  // 3. No usable history -> coarse default band, still a range, still labeled.
  return {
    range: DEFAULT_BAND[input.category],
    sampleSize: 0,
    basis: 'FALLBACK_DEFAULT',
    modelVersion: `${PRICE_MODEL_VERSION} (fallback-default)`,
  };
}

function clampPositiveMedian(median: unknown): number | null {
  const n = typeof median === 'number' ? median : Number(median);
  return Number.isFinite(n) && n > 0 ? n : null;
}
