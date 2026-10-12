import { POST as refreshPOST } from '../../../../routes/refresh';
import { withSecurity } from '@/lib/security';

export const POST = async (request: Request) => {
  const res = await refreshPOST(request);
  return withSecurity(res, request);
};
