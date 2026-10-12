import { createNotification, listNotifications } from '../../../routes/notifications';

export const dynamic = 'force-dynamic';

// POST /api/notifications — INTERNAL ONLY (x-internal-api-key, not a JWT).
export async function POST(request: Request) {
  return createNotification(request);
}

// GET /api/notifications — the caller's own notifications (JWT).
export async function GET(request: Request) {
  return listNotifications(request);
}
