// Database connection for identity-service.
//
// Postgres: one shared instance with 5 schemas (one per service). This service
// owns the identity schema and its least-privilege identity_app role, so it
// connects straight at role + schema using the DATABASE_URL from the root .env
// (set by the owner of this service). That URL is a full connection string
// (user:pass@host/db) - postgres node-postgres does not interpolate between
// env vars, so the owner fills it by hand after `cp .env.example .env`.

import { Pool } from 'pg';

import type { SessionRow } from './types/db';

// Pool is created lazily: Next.js imports this module during `next build`
// (page-data collection) without IDENTITY_DATABASE_URL set, so construction
// must not happen at import time.
const globalForDb = globalThis as unknown as { identityPool?: Pool };

export function getPool(): Pool {
  if (!globalForDb.identityPool) {
    const databaseUrl = process.env.IDENTITY_DATABASE_URL;
    if (!databaseUrl) {
      throw new Error(
        'IDENTITY_DATABASE_URL is not set. Copy .env.example to .env and fill it in.',
      );
    }
    globalForDb.identityPool = new Pool({
      connectionString: databaseUrl,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    });
  }
  return globalForDb.identityPool;
}

// `pool` kept as a lazy proxy for existing call sites (`pool.query(...)`).
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

export async function query(text: string, params?: unknown[]) {
  return pool.query(text, params);
}

// Phase 9 (item 4): the former dynamic helpers exists()/findFirst()/count()
// interpolated a caller-supplied `table`/`where`/`columns` straight into SQL.
// They had no call sites, so they were deleted rather than left as a latent
// injection footgun. All queries go through pool.query with $N placeholders.

export async function run(text: string, params?: unknown[]) {
  return pool.query(text, params);
}
