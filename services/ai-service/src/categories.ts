// ---------------------------------------------------------------------------
// Fixed marketplace category enum (mirrors marketplace-service src/schemas.ts)
// and the caption-keyword dictionary that maps HF caption text onto it.
// Deliberately simple and auditable — Phase 5 is a rule-based assistive
// engine; a learned classifier can replace mapCaptionToCategory later
// without changing the API contract.
// ---------------------------------------------------------------------------

export const LISTING_CATEGORIES = ['Books', 'Electronics', 'Furniture', 'Appliances', 'Food'] as const;
export type ListingCategory = (typeof LISTING_CATEGORIES)[number];

export const LISTING_CONDITIONS = ['New', 'Like New', 'Good', 'Fair', 'Worn'] as const;
export type ListingCondition = (typeof LISTING_CONDITIONS)[number];

export function isCategory(value: string): value is ListingCategory {
  return (LISTING_CATEGORIES as readonly string[]).includes(value);
}

// Caption keyword -> category. First matching keyword in caption order wins;
// iteration order of this map is therefore meaningful (most specific stems
// first, e.g. "textbook" before "book").
export const CATEGORY_KEYWORDS: Record<ListingCategory, string[]> = {
  Electronics: [
    'laptop',
    'phone',
    'smartphone',
    'charger',
    'earphone',
    'earbud',
    'headphone',
    'keyboard',
    'mouse',
    'monitor',
    'camera',
    'speaker',
    'tablet',
    'router',
    'cable',
    'electronic',
    'device',
    'screen',
  ],
  Books: ['textbook', 'book', 'notebook', 'novel', 'magazine', 'pages', 'paperback', 'hardcover'],
  Furniture: [
    'table',
    'desk',
    'chair',
    'shelf',
    'bookshelf',
    'sofa',
    'couch',
    'bed',
    'mattress',
    'wardrobe',
    'cupboard',
    'stool',
    'furniture',
    'wooden',
  ],
  Appliances: [
    'mixer',
    'grinder',
    'fan',
    'heater',
    'iron',
    'kettle',
    'microwave',
    'fridge',
    'refrigerator',
    'washing',
    'appliance',
    'toaster',
    'cooker',
  ],
  Food: ['snack', 'biscuit', 'instant noodles', 'coffee', 'tea', 'chocolate', 'food', 'packet'],
};

// Map free caption text to the fixed enum, or null when nothing matches
// (caller then falls back to the seller-provided category).
// Scoring: the category with the MOST keyword hits wins (so "a mixer grinder
// on a table" is Appliances even though "table" is a Furniture keyword);
// ties break by earliest keyword occurrence, then by enum order.
export function mapCaptionToCategory(caption: string): ListingCategory | null {
  const text = caption.toLowerCase();
  let best: { category: ListingCategory; hits: number; firstPos: number } | null = null;

  for (const category of LISTING_CATEGORIES) {
    const keywords = CATEGORY_KEYWORDS[category] ?? [];
    let hits = 0;
    let firstPos = Number.POSITIVE_INFINITY;
    for (const kw of keywords) {
      const pos = text.indexOf(kw);
      if (pos !== -1) {
        hits += 1;
        if (pos < firstPos) firstPos = pos;
      }
    }
    if (hits > 0 && (!best || hits > best.hits || (hits === best.hits && firstPos < best.firstPos))) {
      best = { category, hits, firstPos };
    }
  }
  return best ? best.category : null;
}
