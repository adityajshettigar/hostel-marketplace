import { markListingSoldInternal } from '../../../../../../routes/listings';

// PATCH /api/internal/listings/:id/status — service-to-service only
// (x-internal-api-key, audit Step 1b). Marks a listing terminal-SOLD after
// handover verification; never callable by end users.
export const dynamic = 'force-dynamic';

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  return markListingSoldInternal(request, params.id);
}
