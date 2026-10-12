import { postMessage, listMessages } from '../../../routes/messages';

export const dynamic = 'force-dynamic';

// POST /api/messages — persist + safety gate + socket delivery if online.
export async function POST(request: Request) {
  return postMessage(request);
}

// GET /api/messages?conversation_id=... — participant-only history.
export async function GET(request: Request) {
  return listMessages(request);
}
