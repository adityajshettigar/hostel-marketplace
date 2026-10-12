import { POST as registerPOST } from '../../../../routes/register';
import { withSecurity } from '@/lib/security';

export const POST = async (request: Request) => {
  const res = await registerPOST(request);
  return withSecurity(res, request);
};
