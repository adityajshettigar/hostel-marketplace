import { NextResponse } from 'next/server';
import { withSecurity } from '@/lib/security';

// GET /api — service map (Phase 3: listings, search/filter, offers).
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const r = NextResponse.json({
    service: 'marketplace-service',
    status: 'ok',
    phase: 3,
    endpoints: {
      health: 'GET /api/health',
      listings: {
        create: 'POST /api/listings (verified seller)',
        search: 'GET /api/listings?q=&category=&block=&page=&limit=',
        read: 'GET /api/listings/:id',
        update: 'PATCH /api/listings/:id (owner)',
        delete: 'DELETE /api/listings/:id (owner)',
      },
      offers: {
        create: 'POST /api/offers (buyer)',
        list: 'GET /api/offers?role=buying|selling',
        read: 'GET /api/offers/:id (deal confirmation for transaction-service)',
        accept: 'PATCH /api/offers/:id/accept (seller)',
        reject: 'PATCH /api/offers/:id/reject (seller)',
        counter: 'PATCH /api/offers/:id/counter (seller)',
        withdraw: 'PATCH /api/offers/:id/withdraw (buyer)',
        expire: 'POST /api/offers/expire (cron, 48h)',
      },
    },
  });
  return withSecurity(r, request);
}
