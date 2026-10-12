import { z } from 'zod';

// Lazy env validation — same rationale as identity-service: Next.js imports
// route modules during `next build` without runtime env vars set, so this
// module must not throw at import time. Validation happens on first property
// access of `env`.

const envSchema = z.object({
  // --- Postgres (least-privilege role, communication schema) ---
  COMMUNICATION_DATABASE_URL: z
    .string()
    .url()
    .refine((u) => u.includes('communication'), 'database URL must target the communication schema'),

  // --- identity-service (JWKS for JWT verification) ---
  IDENTITY_SERVICE_URL: z.string().url().default('http://localhost:4001'),

  // --- marketplace-service (authoritative seller_id for conversations) ---
  MARKETPLACE_SERVICE_URL: z.string().url().default('http://localhost:4002'),

  // --- JWT verification (identity-service issued, RS256) ---
  JWT_PUBLIC_KEY: z.string().default(''),
  JWT_ISSUER: z.string().default('identity-service'),
  JWT_AUDIENCE: z.string().default('hostel-marketplace'),

  // --- Shared service-to-service API key (POST /api/notifications only) ---
  INTERNAL_SERVICE_API_KEY: z.string().min(1, 'INTERNAL_SERVICE_API_KEY is required'),
});

export type AppEnv = z.infer<typeof envSchema>;

let cachedEnv: AppEnv | undefined;

export function parseEnv(raw: NodeJS.ProcessEnv = process.env): AppEnv {
  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ');
    throw new Error(`Invalid communication-service environment variables: ${issues}`);
  }
  return parsed.data;
}

export function getEnv(): AppEnv {
  if (!cachedEnv) cachedEnv = parseEnv();
  return cachedEnv;
}

// Lazy proxy: `env.X` validates on first access instead of at import time.
export const env: AppEnv = new Proxy({} as AppEnv, {
  get(_target, prop: string) {
    return getEnv()[prop as keyof AppEnv];
  },
});
