import { env } from './env';

// ---------------------------------------------------------------------------
// SIMULATION MODE activation policy (project demonstration task).
//
// Kept in its own module (no DB, no HTTP) so it is trivially unit-testable and
// so every call site shares ONE definition of "may the demo adapter act?".
//
// Two independent conditions, BOTH required:
//   1. NODE_ENV is not 'production' — a hard stop that ignores the flag, so a
//      demo row can never settle with a simulated payout in production;
//   2. DEMO_MODE === 'enabled' — empty by default everywhere, so the adapter
//      is dead code until somebody opts in explicitly.
// ---------------------------------------------------------------------------

export function demoModeEnabled(): boolean {
  if (process.env.NODE_ENV === 'production') return false;
  return env.DEMO_MODE === 'enabled';
}

/**
 * Refusal used by every demo route: the same 404 an absent resource gets, so
 * the endpoint never advertises itself in an environment where it is off.
 */
export function demoModeRefusal(): { status: number; error: string; message: string } | null {
  if (demoModeEnabled()) return null;
  return { status: 404, error: 'NOT_FOUND', message: 'The requested resource does not exist' };
}

/** A transaction may only be simulated when it is BOTH demo-flagged and active. */
export function isSimulatable(row: { demo: boolean | null | undefined }): boolean {
  return row?.demo === true && demoModeEnabled();
}
