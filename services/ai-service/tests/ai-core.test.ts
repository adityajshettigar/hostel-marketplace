import { describe, it, expect } from 'vitest';
import { clampCategory, clampText, clampPositiveNumber, clampPriceRange } from '../src/clamp';
import { templateListing, LISTING_MODEL_VERSION } from '../src/suggest-listing';
import { mapCaptionToCategory } from '../src/categories';
import { widen } from '../src/suggest-price';
import { rankListings } from '../src/rank';
import { captionImage } from '../src/hf-caption';

// ---------------------------------------------------------------------------
// Unit tests (no network, no DB): SRS 7.8 output validation/clamping and the
// pure pieces of the SRS 7.12 fallback chain.
// ---------------------------------------------------------------------------

describe('clampCategory (SRS 7.8: category in fixed enum)', () => {
  it('passes through valid categories', () => {
    expect(clampCategory('Books')).toBe('Books');
    expect(clampCategory('Electronics')).toBe('Electronics');
    expect(clampCategory('Furniture')).toBe('Furniture');
    expect(clampCategory('Appliances')).toBe('Appliances');
    expect(clampCategory('Food')).toBe('Food');
  });

  it('clamps invalid/hallucinated categories to null (caller falls back)', () => {
    expect(clampCategory('Vehicles')).toBeNull();
    expect(clampCategory('books ')).toBeNull(); // no implicit trimming of enum values
    expect(clampCategory('')).toBeNull();
    expect(clampCategory(null)).toBeNull();
    expect(clampCategory(42)).toBeNull();
  });
});

describe('clampText (SRS 7.8: non-empty, capped)', () => {
  it('trims, collapses whitespace and caps length', () => {
    expect(clampText('  a   b  ', 10, 'fb')).toBe('a b');
    expect(clampText('x'.repeat(50), 10, 'fb')).toBe('x'.repeat(10));
  });

  it('guarantees non-empty via fallback', () => {
    expect(clampText('', 10, 'fallback text')).toBe('fallback text');
    expect(clampText('    ', 10, 'fallback')).toBe('fallback');
    expect(clampText(undefined, 10, 'fb')).toBe('fb');
  });
});

describe('clampPositiveNumber / clampPriceRange (SRS 7.8: price > 0)', () => {
  it('rejects zero, negative, non-finite, over-max', () => {
    expect(clampPositiveNumber(0, 1e6)).toBeNull();
    expect(clampPositiveNumber(-5, 1e6)).toBeNull();
    expect(clampPositiveNumber(Number.NaN, 1e6)).toBeNull();
    expect(clampPositiveNumber(Number.POSITIVE_INFINITY, 1e6)).toBeNull();
    expect(clampPositiveNumber(2_000_000, 1_000_000)).toBeNull();
    expect(clampPositiveNumber('12.5', 1e6)).toBe(12.5);
  });

  it('enforces low <= mid <= high, re-deriving broken bounds', () => {
    expect(clampPriceRange(80, 100, 120)).toEqual({ low: 80, mid: 100, high: 120 });
    // low above mid -> re-derived at 0.9*mid; high below mid -> 1.1*mid
    expect(clampPriceRange(500, 100, 90)).toEqual({ low: 90, mid: 100, high: 110 });
    // missing bounds -> derived
    expect(clampPriceRange(null, 100, null)).toEqual({ low: 90, mid: 100, high: 110 });
    // non-positive mid -> impossible
    expect(clampPriceRange(1, 0, 2)).toBeNull();
    expect(clampPriceRange(1, -3, 2)).toBeNull();
  });
});

describe('templateListing (pure fallback path, SRS 7.12)', () => {
  it('always returns valid title/description for any category/condition', () => {
    const t = templateListing('Appliances', 'Good');
    expect(t.title.length).toBeGreaterThan(0);
    expect(t.title).toContain('Appliances');
    expect(t.description).toContain('appliances');
  });

  it('degrades an empty condition to "Used" without throwing', () => {
    const t = templateListing('Books', '');
    expect(t.title).toContain('Used');
  });

  it('has a stable model version tag', () => {
    expect(LISTING_MODEL_VERSION).toMatch(/^template-v\d+$/);
  });
});

describe('mapCaptionToCategory (keyword dictionary)', () => {
  it('maps caption text onto the fixed enum', () => {
    expect(mapCaptionToCategory('a mixer grinder on a table')).toBe('Appliances');
    expect(mapCaptionToCategory('a stack of textbooks')).toBe('Books');
    expect(mapCaptionToCategory('a wooden study chair')).toBe('Furniture');
    expect(mapCaptionToCategory('a laptop next to a phone')).toBe('Electronics');
    expect(mapCaptionToCategory('a packet of biscuits')).toBe('Food');
  });

  it('returns null for unmappable captions (caller falls back)', () => {
    expect(mapCaptionToCategory('a vague object')).toBeNull();
  });
});

describe('widen (range math)', () => {
  it('uses observed IQR when present, else ±10%', () => {
    expect(widen(200, 150, 250)).toEqual({ low: 150, mid: 200, high: 250 });
    expect(widen(200, null, null)).toEqual({ low: 180, mid: 200, high: 220 });
  });
});

describe('captionImage fallback (SRS 7.12: missing token)', () => {
  it('resolves null (never throws) when HF_API_TOKEN is not configured', async () => {
    // Unit-run env has no HF_API_TOKEN -> the client must bail out cleanly.
    const result = await captionImage('https://example.com/img.jpg');
    expect(result).toBeNull();
  });
});

describe('rankListings (E7.11 baseline seam)', () => {
  const candidates = [
    { id: '1', sellerId: 's2', title: 'Speaker', category: 'Electronics', price: 700, createdAt: '2026-01-01T00:00:00Z' },
    { id: '2', sellerId: 's3', title: 'Mixer', category: 'Appliances', price: 900, createdAt: '2026-01-02T00:00:00Z' },
    { id: '3', sellerId: 's4', title: 'Novel', category: 'Books', price: 120, createdAt: '2026-01-03T00:00:00Z' },
  ];

  it('ranks preferred categories first, preserving recency within tiers', () => {
    const ranked = rankListings({ userId: 'u', candidates, preferredCategories: ['Appliances', 'Books'] });
    expect(ranked.map((c) => c.id)).toEqual(['2', '3', '1']);
  });

  it('is stable with empty preferences (pure recency order)', () => {
    const ranked = rankListings({ userId: 'u', candidates, preferredCategories: [] });
    expect(ranked.map((c) => c.id)).toEqual(['3', '2', '1']);
  });
});
