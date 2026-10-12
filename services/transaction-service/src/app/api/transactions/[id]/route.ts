import { getTransaction } from '../../../../routes/transactions';

export async function GET(request: Request, ctx: { params: { id: string } }) {
  return getTransaction(request, ctx.params.id);
}
