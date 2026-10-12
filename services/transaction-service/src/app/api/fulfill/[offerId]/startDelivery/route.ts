import { NextRequest } from 'next/server';
import { startDelivery } from '@/routes/start-delivery';

// POST /api/fulfill/:offerId/startDelivery — SELLER only (shared code path in
// routes/start-delivery.ts, so the buyer/escrow preconditions cannot drift).
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest, ctx: { params: { offerId: string } }) {
  return startDelivery(request, ctx.params.offerId);
}
