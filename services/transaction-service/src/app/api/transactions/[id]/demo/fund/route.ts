import { fundDemoEscrow } from '../../../../../../routes/demo';

// SIMULATION MODE ONLY (see src/demo.ts): no-op 404 unless the service runs
// outside production with DEMO_MODE=enabled.
export async function POST(request: Request, ctx: { params: { id: string } }) {
  return fundDemoEscrow(request, ctx.params.id);
}
