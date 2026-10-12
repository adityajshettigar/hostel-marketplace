// Database connection for ai-service (least-privilege ai_app role; pool
// created lazily — see src/env.ts note).

import { Pool } from 'pg';

const globalForDb = globalThis as unknown as { aiPool?: Pool };

export function getPool(): Pool {
  if (!globalForDb.aiPool) {
    const databaseUrl = process.env.AI_DATABASE_URL;
    if (!databaseUrl) {
      throw new Error('AI_DATABASE_URL is not set. Copy .env.example to .env and fill it in.');
    }
    globalForDb.aiPool = new Pool({
      connectionString: databaseUrl,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    });
  }
  return globalForDb.aiPool;
}

// `pool` kept as a lazy proxy for call sites (`pool.query(...)`).
//
// The `set` trap is REQUIRED, not decorative. pg-pool mutates its own state
// with plain assignments — `_remove()` does `this._clients = this._clients
// .filter(...)` and `end()` sets `this.ending`/`this.ended`. Every call site
// reaches those methods through this proxy as `this`, so with only a `get`
// trap those writes landed on the throwaway target object and were lost: the
// real `_clients` array kept every dead client forever, `_isFull()` stayed
// true, `connect()` never dialled a new client and EVERY query failed with
// "timeout exceeded when trying to connect" while Postgres showed zero
// connections. Forwarding writes to the real pool fixes that.
export const pool = new Proxy({} as Pool, {
  get(_target, prop: string) {
    return (getPool() as unknown as Record<string, unknown>)[prop];
  },
  set(_target, prop: string, value: unknown) {
    (getPool() as unknown as Record<string, unknown>)[prop] = value;
    return true;
  },
});
