import { NextResponse } from 'next/server';
import { pool } from '../../../db';

// GET /api/health — alias of the root /api health route so the Phase 7
// gateway aggregate (which probes <service>/api/health) sees this service.
export async function GET() {
  try {
    await pool.query('SELECT 1');
    return NextResponse.json({ ok: true, service: 'transaction-service' });
  } catch (err) {
    console.error('[transaction:health]', err);
    return NextResponse.json({ ok: false, service: 'transaction-service' }, { status: 500 });
  }
}
