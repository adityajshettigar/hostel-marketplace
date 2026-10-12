import { NextResponse } from 'next/server';

// Audit lapse-3 companion: the Dockerfile HEALTHCHECK probes /api/health.
// The frontend is a pure UI app — this reports liveness only (no DB/Redis).
export async function GET() {
  return NextResponse.json({ ok: true, service: 'frontend' });
}
