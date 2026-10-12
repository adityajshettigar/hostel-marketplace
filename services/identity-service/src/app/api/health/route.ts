import { NextResponse } from 'next/server';
import { withSecurity } from '@/lib/security';

// GET /api/health — used by the Docker HEALTHCHECK and the gateway.
// force-dynamic so each check reflects the live process, not a build-time snapshot.
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const r = NextResponse.json({
    status: 'ok',
    service: 'identity-service',
    phase: 2,
    timestamp: new Date().toISOString(),
  });
  return withSecurity(r, request);
}
