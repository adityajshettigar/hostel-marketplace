import { getRecommendations } from '../../../routes/recommendations';

export const dynamic = 'force-dynamic';

// GET /api/recommendations?userId=... — E7.11 cold-start-safe baseline.
export async function GET(request: Request) {
  return getRecommendations(request);
}
