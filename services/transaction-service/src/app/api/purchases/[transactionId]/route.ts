import { NextRequest } from 'next/server';
import { getPurchaseDetail } from '@/routes/purchases';

export async function GET(request: NextRequest, ctx: { params: { transactionId: string } }) {
  return getPurchaseDetail(request, ctx.params.transactionId);
}
