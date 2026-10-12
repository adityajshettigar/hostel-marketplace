// ---------------------------------------------------------------------------
// Basic per-IP rate limiting: in-memory token bucket, refill 10 tokens per
// second (per IP), bucket capacity 30. Next.js dev/prod run a single node in
// this deployment, so in-memory is correct here (per the phase text); this is
// deliberately NOT a distributed limiter.
// ---------------------------------------------------------------------------

const BUCKET_CAPACITY = 30;
const REFILL_PER_MS = 10 / 1000; // 10 tokens per second
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

type Bucket = { tokens: number; lastRefillMs: number };

const globalForBuckets = globalThis as unknown as { gatewayBuckets?: Map<string, Bucket> };

function buckets(): Map<string, Bucket> {
  if (!globalForBuckets.gatewayBuckets) globalForBuckets.gatewayBuckets = new Map();
  return globalForBuckets.gatewayBuckets;
}

function sweep(now: number): void {
  const map = buckets();
  if (now - (map.get('__sweep')?.lastRefillMs ?? 0) < CLEANUP_INTERVAL_MS) return;
  for (const [ip, b] of map) {
    if (now - b.lastRefillMs > CLEANUP_INTERVAL_MS) map.delete(ip);
  }
  map.set('__sweep', { tokens: 0, lastRefillMs: now });
}

export type RateVerdict = {
  limited: boolean;
  remaining: number;
  retryAfterSec: number;
};

export function takeToken(ip: string): RateVerdict {
  const now = Date.now();
  sweep(now);
  const map = buckets();
  let b = map.get(ip);
  if (!b) {
    b = { tokens: BUCKET_CAPACITY, lastRefillMs: now };
    map.set(ip, b);
  }
  // Refill.
  const elapsed = now - b.lastRefillMs;
  if (elapsed > 0) {
    b.tokens = Math.min(BUCKET_CAPACITY, b.tokens + elapsed * REFILL_PER_MS);
    b.lastRefillMs = now;
  }
  if (b.tokens < 1) {
    const deficit = 1 - b.tokens;
    return {
      limited: true,
      remaining: 0,
      retryAfterSec: Math.max(1, Math.ceil(deficit / REFILL_PER_MS)),
    };
  }
  b.tokens -= 1;
  return { limited: false, remaining: Math.floor(b.tokens), retryAfterSec: 0 };
}

export function clientIp(request: Request): string {
  const xf = request.headers.get('x-forwarded-for');
  if (xf) return xf.split(',')[0].trim();
  return request.headers.get('x-real-ip') ?? 'unknown';
}

// Test-only reset.
export function resetRateLimiter(): void {
  buckets().clear();
}
