import { getUsersByIdsInternal } from '../../../../routes/internal';

// GET /api/internal/users?ids=a,b,c — service-to-service only
// (x-internal-api-key, handled inside the route). Batch profile read for
// transaction-service; never reachable through the gateway (the gateway has no
// /api/identity/internal mapping, and the key gate would refuse it anyway).
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  return getUsersByIdsInternal(request);
}
