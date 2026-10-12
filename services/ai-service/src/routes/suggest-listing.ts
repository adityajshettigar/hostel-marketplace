import { NextResponse } from 'next/server';
import { requireAuth, parseJsonBody, logSuggestion, internalError } from '../handlers';
import { suggestListingSchema } from '../schemas';
import { generateListingSuggestion } from '../suggest-listing';

// ---------------------------------------------------------------------------
// POST /api/suggest/listing — ASSISTIVE, non-authoritative.
// Response always carries modelVersion, fallbackUsed and aiSuggestion=true
// (the flag the frontend uses to show "AI suggestion — edit before posting").
// ---------------------------------------------------------------------------

export async function suggestListing(request: Request) {
  try {
    const auth = await requireAuth(request);
    if ('response' in auth) return auth.response;

    const parsed = await parseJsonBody(request, suggestListingSchema);
    if (!parsed.ok) return parsed.response;

    const suggestion = await generateListingSuggestion(parsed.data);

    const response = {
      suggestion: {
        suggestedTitle: suggestion.suggestedTitle,
        suggestedCategory: suggestion.suggestedCategory,
        suggestedDescription: suggestion.suggestedDescription,
      },
      modelVersion: suggestion.modelVersion,
      fallbackUsed: suggestion.fallbackUsed,
      // Frontend contract: ALWAYS true — AI output is a draft to edit.
      aiSuggestion: true,
    };

    // Log to ai.suggestions (never breaks the response — SRS 7.12 spirit).
    await logSuggestion({
      userId: auth.auth.sub,
      kind: 'LISTING',
      inputSnapshot: {
        imageUrl: parsed.data.imageUrl,
        category: parsed.data.category ?? null,
        condition: parsed.data.condition ?? null,
      },
      suggestion: response.suggestion,
      modelVersion: suggestion.modelVersion,
      fallbackUsed: suggestion.fallbackUsed,
    });

    return NextResponse.json(response, { status: 200 });
  } catch (err) {
    return internalError('suggestListing', err);
  }
}
