import { getHandoverCredential } from '../../../../../routes/handover-credential';

export async function GET(request: Request, ctx: { params: { id: string } }) {
  return getHandoverCredential(request, ctx.params.id);
}
