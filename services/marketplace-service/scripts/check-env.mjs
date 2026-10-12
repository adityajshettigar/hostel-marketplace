#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Phase 9 (item 5): startup environment validation.
//
// Every container runs this before `server.js` (see Dockerfile CMD). If any
// required variable — the set that the root `.env.example` ships EMPTY, i.e.
// has no usable default — is absent, the container exits non-zero instead of
// booting into a broken/unauthenticated state.
//
// The list is embedded (the runner image does not contain the repo's
// `.env.example`). Variables that `.env.example` documents as OPTIONAL
// (RAZORPAY_FUND_ACCOUNT_ID, HUGGINGFACE_API_KEY, HF_API_TOKEN,
// FRONTEND_ORIGIN) and those with real defaults (service URLs, GATEWAY_URL,
// NEXT_PUBLIC_GATEWAY_URL, HF_* model/url) are intentionally NOT required.
// ---------------------------------------------------------------------------

const REQUIRED = [
  // Postgres
  'POSTGRES_USER',
  'POSTGRES_PASSWORD',
  'POSTGRES_DB',
  // Per-service DB role passwords
  'IDENTITY_DB_PASSWORD',
  'MARKETPLACE_DB_PASSWORD',
  'COMMUNICATION_DB_PASSWORD',
  'TRANSACTION_DB_PASSWORD',
  'AI_DB_PASSWORD',
  // Per-service connection strings
  'IDENTITY_DATABASE_URL',
  'MARKETPLACE_DATABASE_URL',
  'COMMUNICATION_DATABASE_URL',
  'TRANSACTION_DATABASE_URL',
  'AI_DATABASE_URL',
  // Redis
  'REDIS_URL',
  // Auth / signing
  'JWT_PRIVATE_KEY',
  'JWT_PUBLIC_KEY',
  'JWT_ISSUER',
  'JWT_AUDIENCE',
  'INTERNAL_SERVICE_API_KEY',
  'INTERNAL_SERVICE_KEY',
  'ADMIN_USER_IDS',
  'COLLEGE_EMAIL_DOMAINS',
  // Image storage
  'CLOUDINARY_CLOUD_NAME',
  'CLOUDINARY_API_KEY',
  'CLOUDINARY_API_SECRET',
  // Handover QR encryption (AES-256-GCM; no fallback key)
  'QR_ENCRYPTION_KEY',
  // Payments (Razorpay TEST mode)
  'RAZORPAY_KEY_ID',
  'RAZORPAY_KEY_SECRET',
  'RAZORPAY_WEBHOOK_SECRET',
];

const missing = REQUIRED.filter((key) => {
  const value = process.env[key];
  return value === undefined || String(value).trim() === '';
});

if (missing.length > 0) {
  console.error('[check-env] FATAL: required environment variables are missing:');
  for (const key of missing) console.error(`  - ${key}`);
  console.error(
    '[check-env] Refusing to start. Copy the root .env.example to .env and fill in every value.',
  );
  process.exit(1);
}

console.log(`[check-env] OK: all ${REQUIRED.length} required environment variables are present.`);
