import { NextResponse } from 'next/server';
import { pool } from '../db';
import { requireAuth, parseQuery, internalError } from '../handlers';
import { soldStatsQuery } from '../schemas';
import { hostelGroup, groupSql } from '../hostels';

// ---------------------------------------------------------------------------
// GET /api/stats/sold?category=&condition= — Phase 5 addition (user-approved):
// aggregate price statistics over status='SOLD' listings so ai-service can
// build ASSISTIVE price ranges. Read-only aggregates; no user content, no
// writes. Auth: any valid JWT (same as listing reads). MH/LH segregation:
// the medians only ever cover SOLD rows from the caller's own hostel group.
// ---------------------------------------------------------------------------

export async function getSoldStats(request: Request) {
  try {
    const auth = await requireAuth(request);
    if ('response' in auth) return auth.response;

    const url = new URL(request.url);
    const q = parseQuery(url, soldStatsQuery);
    if (!q.ok) return q.response;
    const { category, condition } = q.data;

    const values: unknown[] = [];
    const where: string[] = [`status = 'SOLD'`, groupSql(hostelGroup(auth.auth.hostelBlock), 'seller_block')];
    if (category) {
      values.push(category);
      where.push(`category = $${values.length}`);
    }
    if (condition) {
      values.push(condition);
      where.push(`condition = $${values.length}`);
    }

    const res = await pool.query(
      `SELECT percentile_cont(0.25) WITHIN GROUP (ORDER BY price) AS p25,
              percentile_cont(0.5)  WITHIN GROUP (ORDER BY price) AS median,
              percentile_cont(0.75) WITHIN GROUP (ORDER BY price) AS p75,
              count(*)::int AS sample_size
       FROM listings WHERE ${where.join(' AND ')}`,
      values,
    );
    const row = res.rows[0];

    return NextResponse.json({
      stats: {
        p25: row.p25 === null ? null : Number(row.p25),
        median: row.median === null ? null : Number(row.median),
        p75: row.p75 === null ? null : Number(row.p75),
        sampleSize: row.sample_size,
      },
    });
  } catch (err) {
    return internalError('getSoldStats', err, request);
  }
}
