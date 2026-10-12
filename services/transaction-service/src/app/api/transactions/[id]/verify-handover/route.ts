import { verifyHandover } from '../../../../../routes/handover';

export async function POST(request: Request, ctx: { params: { id: string } }) {
  return verifyHandover(request, ctx.params.id);
}
