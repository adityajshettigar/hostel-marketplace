import { NextResponse } from 'next/server';
import { withSecurity } from '@/lib/security';

// GET /api/health — liveness for the Docker HEALTHCHECK and the gateway.
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const r = NextResponse.json({
    status: 'ok',
    service: 'marketplace-service',
    phase: 3,
    timestamp: new Date().toISOString(),
  });
  return withSecurity(r, request);
}
