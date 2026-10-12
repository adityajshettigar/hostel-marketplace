import { resolveDispute } from '../../../../../routes/disputes';

export async function PATCH(request: Request, ctx: { params: { id: string } }) {
  return resolveDispute(request, ctx.params.id);
}
