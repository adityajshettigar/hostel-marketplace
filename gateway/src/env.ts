// Lazy env validation for the gateway (no zod — install scope approved for
// jsonwebtoken only). Next.js imports route modules during `next build`
// without runtime env vars, so validation happens on first access, not at
// import time (sibling-service pattern).

export type AppEnv = {
  SERVICE_IDENTITY_URL: string;
  SERVICE_MARKETPLACE_URL: string;
  SERVICE_COMMUNICATION_URL: string;
  SERVICE_TRANSACTION_URL: string;
  SERVICE_AI_URL: string;
  INTERNAL_SERVICE_KEY: string;
  JWT_PUBLIC_KEY: string;
  JWT_ISSUER: string;
  JWT_AUDIENCE: string;
};

const DEFAULTS: AppEnv = {
  SERVICE_IDENTITY_URL: 'http://identity-service:4001',
  SERVICE_MARKETPLACE_URL: 'http://marketplace-service:4002',
  SERVICE_COMMUNICATION_URL: 'http://communication-service:4003',
  SERVICE_TRANSACTION_URL: 'http://transaction-service:4004',
  SERVICE_AI_URL: 'http://ai-service:4005',
  INTERNAL_SERVICE_KEY: '',
  JWT_PUBLIC_KEY: '',
  JWT_ISSUER: 'identity-service',
  JWT_AUDIENCE: 'hostel-marketplace',
};

function assertUrl(name: string, value: string): void {
  if (!/^https?:\/\//.test(value)) {
    throw new Error(`Invalid gateway environment variables: ${name} must be an http(s) URL (got "${value}")`);
  }
}

export function parseEnv(raw: NodeJS.ProcessEnv = process.env): AppEnv {
  const env: AppEnv = {
    SERVICE_IDENTITY_URL: raw.SERVICE_IDENTITY_URL || DEFAULTS.SERVICE_IDENTITY_URL,
    SERVICE_MARKETPLACE_URL: raw.SERVICE_MARKETPLACE_URL || DEFAULTS.SERVICE_MARKETPLACE_URL,
    SERVICE_COMMUNICATION_URL: raw.SERVICE_COMMUNICATION_URL || DEFAULTS.SERVICE_COMMUNICATION_URL,
    SERVICE_TRANSACTION_URL: raw.SERVICE_TRANSACTION_URL || DEFAULTS.SERVICE_TRANSACTION_URL,
    SERVICE_AI_URL: raw.SERVICE_AI_URL || DEFAULTS.SERVICE_AI_URL,
    INTERNAL_SERVICE_KEY: raw.INTERNAL_SERVICE_KEY ?? DEFAULTS.INTERNAL_SERVICE_KEY,
    JWT_PUBLIC_KEY: raw.JWT_PUBLIC_KEY ?? DEFAULTS.JWT_PUBLIC_KEY,
    JWT_ISSUER: raw.JWT_ISSUER || DEFAULTS.JWT_ISSUER,
    JWT_AUDIENCE: raw.JWT_AUDIENCE || DEFAULTS.JWT_AUDIENCE,
  };
  for (const key of [
    'SERVICE_IDENTITY_URL',
    'SERVICE_MARKETPLACE_URL',
    'SERVICE_COMMUNICATION_URL',
    'SERVICE_TRANSACTION_URL',
    'SERVICE_AI_URL',
  ] as const) {
    assertUrl(key, env[key]);
  }
  return env;
}

let cachedEnv: AppEnv | undefined;

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
