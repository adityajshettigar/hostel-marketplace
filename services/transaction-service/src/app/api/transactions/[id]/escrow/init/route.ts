import { initEscrow } from '../../../../../../routes/escrow';

export async function POST(request: Request, ctx: { params: { id: string } }) {
  return initEscrow(request, ctx.params.id);
}
