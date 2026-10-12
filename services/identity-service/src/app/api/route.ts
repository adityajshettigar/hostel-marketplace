import { NextResponse } from 'next/server';
import { withSecurity } from '@/lib/security';

// Phase 1 scaffold: placeholder for identity-service App Router routes.
export async function GET(request: Request) {
  const r = NextResponse.json({
    service: 'identity-service',
    status: 'scaffolding',
    phase: 1,
    method: 'GET',
  });
  return withSecurity(r, request);
}
