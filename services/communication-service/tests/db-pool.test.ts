import { describe, expect, it } from 'vitest';
import { getPool, pool } from '../src/db';

// ---------------------------------------------------------------------------
// Regression guard for the lazy `pool` proxy in src/db.ts.
//
// pg-pool keeps its own state with plain property ASSIGNMENTS — `_remove()`
// does `this._clients = this._clients.filter(...)` and `end()` sets
// `this.ending`. Every call site reaches those methods with the exported proxy
// as `this`, so a `get`-only proxy silently drops those writes onto a throwaway
// target object. The real pool then keeps every dead client forever,
// `_isFull()` stays true, `connect()` never dials a new client and EVERY query
// fails with "timeout exceeded when trying to connect" while Postgres reports
// zero connections — which would take out conversations and notifications.
//
// No database is needed: the pool is created lazily and nothing here connects.
// ---------------------------------------------------------------------------

describe('db pool proxy', () => {
  it('forwards writes to the real pool (pg-pool mutates itself in place)', () => {
    process.env.COMMUNICATION_DATABASE_URL ||= 'postgresql://probe:probe@127.0.0.1:1/probe';
    const real = getPool() as unknown as Record<string, unknown>;

    // Reads pass through to the real pool.
    expect((pool as unknown as Record<string, unknown>)._clients).toBe(real._clients);

    // Writes MUST land on the real pool, or pg-pool can never shed a dead client.
    (pool as unknown as Record<string, unknown>).__writeProbe = 'forwarded';
    expect(real.__writeProbe).toBe('forwarded');
  });
});
