import { withdrawOffer } from '../../../../../routes/offers';

// PATCH /api/offers/:id/withdraw — buyer-only, PENDING → WITHDRAWN.
export const dynamic = 'force-dynamic';

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  return withdrawOffer(request, params.id);
}
