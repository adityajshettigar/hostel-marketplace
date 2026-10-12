import { updateListingStatus } from '../../../../../routes/listings';
import { withSecurity } from '@/lib/security';

// PATCH /api/listings/:id/status — owner only, ACTIVE → SOLD (QA3 closeout).
export const dynamic = 'force-dynamic';

type Ctx = { params: { id: string } };

export async function PATCH(request: Request, { params }: Ctx) {
  const res = await updateListingStatus(request, params.id);
  return withSecurity(res, request);
}
