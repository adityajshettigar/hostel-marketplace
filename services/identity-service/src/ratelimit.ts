import { createClient } from 'redis';
import { NextResponse } from 'next/server';
import { withSecurity } from '@/lib/security';

// ---------------------------------------------------------------------------
// Redis-backed fixed-window rate limiter (audit Step 2b).
//
// Policy (user decision Q1): FAIL-CLOSED — if Redis is unreachable, requests
// are rejected (503) rather than allowed through unthrottled.
//
// Scope: POST /api/auth/login only, 5 requests / 60 s / client IP.
//
// Client IP derivation (documented per 2b): the FIRST entry of
// `x-forwarded-for` is trusted — this service is deployed behind the gateway
// / a reverse proxy, which overwrites (does not append to) that header, so the
// left-most value is the real client. A socket-level fallback
// (x-real-ip) is used when the header is absent; otherwise "unknown".
// The connection's remote address is not used because behind the gateway it
// is always the gateway itself.
//
// The Redis connection is LAZY (created on first limit call, reused after) so
// `next build` still passes without runtime env.
// ---------------------------------------------------------------------------

const WINDOW_SECONDS = 60;
const MAX_REQUESTS = 5;

type RedisLike = {
  multi: () => {
    incr: (key: string) => unknown;
    expire: (key: string, seconds: number) => unknown;
    exec: () => Promise<unknown[] | null>;
  };
};

const globalForRedis = globalThis as unknown as { identityRedis?: RedisLike };

async function getRedis(): Promise<RedisLike> {
  if (!globalForRedis.identityRedis) {
    const url = process.env.REDIS_URL || 'redis://localhost:6379';
    const client = createClient({ url });
    client.on('error', () => {
      // Keep the process alive; errors surface as fail-closed 503s below.
    });
    await client.connect();
    globalForRedis.identityRedis = client as unknown as RedisLike;
  }
  return globalForRedis.identityRedis;
}

export function clientIpOf(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }
  return request.headers.get('x-real-ip')?.trim() || 'unknown';
}

export type LimitResult = { ok: true } | { ok: false; response: NextResponse };

export async function rateLimit(request: Request, scope: string): Promise<LimitResult> {
  const ip = clientIpOf(request);
  const key = `ratelimit:${scope}:${ip}`;

  try {
    const redis = await getRedis();
    const tx = redis.multi();
    tx.incr(key);
    tx.expire(key, WINDOW_SECONDS);
    const results = (await tx.exec()) as unknown;
    // node-redis v4 exec() resolves to a plain array of values (no [err, val]
    // tuples like ioredis), so unwrap whichever shape comes back.
    const first = Array.isArray(results) ? (results[0] as unknown) : results;
    const count = Number(Array.isArray(first) ? first[1] : first) || 0;
    if (count > MAX_REQUESTS) {
      const r = NextResponse.json(
        {
          error: 'RATE_LIMITED',
          message: `Too many requests. Limit is ${MAX_REQUESTS} per ${WINDOW_SECONDS}s per IP.`,
        },
        {
          status: 429,
          headers: { 'Retry-After': String(WINDOW_SECONDS) },
        },
      );
      return { ok: false, response: withSecurity(r) };
    }
    return { ok: true };
  } catch (err) {
    // Q1 decision: FAIL-CLOSED — Redis down means reject.
    console.error('[identity:ratelimit] Redis unavailable, failing closed:', err);
    const r = NextResponse.json(
      {
        error: 'SERVICE_UNAVAILABLE',
        message: 'Rate limiter backend unavailable; try again shortly',
      },
      { status: 503, headers: { 'Retry-After': String(WINDOW_SECONDS) } },
    );
    return { ok: false, response: withSecurity(r) };
  }
}
