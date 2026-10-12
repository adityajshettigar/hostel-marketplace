import { createConversation, listConversations } from '../../../routes/conversations';

export const dynamic = 'force-dynamic';

// POST /api/conversations — buyer starts a conversation on a listing_id.
export async function POST(request: Request) {
  return createConversation(request);
}

// GET /api/conversations — my threads (as buyer or seller).
export async function GET(request: Request) {
  return listConversations(request);
}
