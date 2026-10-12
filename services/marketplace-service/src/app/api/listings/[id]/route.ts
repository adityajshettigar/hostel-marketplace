import { updateListing, deleteListing, getListing } from '../../../../routes/listings';
import { withSecurity } from '@/lib/security';

// PATCH / DELETE / GET /api/listings/:id
export const dynamic = 'force-dynamic';

type Ctx = { params: { id: string } };

export async function PATCH(request: Request, { params }: Ctx) {
  const res = await updateListing(request, params.id);
  return withSecurity(res, request);
}

export async function DELETE(request: Request, { params }: Ctx) {
  const res = await deleteListing(request, params.id);
  return withSecurity(res, request);
}

export async function GET(request: Request, { params }: Ctx) {
  const res = await getListing(request, params.id);
  return withSecurity(res, request);
}
