import { getOffer } from '../../../../routes/offers';
import { withSecurity } from '@/lib/security';

// GET /api/offers/:id — the endpoint transaction-service calls to confirm a deal.
export const dynamic = 'force-dynamic';

export async function GET(request: Request, { params }: { params: { id: string } }) {
  const res = await getOffer(request, params.id);
  return withSecurity(res, request);
}
