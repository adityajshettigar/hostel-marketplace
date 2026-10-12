import { env } from './env';

// ---------------------------------------------------------------------------
// GET /api/health — aggregates each downstream /api/health into one report.
// A service that is down or slow is reported as down; the gateway itself is
// healthy iff it can produce the report (it does not fail when a downstream
// is down — that is exactly what the report exists to show).
// ---------------------------------------------------------------------------

const HEALTH_TIMEOUT_MS = 3000;

export type DownstreamHealth = {
  status: 'ok' | 'down';
  detail?: string;
};

async function probe(name: string, base: string): Promise<[string, DownstreamHealth]> {
  try {
    const res = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS) });
    if (res.ok) {
      let body: unknown = null;
      try {
        body = await res.json();
      } catch {
        body = null;
      }
      return [name, { status: 'ok', detail: body === null ? undefined : JSON.stringify(body).slice(0, 200) }];
    }
    return [name, { status: 'down', detail: `HTTP ${res.status}` }];
  } catch (err) {
    return [name, { status: 'down', detail: String(err).slice(0, 160) }];
  }
}

export async function aggregateHealth(): Promise<{
  gateway: 'ok';
  services: Record<string, DownstreamHealth>;
  allOk: boolean;
}> {
  const probes = await Promise.all([
    probe('identity', env.SERVICE_IDENTITY_URL),
    probe('marketplace', env.SERVICE_MARKETPLACE_URL),
    probe('communication', env.SERVICE_COMMUNICATION_URL),
    probe('transaction', env.SERVICE_TRANSACTION_URL),
    probe('ai', env.SERVICE_AI_URL),
  ]);
  const services = Object.fromEntries(probes);
  const allOk = Object.values(services).every((s) => s.status === 'ok');
  return { gateway: 'ok', services, allOk };
}
