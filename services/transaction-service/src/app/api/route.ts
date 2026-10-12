import { NextResponse } from 'next/server';
import { pool } from '../../db';

export async function GET() {
  try {
    await pool.query('SELECT 1');
    return NextResponse.json({ ok: true, service: 'transaction-service' });
  } catch (err) {
    console.error('[transaction:health]', err);
    return NextResponse.json({ ok: false, service: 'transaction-service' }, { status: 500 });
  }
}
