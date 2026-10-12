import { forward, logRequest, resolveRoute } from '../../../proxy';
import { takeToken, clientIp } from '../../../ratelimit';
import { withSecurity, preflightResponse } from '../../../lib/security';

export const dynamic = 'force-dynamic';

// ---------------------------------------------------------------------------
// Gateway catch-all: /api/identity/*, /api/marketplace/*,
// /api/communication/*, /api/transaction/*, /api/ai/* → the matching
// SERVICE_*_URL. Rate limited per IP, JWT-verified (except identity auth),
// X-Service-Key added, original Authorization forwarded untouched.
//
// Phase 9 (items 1 & 2): every response — success, 4xx, 5xx — is wrapped with
// the helmet-equivalent security headers and the locked-down CORS headers, and
// OPTIONS preflights are answered here without touching an upstream.
// ---------------------------------------------------------------------------

async function handle(request: Request, ctx: { params: { path: string[] } }): Promise<Response> {
  // Answer CORS preflight at the gateway edge, never a service round-trip.
  if (request.method === 'OPTIONS') {
    return preflightResponse(request);
  }

  const started = Date.now();
  const { pathname, search } = new URL(request.url);
  const full = pathname;
  const route = resolveRoute(full);
  const method = request.method;

  if (!route) {
    logRequest('none', method, full, 404, started);
    return withSecurity(
      Response.json({ error: 'NOT_FOUND', message: 'Unknown gateway route' }, { status: 404 }),
      request,
    );
  }

  // Rate limit before anything else (per-IP token bucket).
  const ip = clientIp(request);
  const verdict = takeToken(ip);
  if (verdict.limited) {
    logRequest(route.service, method, full, 429, started, { ip });
    return withSecurity(
      Response.json(
        { error: 'RATE_LIMITED', message: 'Too many requests; slow down' },
        { status: 429, headers: { 'retry-after': String(verdict.retryAfterSec) } },
      ),
      request,
    );
  }

  try {
    const res = await forward(request, route, full, search);
    logRequest(route.service, method, full, res.status, started, { ip });
    return withSecurity(res, request);
  } catch (err) {
    console.error('[gateway] upstream error', err);
    logRequest(route.service, method, full, 502, started, { ip });
    return withSecurity(
      Response.json(
        { error: 'BAD_GATEWAY', message: `Upstream ${route.service}-service unreachable` },
        { status: 502 },
      ),
      request,
    );
  }
}

export const GET = handle;
export const POST = handle;
export const PATCH = handle;
export const PUT = handle;
export const DELETE = handle;
export const OPTIONS = handle;
