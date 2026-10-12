import { NextResponse } from 'next/server';
import { pool } from '../../../db';
import { ioAttached } from '../../../realtime';

export const dynamic = 'force-dynamic';

// GET /api/health — liveness/readiness (service + DB roundtrip + socket state).
export async function GET() {
  try {
    await pool.query('SELECT 1');
    return NextResponse.json({
      ok: true,
      service: 'communication-service',
      db: 'up',
      socket: ioAttached() ? 'attached' : 'not-attached',
      time: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[communication:health]', err);
    return NextResponse.json({ ok: false, service: 'communication-service', db: 'down' }, { status: 503 });
  }
}
