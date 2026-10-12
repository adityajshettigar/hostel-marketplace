import { getSoldStats } from '../../../../routes/stats';

export const dynamic = 'force-dynamic';

// GET /api/stats/sold?category=&condition= — aggregate medians over SOLD
// listings (Phase 5, consumed by ai-service).
export async function GET(request: Request) {
  return getSoldStats(request);
}
