import { createDispute } from '../../../../../routes/disputes';

export async function POST(request: Request, ctx: { params: { id: string } }) {
  return createDispute(request, ctx.params.id);
}
