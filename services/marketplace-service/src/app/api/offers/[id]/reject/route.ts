import { rejectOffer } from '../../../../../routes/offers';
import { withSecurity } from '@/lib/security';

// PATCH /api/offers/:id/reject — seller-only, PENDING → REJECTED (terminal).
export const dynamic = 'force-dynamic';
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const res = await rejectOffer(request, params.id);
  return withSecurity(res, request);
}
