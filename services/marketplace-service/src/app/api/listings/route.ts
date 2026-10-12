import { createListing, listListings } from '../../../routes/listings';
import { withSecurity } from '@/lib/security';

// POST /api/listings, GET /api/listings
export const dynamic = 'force-dynamic';
export const POST = async (request: Request) => {
  const res = await createListing(request);
  return withSecurity(res, request);
};
export const GET = async (request: Request) => {
  const res = await listListings(request);
  return withSecurity(res, request);
};
