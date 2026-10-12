import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { demoModeEnabled, demoModeRefusal, isSimulatable } from '../src/demo-policy';

// demo-policy.ts reads env.DEMO_MODE via the env proxy, which now re-parses
// process.env on every access (env.ts). We can therefore mutate process.env per
// assertion without re-importing the module graph.

const ORIG_NODE_ENV = process.env.NODE_ENV;
const ORIG_DEMO_MODE = process.env.DEMO_MODE;
const ORIG_TXN_DB = process.env.TRANSACTION_DATABASE_URL;

beforeEach(() => {
  // Baseline for this suite: non-production, demo off, valid placeholder DB url.
  (process.env as any).NODE_ENV = 'test';
  (process.env as any).DEMO_MODE = '';
  (process.env as any).TRANSACTION_DATABASE_URL = 'postgresql://placeholder@localhost:5432/hostel_marketplace';
});

afterEach(() => {
  (process.env as any).NODE_ENV = ORIG_NODE_ENV;
  (process.env as any).DEMO_MODE = ORIG_DEMO_MODE;
  (process.env as any).TRANSACTION_DATABASE_URL = ORIG_TXN_DB;
});

describe('SIMULATION MODE activation policy (demo-policy.ts)', () => {
  it('is a HARD no under NODE_ENV=production even when DEMO_MODE is enabled', () => {
    (process.env as any).NODE_ENV = 'production';
    (process.env as any).DEMO_MODE = 'enabled';
    expect(demoModeEnabled()).toBe(false);
    expect(isSimulatable({ demo: true })).toBe(false);
  });

  it('is on outside production when DEMO_MODE is explicitly enabled', () => {
    (process.env as any).DEMO_MODE = 'enabled';
    expect(demoModeEnabled()).toBe(true);
    expect(demoModeRefusal()).toBeNull();
    expect(isSimulatable({ demo: true })).toBe(true);
  });

  it('only ever acts on demo-flagged rows (never on an ordinary order)', () => {
    (process.env as any).DEMO_MODE = 'enabled';
    expect(isSimulatable({ demo: true })).toBe(true);
    expect(isSimulatable({ demo: false })).toBe(false);
    expect(isSimulatable({ demo: null as unknown as boolean | null | undefined })).toBe(false);
    expect(isSimulatable({} as any)).toBe(false);
  });

  it('returns no refusal when DEMO_MODE is enabled (non-production)', () => {
    (process.env as any).DEMO_MODE = 'enabled';
    expect(demoModeRefusal()).toBeNull();
  });

  it('names a refusal when DEMO_MODE is OFF (so clients keep silence)', () => {
    const refusal = demoModeRefusal();
    expect(refusal).not.toBeNull();
    expect(refusal?.status).toBe(404);
    expect(refusal?.error).toBe('NOT_FOUND');
    expect(refusal?.message).toBe('The requested resource does not exist');
  });
});
