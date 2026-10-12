import { markNotificationRead } from '../../../../../routes/notifications';

export const dynamic = 'force-dynamic';

type Ctx = { params: { id: string } };

// PATCH /api/notifications/:id/read — owner-only read receipt.
export async function PATCH(request: Request, { params }: Ctx) {
  return markNotificationRead(request, params.id);
}
