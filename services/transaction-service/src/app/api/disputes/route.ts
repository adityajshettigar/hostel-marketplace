import { listDisputes } from '../../../routes/admin-lists';

export async function GET(request: Request) {
  return listDisputes(request);
}
