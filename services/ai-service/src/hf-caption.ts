// ---------------------------------------------------------------------------
// Hugging Face Inference API image-captioning client (FREE tier, no paid API).
//
// Contract: `captionImage` RESOLVES to a caption string on success and
// RESOLVES to `null` on ANY failure (missing token, network error, timeout,
// non-200, unexpected shape, empty caption). It never throws — callers use
// the null to fall back to the pure template path (SRS 7.12: AI must never
// hard-fail the listing flow).
// ---------------------------------------------------------------------------

import { env } from './env';

export type CaptionResult = {
  caption: string;
  model: string;
} | null;

// Extract the caption from the known HF response shapes:
//   [{ generated_text: "..." }]            (most image-captioning models)
//   { generated_text: "..." }              (some wrappers)
function extractCaption(body: unknown): string | null {
  if (Array.isArray(body)) {
    const first = body[0] as { generated_text?: unknown } | undefined;
    if (first && typeof first.generated_text === 'string') return first.generated_text;
    return null;
  }
  if (body && typeof body === 'object' && 'generated_text' in body) {
    const gt = (body as { generated_text?: unknown }).generated_text;
    if (typeof gt === 'string') return gt;
  }
  return null;
}

export async function captionImage(imageUrl: string): Promise<CaptionResult> {
  const token = env.HF_API_TOKEN;
  if (!token) return null; // no token configured -> template fallback

  try {
    const res = await fetch(`${env.HF_API_URL}/${env.HF_CAPTION_MODEL}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ inputs: imageUrl }),
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) return null;

    const caption = extractCaption(await res.json().catch(() => null));
    if (!caption || caption.trim().length === 0) return null;

    return { caption: caption.trim(), model: env.HF_CAPTION_MODEL };
  } catch {
    return null; // network/timeout/parse failure -> template fallback
  }
}
