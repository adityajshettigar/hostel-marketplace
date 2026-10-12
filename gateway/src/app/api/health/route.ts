import { NextResponse } from 'next/server';
import { aggregateHealth } from '../../../health';
import { withSecurity } from '../../../lib/security';

export const dynamic = 'force-dynamic';

// GET /api/health — one aggregated status report over every downstream.
export async function GET(request: Request) {
  const report = await aggregateHealth();
  const r = NextResponse.json(report);
  return withSecurity(r, request);
}
