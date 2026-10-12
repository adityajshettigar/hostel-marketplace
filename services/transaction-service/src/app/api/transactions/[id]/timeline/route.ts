import { getTransactionTimeline } from '../../../../../routes/timeline';

export async function GET(request: Request, ctx: { params: { id: string } }) {
  return getTransactionTimeline(request, ctx.params.id);
}
