import { createOffer, listOffers } from '../../../routes/offers';
import { withSecurity } from '@/lib/security';

// POST /api/offers, GET /api/offers?role=buying|selling
export const dynamic = 'force-dynamic';
export const POST = async (request: Request) => {
  const res = await createOffer(request);
  return withSecurity(res, request);
};
export const GET = async (request: Request) => {
  const res = await listOffers(request);
  return withSecurity(res, request);
};
