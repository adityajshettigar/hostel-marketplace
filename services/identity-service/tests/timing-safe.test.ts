import { describe, it, expect } from 'vitest';
import { timingSafeHexEqual, verifyRefreshToken, hashRefreshToken } from '../src/crypto';

// ---------------------------------------------------------------------------
// M5 (audit Step 3b): the OTP-compare and refresh-token-hash-compare are now
// timing-safe. Behavior must be UNCHANGED for correct/incorrect inputs.
// ---------------------------------------------------------------------------

describe('timingSafeHexEqual', () => {
  it('true only for identical equal-length digests', () => {
    expect(timingSafeHexEqual('a'.repeat(64), 'a'.repeat(64))).toBe(true);
    expect(timingSafeHexEqual('abc123', 'abc123')).toBe(true);
  });

  it('false for differing equal-length values', () => {
    expect(timingSafeHexEqual('a'.repeat(64), 'b'.repeat(64))).toBe(false);
    expect(timingSafeHexEqual('abc123', 'abc124')).toBe(false);
  });

  it('false (no throw) for length mismatches', () => {
    expect(timingSafeHexEqual('abc', 'abcd')).toBe(false);
    expect(timingSafeHexEqual('', 'a'.repeat(64))).toBe(false);
    expect(timingSafeHexEqual('', '')).toBe(true); // degenerate but consistent
  });
});

describe('verifyRefreshToken (now timing-safe, behavior unchanged)', () => {
  it('accepts the token whose sha256 matches the stored hash', () => {
    const token = '3f9d1c2e-7b6a-4d08-9a5e-2c1f0b8e7d6a';
    expect(verifyRefreshToken(token, hashRefreshToken(token))).toBe(true);
  });

  it('rejects a wrong token / wrong hash', () => {
    const token = '3f9d1c2e-7b6a-4d08-9a5e-2c1f0b8e7d6a';
    expect(verifyRefreshToken('different-token', hashRefreshToken(token))).toBe(false);
    expect(verifyRefreshToken(token, 'deadbeef')).toBe(false);
  });
});
