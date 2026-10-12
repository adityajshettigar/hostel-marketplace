import { NextResponse } from 'next/server';
import { withSecurity } from '../../lib/security';

// Gateway root: identifies the service and points at the aggregate health.
export async function GET(request: Request) {
  const r = NextResponse.json({
    service: 'gateway',
    status: 'ok',
    phase: 7,
    health: '/api/health',
    routes: [
      '/api/identity/*',
      '/api/marketplace/*',
      '/api/communication/*',
      '/api/transaction/*',
      '/api/ai/*',
    ],
  });
  return withSecurity(r, request);
}
