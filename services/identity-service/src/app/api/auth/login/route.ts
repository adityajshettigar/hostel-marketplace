import { POST as loginPOST } from '../../../../routes/login';
import { withSecurity } from '@/lib/security';

export const POST = async (request: Request) => {
  const res = await loginPOST(request);
  return withSecurity(res, request);
};
