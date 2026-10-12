import { z } from 'zod';

// ---------------------------------------------------------------------------
// marketplace-service environment.
//
// LAZY by design: `next build` imports route modules during page-data
// collection without runtime env vars, so nothing may validate at import time.
// Validation happens on first access of `env` (first real request) — the same
// pattern identity-service uses.
// ---------------------------------------------------------------------------

const envSchema = z.object({
  // --- Postgres (least-privilege marketplace_app role, search_path=marketplace) ---
  MARKETPLACE_DATABASE_URL: z
    .string()
    .url()
    .refine((u) => u.includes('marketplace'), 'database URL must target the marketplace schema'),

  // --- identity-service (verify JWT claims / verification status) ---
  IDENTITY_SERVICE_URL: z.string().url().default('http://localhost:4001'),

  // --- Auth (identity-service issues RS256 JWTs; we verify with its public key) ---
  JWT_PUBLIC_KEY: z.string().min(32, 'JWT_PUBLIC_KEY must be at least 32 characters'),
  JWT_ISSUER: z.string().default('identity-service'),
  JWT_AUDIENCE: z.string().default('hostel-marketplace'),

  // --- Limits ---
  LISTING_IMAGES_MAX: z.coerce.number().int().min(1).max(20).default(6),
  OFFER_TTL_HOURS: z.coerce.number().int().min(1).max(720).default(48),

  // --- Internal service-to-service key (audit N1 fix, Step 1) ---
  // Same root-.env value communication-service guards POST /api/notifications
  // with; transaction-service presents it as x-internal-api-key for the
  // system-to-system listing-status write (never an end-user JWT).
  INTERNAL_SERVICE_API_KEY: z.string().default(''),
});

export type AppEnv = z.infer<typeof envSchema>;

let cachedEnv: AppEnv | undefined;

export function parseEnv(raw: NodeJS.ProcessEnv = process.env): AppEnv {
  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((e) => `${e.path.join('.')}: ${e.message}`)
      .join(', ');
    throw new Error(`Invalid marketplace-service environment variables: ${issues}`);
  }
  return parsed.data;
}

export function getEnv(): AppEnv {
  if (!cachedEnv) cachedEnv = parseEnv();
  return cachedEnv;
}

export const env: AppEnv = new Proxy({} as AppEnv, {
  get(_target, prop: string) {
    return getEnv()[prop as keyof AppEnv];
  },
});
