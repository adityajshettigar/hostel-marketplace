import { z } from 'zod';

// Lazy env validation — same pattern as identity/communication: Next.js
// imports route modules during `next build` without runtime env vars, so this
// module must not throw at import time. Validation happens on first access.

const envSchema = z.object({
  // --- Postgres (least-privilege role, ai schema: suggestion + interaction logs) ---
  AI_DATABASE_URL: z
    .string()
    .url()
    .refine((u) => u.includes('ai'), 'database URL must target the ai schema'),

  // --- identity-service (JWKS for JWT verification) ---
  IDENTITY_SERVICE_URL: z.string().url().default('http://localhost:4001'),

  // --- marketplace-service (sold stats + public listings for recommendations) ---
  MARKETPLACE_SERVICE_URL: z.string().url().default('http://localhost:4002'),

  // --- Gateway/shared service key (audit Step 2a): presented as
  // x-service-key on every service-to-service call (N2 gate downstream). ---
  INTERNAL_SERVICE_API_KEY: z.string().default(''),

  // --- JWT verification (identity-service issued, RS256) ---
  JWT_PUBLIC_KEY: z.string().default(''),
  JWT_ISSUER: z.string().default('identity-service'),
  JWT_AUDIENCE: z.string().default('hostel-marketplace'),

  // --- Hugging Face Inference API (free tier image captioning) ---
  // Missing token or failed call -> pure-template fallback (SRS 7.12).
  HF_API_TOKEN: z.string().default(''),
  HF_CAPTION_MODEL: z.string().default('Salesforce/blip-image-captioning-base'),
  HF_API_URL: z.string().url().default('https://api-inference.huggingface.co/models'),
});

export type AppEnv = z.infer<typeof envSchema>;

let cachedEnv: AppEnv | undefined;

export function parseEnv(raw: NodeJS.ProcessEnv = process.env): AppEnv {
  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ');
    throw new Error(`Invalid ai-service environment variables: ${issues}`);
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
