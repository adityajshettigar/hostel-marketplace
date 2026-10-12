import { counterOffer } from '../../../../../routes/offers';
import { withSecurity } from '@/lib/security';

// PATCH /api/offers/:id/counter — seller-only, PENDING → COUNTERED + new child PENDING offer.
export const dynamic = 'force-dynamic';
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const res = await counterOffer(request, params.id);
  return withSecurity(res, request);
}
