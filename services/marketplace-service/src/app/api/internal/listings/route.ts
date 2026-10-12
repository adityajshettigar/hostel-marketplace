import { getListingsByIdsInternal } from '../../../../routes/listings';

// GET /api/internal/listings?ids=a,b,c — service-to-service only
// (x-internal-api-key). Batch display read for transaction-service (purchase
// history / fulfilment timeline); never callable by end users.
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  return getListingsByIdsInternal(request);
}
