import { POST as logoutPOST } from '../../../../routes/logout';
import { withSecurity } from '@/lib/security';

export const POST = async (request: Request) => {
  const res = await logoutPOST(request);
  return withSecurity(res, request);
};
