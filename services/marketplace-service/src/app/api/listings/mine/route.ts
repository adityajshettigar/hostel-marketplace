import { listMyListings } from '../../../../routes/listings';
import { withSecurity } from '@/lib/security';
export async function GET(request: Request) {
  const res = await listMyListings(request);
  return withSecurity(res, request);
}
