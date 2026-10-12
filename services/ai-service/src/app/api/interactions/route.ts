import { createInteraction } from '../../../routes/interactions';

export const dynamic = 'force-dynamic';

// POST /api/interactions — behavior log (VIEW/SEARCH) for the baseline ranker.
export async function POST(request: Request) {
  return createInteraction(request);
}
