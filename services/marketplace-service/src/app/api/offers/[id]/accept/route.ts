import { acceptOffer } from '../../../../../routes/offers';
import { withSecurity } from '@/lib/security';

// PATCH /api/offers/:id/accept — seller-only, PENDING → ACCEPTED (terminal).
export const dynamic = 'force-dynamic';
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const res = await acceptOffer(request, params.id);
  return withSecurity(res, request);
}
