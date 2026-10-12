import { NextResponse } from 'next/server';
import { requireAuth, parseJsonBody, logSuggestion, internalError } from '../handlers';
import { suggestPriceSchema } from '../schemas';
import { generatePriceSuggestion } from '../suggest-price';
import { bearerToken } from '../auth';

// ---------------------------------------------------------------------------
// POST /api/suggest/price — range { low, mid, high } from marketplace SOLD
// medians; never a single "guaranteed" number. Response carries modelVersion,
// sampleSize, basis, and aiSuggestion=true.
// ---------------------------------------------------------------------------

export async function suggestPrice(request: Request) {
  try {
    const auth = await requireAuth(request);
    if ('response' in auth) return auth.response;

    const token = bearerToken(request) ?? '';
    const parsed = await parseJsonBody(request, suggestPriceSchema);
    if (!parsed.ok) return parsed.response;

    const result = await generatePriceSuggestion(parsed.data, token);

    const response = {
      suggestion: {
        low: result.range.low,
        mid: result.range.mid,
        high: result.range.high,
      },
      basis: result.basis,
      sampleSize: result.sampleSize,
      modelVersion: result.modelVersion,
      fallbackUsed: result.basis === 'FALLBACK_DEFAULT' || result.modelVersion.includes('fallback'),
      // Frontend contract: ALWAYS true — AI output is a draft to edit.
      aiSuggestion: true,
    };

    await logSuggestion({
      userId: auth.auth.sub,
      kind: 'PRICE',
      inputSnapshot: {
        category: parsed.data.category,
        condition: parsed.data.condition ?? null,
      },
      suggestion: response.suggestion,
      modelVersion: result.modelVersion,
      fallbackUsed: response.fallbackUsed,
    });

    return NextResponse.json(response, { status: 200 });
  } catch (err) {
    return internalError('suggestPrice', err);
  }
}
