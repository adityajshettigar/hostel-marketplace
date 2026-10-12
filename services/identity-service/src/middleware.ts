import { NextResponse } from 'next/server';
import { withSecurity, preflightResponse } from '@/lib/security';

// ---------------------------------------------------------------------------
// ONE shared X-Service-Key gate (audit Step 2a, N2 fix) + Phase 9 security
// headers/CORS.
//
// The gateway (Phase 7) injects `x-service-key` on EVERY forwarded request.
// This middleware rejects direct-port traffic that bypasses the gateway with
// 403 unless it presents the same shared key — so gateway auth, rate limiting
// and request logging cannot be sidestepped.
//
// Phase 9 (items 1 & 2): this is also the single point where every /api/**
// response is stamped with the helmet-equivalent security headers and the
// locked-down CORS headers (including OPTIONS preflights), so no route handler
// can accidentally omit them.
//
// Exempt paths (never gated):
//   /api            — root service-identity info route (same class as health).
//   /api/health     — container healthchecks run INSIDE the container network
//                     but outside the gateway (Dockerfile HEALTHCHECK).
//   /.well-known/*  — public JWKS consumed by every service's JWT verifier.
//   /api/webhooks/* — third-party callbacks (Razorpay) authenticate with their
//                     own HMAC signature, not with our internal key.
//   /api/internal/* — the x-internal-api-key service-to-service routes
//                     authenticate with the shared internal key themselves.
//
// Edge-runtime safe: the middleware runtime has no node:crypto, so the key
// compare hashes both sides with WebCrypto SHA-256 first and constant-time
// compares the equal-length digests.
// ---------------------------------------------------------------------------
const EXEMPT_PREFIXES = ['/api/health', '/.well-known/', '/api/webhooks/', '/api/internal'];

function hex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function middleware(request: Request) {
  // Phase 9 (item 2): answer every CORS preflight centrally with the locked
  // allow-list, then stop — preflights must not run the key gate or handlers.
  if (request.method === 'OPTIONS') {
    return preflightResponse(request);
  }

  const { pathname } = new URL(request.url);
  if (pathname === '/api' || EXEMPT_PREFIXES.some((p) => pathname === p || pathname.startsWith(p))) {
    // Exempt paths skip the key gate but still carry security headers.
    return withSecurity(NextResponse.next(), request);
  }

  const expected = process.env.INTERNAL_SERVICE_API_KEY;
  if (!expected) {
    // Fail-closed: refuse everything rather than run an ungated service.
    const r = NextResponse.json(
      { error: 'FORBIDDEN', message: 'Service is gateway-only (service key not configured)' },
      { status: 503 },
    );
    return withSecurity(r, request);
  }

  const provided = request.headers.get('x-service-key') ?? '';
  const enc = new TextEncoder();
  const [digestA, digestB] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(provided)),
    crypto.subtle.digest('SHA-256', enc.encode(expected)),
  ]);
  const a = hex(digestA);
  const b = hex(digestB);
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  if (diff !== 0) {
    const r = NextResponse.json(
      { error: 'FORBIDDEN', message: 'Missing or invalid x-service-key header' },
      { status: 403 },
    );
    return withSecurity(r, request);
  }

  // Gate passed: continue to the route handler, carrying the security headers
  // so the final API response is hardened too.
  return withSecurity(NextResponse.next(), request);
}

export const config = {
  matcher: ['/api/:path*', '/.well-known/:path*'],
};
