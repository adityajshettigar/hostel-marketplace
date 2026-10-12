import { NextResponse } from 'next/server';
import { pool } from '../db';

export const dynamic = 'force-dynamic';

// GET /api/health — liveness/readiness (service + DB roundtrip).
export async function GET() {
  try {
    await pool.query('SELECT 1');
    return NextResponse.json({
      ok: true,
      service: 'ai-service',
      db: 'up',
      time: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[ai:health]', err);
    return NextResponse.json({ ok: false, service: 'ai-service', db: 'down' }, { status: 503 });
  }
}
