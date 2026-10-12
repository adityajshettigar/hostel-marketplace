import { getConversation } from '../../../../routes/conversations';

export const dynamic = 'force-dynamic';

type Ctx = { params: { id: string } };

// GET /api/conversations/:id — participants only.
export async function GET(request: Request, { params }: Ctx) {
  return getConversation(request, params.id);
}
