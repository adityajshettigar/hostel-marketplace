import { suggestPrice } from '../../../../routes/suggest-price';

export const dynamic = 'force-dynamic';

// POST /api/suggest/price — SOLD-median { low, mid, high } range.
export async function POST(request: Request) {
  return suggestPrice(request);
}
