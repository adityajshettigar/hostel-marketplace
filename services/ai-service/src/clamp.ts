// ---------------------------------------------------------------------------
// Output validation + clamping (SRS 7.8 AI Output Validation).
//
// EVERY AI output passes through these clamps before it is returned or
// logged: category forced into the fixed enum (else null -> caller's
// fallback), titles/descriptions trimmed, length-capped and guaranteed
// non-empty, prices forced positive and finite. Nothing the model or a
// template produces reaches the client unvalidated.
// ---------------------------------------------------------------------------

import { LISTING_CATEGORIES, ListingCategory, isCategory } from './categories';

export function clampCategory(value: unknown): ListingCategory | null {
  return typeof value === 'string' && isCategory(value) ? value : null;
}

// Trim, collapse whitespace, cap length, and guarantee non-empty
// (fallbackText is used when the clamped result would be empty).
export function clampText(value: unknown, maxLen: number, fallbackText: string): string {
  const cleaned =
    typeof value === 'string'
      ? value.replace(/\s+/g, ' ').trim().slice(0, maxLen)
      : '';
  return cleaned.length > 0 ? cleaned : fallbackText;
}

// Force positive, finite, and bounded; null when impossible.
export function clampPositiveNumber(value: unknown, max: number): number | null {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0 || n > max) return null;
  return Math.round(n * 100) / 100;
}

// Clamp a { low, mid, high } price range: every component positive, and the
// ordering low <= mid <= high enforced (mid as anchor; re-derive bounds).
export function clampPriceRange(low: unknown, mid: unknown, high: unknown): { low: number; mid: number; high: number } | null {
  const m = clampPositiveNumber(mid, 10_000_000);
  if (m === null) return null;
  const l = clampPositiveNumber(low, 10_000_000);
  const h = clampPositiveNumber(high, 10_000_000);
  return {
    low: l === null || l > m ? Math.round(m * 0.9 * 100) / 100 : l,
    mid: m,
    high: h === null || h < m ? Math.round(m * 1.1 * 100) / 100 : h,
  };
}

export { LISTING_CATEGORIES };
