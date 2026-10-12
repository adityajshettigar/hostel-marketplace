import { NextResponse } from 'next/server';
import { bearerToken, verifyAccessToken } from './auth';
import { env } from './env';
import { withSecurity } from './lib/security';

// ---------------------------------------------------------------------------
// Routing table + structured request logging.
// ---------------------------------------------------------------------------

export type ServiceRoute = {
  service: string;
  target: string;
  // /api/identity/auth/* passes through WITHOUT a JWT (login/register/OTP);
  // everything else requires a verified JWT.
  authBypass: boolean;
};

export function resolveRoute(pathname: string): ServiceRoute | null {
  if (pathname === '/api' || pathname === '/api/' || pathname === '/api/health') return null;
  if (pathname.startsWith('/api/identity/')) {
    return {
      service: 'identity',
      target: env.SERVICE_IDENTITY_URL,
      authBypass: /^\/api\/identity\/auth\//.test(pathname),
    };
  }
  if (pathname.startsWith('/api/marketplace/')) {
    return { service: 'marketplace', target: env.SERVICE_MARKETPLACE_URL, authBypass: false };
  }
  if (pathname.startsWith('/api/communication/')) {
    return { service: 'communication', target: env.SERVICE_COMMUNICATION_URL, authBypass: false };
  }
  if (pathname.startsWith('/api/transaction/')) {
    return { service: 'transaction', target: env.SERVICE_TRANSACTION_URL, authBypass: false };
  }
  if (pathname.startsWith('/api/ai/')) {
    return { service: 'ai', target: env.SERVICE_AI_URL, authBypass: false };
  }
  return null;
}

// Strips the mounted gateway prefix: /api/marketplace/listings → /api/listings
export function downstreamPath(pathname: string): string {
  const rest = pathname.replace(/^\/api\/(identity|marketplace|communication|transaction|ai)\//, '');
  return `/api/${rest}`;
}

const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'transfer-encoding',
  'upgrade',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'host',
  'content-length',
]);

export async function forward(
  request: Request,
  route: ServiceRoute,
  pathname: string,
  search: string,
): Promise<Response> {
  // 1. JWT gate (except /api/identity/auth/*). Nothing is stripped or
  //    re-signed: the ORIGINAL Authorization header is forwarded as-is.
  if (!route.authBypass) {
    const token = bearerToken(request);
    if (!token) {
      const r = NextResponse.json(
        { error: 'UNAUTHORIZED', message: 'Missing Bearer token' },
        { status: 401 },
      );
      return withSecurity(r, request);
    }
    const auth = await verifyAccessToken(token);
    if (!auth) {
      const r = NextResponse.json(
        { error: 'UNAUTHORIZED', message: 'Invalid or expired token' },
        { status: 401 },
      );
      return withSecurity(r, request);
    }
  }

  // 2. Forward with X-Service-Key so downstream can distinguish
  //    gateway-forwarded traffic from direct calls (enforcement on the
  //    service side is a later phase — user decision: gateway-only now).
  const headers = new Headers();
  request.headers.forEach((value, key) => {
    if (!HOP_BY_HOP.has(key.toLowerCase())) headers.set(key, value);
  });
  if (env.INTERNAL_SERVICE_KEY) {
    headers.set('x-service-key', env.INTERNAL_SERVICE_KEY);
  }

  const url = `${route.target}${downstreamPath(pathname)}${search}`;
  const upstream = await fetch(url, {
    method: request.method,
    headers,
    body:
      request.method === 'GET' || request.method === 'HEAD' ? undefined : await request.arrayBuffer(),
    signal: AbortSignal.timeout(15000),
  });
  // undici marks the headers of a fetch-created Response immutable, so the
  // shared withSecurity wrapper (which sets security/CORS headers) would throw
  // `TypeError: immutable` on every proxied response. Rebuild the Response
  // with a mutable copy of the upstream headers first.
  const res = new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: new Headers(upstream.headers),
  });
  // Attach security headers to the upstream response (don't clobber upstream
  // headers — just ensure ours are present on top).
  return withSecurity(res, request);
}

export function logRequest(
  service: string,
  method: string,
  path: string,
  status: number,
  startedAtMs: number,
  extra: Record<string, unknown> = {},
): void {
  const latencyMs = Date.now() - startedAtMs;
  console.log(
    JSON.stringify({
      ts: new Date().toISOString(),
      svc: 'gateway',
      route: service,
      method,
      path,
      status,
      latencyMs,
      ...extra,
    }),
  );
}
