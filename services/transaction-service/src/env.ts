import { z } from 'zod';

// Lazy env validation — same pattern as identity/communication/ai: Next.js
// imports route modules during `next build` without runtime env vars, so this
// module must not throw at import time. Validation happens on first access.

const envSchema = z.object({
  // --- Postgres (least-privilege role; search_path pinned to `transaction`) ---
  TRANSACTION_DATABASE_URL: z.string().url(),

  // --- identity-service (JWKS for JWT verification) ---
  IDENTITY_SERVICE_URL: z.string().url().default('http://localhost:4001'),

  // --- marketplace-service (offer ACCEPTED verification, fail-closed) ---
  MARKETPLACE_SERVICE_URL: z.string().url().default('http://localhost:4002'),

  // --- Internal service key (audit N1 fix, Step 1): presented to marketplace
  // as x-internal-api-key for the pre-payout listing-SOLD write. ---
  INTERNAL_SERVICE_API_KEY: z.string().default(''),

  // --- JWT verification (identity-service issued, RS256) ---
  JWT_PUBLIC_KEY: z.string().default(''),
  JWT_ISSUER: z.string().default('identity-service'),
  JWT_AUDIENCE: z.string().default('hostel-marketplace'),

  // --- Razorpay TEST MODE (Orders + Payouts via REST, no SDK — user decision) ---
  RAZORPAY_KEY_ID: z.string().default(''),
  RAZORPAY_KEY_SECRET: z.string().default(''),
  RAZORPAY_WEBHOOK_SECRET: z.string().default(''),
  RAZORPAY_API_BASE: z.string().url().default('https://api.razorpay.com/v1'),
  RAZORPAY_FUND_ACCOUNT_ID: z.string().default(''), // seller payout destination (test)

  // --- QR encryption (AES-256-GCM, 32-byte base64 key) ---
  QR_ENCRYPTION_KEY: z.string().default(''),

  // --- Disputes: second admin confirmation above this amount (paise) ---
  DUAL_AUTH_THRESHOLD: z.coerce.number().int().nonnegative().default(500000),

  // --- Admin authorization (user decision: env list of admin user ids) ---
  ADMIN_USER_IDS: z.string().default(''),

  // --- Redis (BullMQ delayed auto-release jobs) ---
  REDIS_URL: z.string().default('redis://redis:6379'),

  // --- SIMULATION MODE (project demonstration task) ---
  // Empty/unset in every normal environment, so the demo adapter is dead code
  // unless someone EXPLICITLY opts in. It only ever becomes effective when it
  // is exactly 'enabled' AND the process is not running with NODE_ENV=production
  // (see src/demo.ts — production is a hard stop that ignores the flag).
  // When active it replaces exactly two provider calls, and only for rows the
  // demo itself created: the payment.captured webhook step (escrow lock +
  // handover PIN/QR) and the Razorpay payout inside settleTransaction. Every
  // other rule — authentication, ownership, the state machine, PIN attempt
  // limits, the buyer-receipt gate — is unchanged and still enforced.
  DEMO_MODE: z.string().default(''),
});

export type AppEnv = z.infer<typeof envSchema>;

let cachedEnv: AppEnv | undefined;

export function parseEnv(raw: NodeJS.ProcessEnv = process.env): AppEnv {
  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ');
    throw new Error(`Invalid transaction-service environment variables: ${issues}`);
  }
  return parsed.data;
}

export function getEnv(): AppEnv {
  if (!cachedEnv) cachedEnv = parseEnv();
  return cachedEnv;
}

// Lazy proxy: `env.X` validates on first access instead of at import time.
// In test/debug environments it is useful for the proxy to re-read the live
// process.env on every access rather than caching the first parse, so pure
// env-policy unit tests can mutate process.env per assertion without rebuilding
// the module graph. In production this is a no-op change (validation is cheap
// and one parse per access is immaterial).
export const env: AppEnv = new Proxy({} as AppEnv, {
  get(_target, prop: string) {
    return parseEnv(process.env)[prop as keyof AppEnv];
  },
});
