// Shared security headers + CORS helpers for all hostel-marketplace services.
// Imported by every service's route handlers, the shared middleware, and the
// gateway so that EVERY API response carries helmet-equivalent headers without
// repeating the logic. (Phase 9, items 1 & 2.)
//
// Usage (in each route file / middleware):
//   import { withSecurity, corsHeaders, preflightResponse } from '@/lib/security'
//   return withSecurity(NextResponse.json(payload, { status: 200 }), request)
//
// The headers are deliberately conservative: they harden every response
// (including 4xx/5xx) so a malformed request cannot leak differently from a
// normal one through missing headers.

// ── Security (helmet-equivalent) headers ────────────────────────────────────
//
// Content-Security-Policy is for an API that returns JSON only: nothing may be
// loaded, framed, or submitted, so `default-src 'none'` with explicit denial of
// framing/base-uri/form-action is the strictest useful policy.
const securityHeaders: Record<string, string> = {
  'Content-Security-Policy':
    "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'; img-src 'none'; script-src 'none'; style-src 'none'; object-src 'none'",
  // Prevent clickjacking: no framing at all (DENY). The frontend is the only
  // UI and it never needs to be embedded; the API returns JSON only.
  'X-Frame-Options': 'DENY',
  // Stop browsers from MIME-sniffing a response away from its declared type.
  'X-Content-Type-Options': 'nosniff',
  // Force HTTPS for this origin and its subdomains (the gateway terminates TLS;
  // services are not exposed directly). Still set so downstream proxies get the
  // hint and direct-port access is upgraded.
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
  // Disable speculative DNS prefetching (reduces passive fingerprinting).
  'X-DNS-Prefetch-Control': 'off',
  // Never leak the full URL of this API response to third parties.
  'Referrer-Policy': 'no-referrer',
  // A JSON API response must never be cached or persisted by the browser.
  'Cache-Control': 'no-store, max-age=0, must-revalidate',
  // Hide the framework/server signature from response headers.
  'X-Powered-By': 'none',
}

// ── CORS headers ─────────────────────────────────────────────────────────────
//
// Locked to the known frontend/gateway origins only (Phase 9, item 2). The
// origin is read from env and validated against an allow-list before ANY CORS
// header is emitted; an unknown origin gets only `Vary: Origin` so the browser
// rejects the response rather than granting access.
//
// Ordered by specificity: FRONTEND_ORIGIN (if a deploy sets it explicitly),
// then NEXT_PUBLIC_GATEWAY_URL (the configured frontend API base), then the
// generic FRONTEND_URL fallback.
const CONFIGURED_ORIGIN =
  process.env.FRONTEND_ORIGIN ??
  process.env.NEXT_PUBLIC_GATEWAY_URL ??
  process.env.FRONTEND_URL ??
  ''

// Allowed origins: the configured origin plus explicit localhost dev origins.
// If nothing is configured the list is empty → CORS is effectively disabled
// (no origin is ever allowed), which is the fail-closed default.
const ALLOWED_ORIGINS: string[] = CONFIGURED_ORIGIN
  ? [CONFIGURED_ORIGIN, 'http://localhost:3000', 'http://localhost:4000']
  : []

function isAllowed(origin: string | null): boolean {
  if (!origin) return false
  return ALLOWED_ORIGINS.includes(origin)
}

export function corsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get('origin')

  if (!isAllowed(origin)) {
    // Not an allowed origin: emit the bare minimum so the browser rejects the
    // response rather than granting access.
    return { Vary: 'Origin' }
  }

  return {
    'Access-Control-Allow-Origin': origin as string,
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers':
      'authorization, content-type, x-service-key, x-internal-api-key, x-forwarded-for, x-real-ip, x-razorpay-signature, x-razorpay-event-id',
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  }
}

// Apply the security headers (and the CORS headers for an allowed origin) to a
// Response in place and return it. Generic so a NextResponse in yields a
// NextResponse out (callers rely on NextResponse's extra API). `request` is
// optional so callers that only need the security headers (e.g. the rate
// limiter) can omit it.
export function withSecurity<T extends Response>(response: T, request?: Request): T {
  for (const [key, value] of Object.entries(securityHeaders)) {
    // Never clobber a route's explicit caching policy (e.g. the public JWKS
    // endpoint sets Cache-Control: public); only default to no-store when the
    // response has not declared one.
    if (key === 'Cache-Control' && response.headers.has('Cache-Control')) continue
    response.headers.set(key, value)
  }
  if (request) {
    for (const [key, value] of Object.entries(corsHeaders(request))) {
      response.headers.set(key, value)
    }
  }
  return response
}

// Preflight response for an OPTIONS request: 204 with CORS + security headers.
export function preflightResponse(request: Request): Response {
  return withSecurity(new Response(null, { status: 204 }), request)
}

// Derive the effective frontend origin for this deployment (used by the
// gateway's logging/CORS). Falls back to the local dev server.
export function frontendOrigin(): string {
  return (
    process.env.FRONTEND_ORIGIN ??
    process.env.NEXT_PUBLIC_GATEWAY_URL ??
    process.env.FRONTEND_URL ??
    'http://localhost:3000'
  )
}
