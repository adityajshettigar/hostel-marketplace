// ---------------------------------------------------------------------------
// Listing assistance engine (SRS Phase 5 / SRS 7.8 / SRS 7.12).
//
// Flow: optional HF image caption -> keyword dictionary category -> template
// title/description. If the caption is missing (no token, API down, bad
// response — SRS 7.12 AI-failure-handling), a pure template from the
// seller-provided category/condition is used instead. The listing flow must
// NEVER hard-fail: this function always returns a valid clamped suggestion.
//
// All outputs are ASSISTIVE and non-authoritative: the frontend labels them
// "AI suggestion — edit before posting" (aiSuggestion=true) and the seller
// still controls what is actually published.
//
// Seam for later models: generateListingSuggestion() is the only function the
// route calls; swapping in a real model means replacing its internals, not
// the API contract.
// ---------------------------------------------------------------------------

import { env } from './env';
import { captionImage } from './hf-caption';
import { mapCaptionToCategory, ListingCategory, LISTING_CATEGORIES } from './categories';
import { clampCategory, clampText } from './clamp';

export const LISTING_MODEL_VERSION = 'template-v1';

export type ListingSuggestionInput = {
  imageUrl: string;
  category?: string | null; // seller-provided hint, may be absent/invalid
  condition?: string | null;
};

export type ListingSuggestion = {
  suggestedTitle: string;
  suggestedCategory: ListingCategory;
  suggestedDescription: string;
  modelVersion: string;
  fallbackUsed: boolean;
};

// Pure template — deterministic, no network. Used as fallback AND as the
// scaffolding the caption is merged into.
export function templateListing(
  category: ListingCategory,
  condition: string,
): { title: string; description: string } {
  const conditionLabel = condition.trim().length > 0 ? condition : 'Used';
  return {
    title: `${conditionLabel} ${category} — hostel deal`,
    description: `Selling a ${conditionLabel.toLowerCase()} ${category.toLowerCase()}. Message me in chat for details and pickup.`,
  };
}

export async function generateListingSuggestion(
  input: ListingSuggestionInput,
): Promise<ListingSuggestion> {
  // Seller-provided hints, clamped up front (never trusted as-is).
  const hintCategory = clampCategory(input.category);
  const hintCondition = clampText(input.condition ?? '', 20, 'Used');

  // 1. Optional caption (null on ANY failure).
  const captionResult = await captionImage(input.imageUrl);
  const caption = captionResult?.caption ?? null;

  if (!caption) {
    // 2. Fallback: pure template from seller-provided category/condition
    //    (category itself already clamped; if the seller gave an invalid one
    //    we degrade to the first fixed enum value — output must always be
    //    enum-valid per SRS 7.8).
    const t = templateListing(hintCategory ?? LISTING_CATEGORIES[0], hintCondition);
    return {
      suggestedTitle: t.title,
      suggestedCategory: hintCategory ?? LISTING_CATEGORIES[0],
      suggestedDescription: t.description,
      modelVersion: `${LISTING_MODEL_VERSION} (no-caption-fallback)`,
      fallbackUsed: true,
    };
  }

  // 3. Caption keyword -> fixed enum category; fall back to seller hint.
  const captionCategory = mapCaptionToCategory(caption) ?? hintCategory ?? LISTING_CATEGORIES[0];
  const t = templateListing(captionCategory, hintCondition);

  // 4. Merge the caption into the template, then clamp EVERYTHING (SRS 7.8):
  //    title <= 120 chars, description <= 500, all non-empty.
  const captionTitlePart = clampText(caption, 60, `${captionCategory} item`);
  const description = clampText(
    `${caption} — ${t.description}`,
    500,
    t.description,
  );

  return {
    suggestedTitle: clampText(`${captionTitlePart} (${captionCategory})`, 120, t.title),
    suggestedCategory: captionCategory,
    suggestedDescription: description,
    // Model version string documents exactly what produced this output.
    modelVersion: captionResult ? `${captionResult.model}+${LISTING_MODEL_VERSION}` : LISTING_MODEL_VERSION,
    fallbackUsed: false,
  };
}
