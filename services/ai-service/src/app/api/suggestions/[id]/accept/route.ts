import { acceptSuggestion } from '../../../../../routes/suggestions-accept';

export const dynamic = 'force-dynamic';

type Ctx = { params: { id: string } };

// PATCH /api/suggestions/:id/accept — owner-only accepted_by_user flip.
export async function PATCH(request: Request, { params }: Ctx) {
  return acceptSuggestion(request, params.id);
}
