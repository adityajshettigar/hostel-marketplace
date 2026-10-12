import { z } from 'zod';

// Root .env contents every service needs are documented in the monorepo
// README. Identity-service adds its own section:
//
// NOTE: validation is LAZY. Next.js imports route modules during `next build`
// (page-data collection) without runtime env vars set, so this module must not
// throw at import time. Validation happens on first property access of `env`
// (i.e. on the first real request), or explicitly via parseEnv()/getEnv().

const envSchema = z.object({
  // --- Postgres (per service, least privilege) ---
  IDENTITY_DATABASE_URL: z
    .string()
    .url()
    .refine((u) => u.includes('identity'), 'database URL must target the identity schema'),

  // --- Redis (rate limiting, 48h escrow timer, later phases) ---
  REDIS_URL: z
    .string()
    .url()
    .default('redis://localhost:6379'),

  // --- Auth (JWT) ---
  JWT_PRIVATE_KEY: z
    .string()
    .min(32, 'JWT_PRIVATE_KEY must be at least 32 characters'),
  JWT_PUBLIC_KEY: z
    .string()
    .min(32, 'JWT_PUBLIC_KEY must be at least 32 characters'),
  JWT_ISSUER: z.string().default('identity-service'),
  JWT_AUDIENCE: z.string().default('hostel-marketplace'),

  // --- College allow-list: every registerable email must end in one of these ---
  COLLEGE_EMAIL_DOMAINS: z
    .string()
    .min(1, 'COLLEGE_EMAIL_DOMAINS is required, e.g. "college.edu,students.example.edu"'),
});

export type AppEnv = z.infer<typeof envSchema>;

let cachedEnv: AppEnv | undefined;

export function parseEnv(raw: NodeJS.ProcessEnv = process.env): AppEnv {
  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((e) => `${e.path.join('.')}: ${e.message}`)
      .join(', ');
    throw new Error(`Invalid identity-service environment variables: ${issues}`);
  }
  return parsed.data;
}

export function getEnv(): AppEnv {
  if (!cachedEnv) cachedEnv = parseEnv();
  return cachedEnv;
}

// Lazy proxy: `env.X` validates on first access instead of at import time, so
// `next build` can import route modules without a runtime environment.
export const env: AppEnv = new Proxy({} as AppEnv, {
  get(_target, prop: string) {
    return getEnv()[prop as keyof AppEnv];
  },
});

// Convenience accessor (name-based, computed per call so it never validates at
// import time).
export function collegeDomains(): string[] {
  return getEnv()
    .COLLEGE_EMAIL_DOMAINS.split(',')
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean);
}
