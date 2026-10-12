import { listAudit } from '../../../routes/admin-lists';

export async function GET(request: Request) {
  return listAudit(request);
}
