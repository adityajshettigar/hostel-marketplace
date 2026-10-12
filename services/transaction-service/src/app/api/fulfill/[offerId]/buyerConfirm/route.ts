import { NextRequest } from 'next/server';
import { confirmBuyerReceipt } from '@/routes/buyer-confirm';

// POST /api/fulfill/:offerId/buyerConfirm { received: boolean } — the BUYER's
// receipt decision (yes/no) that releases the escrow to the seller.
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest, ctx: { params: { offerId: string } }) {
  return confirmBuyerReceipt(request, ctx.params.offerId);
}
