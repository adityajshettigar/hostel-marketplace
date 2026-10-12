import { NextRequest } from 'next/server';
import { listPurchases } from '@/routes/purchases';

export async function GET(request: NextRequest) {
  return listPurchases(request);
}
