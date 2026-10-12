#!/usr/bin/env node
// Validate only this service's runtime requirements.
// Optional integrations (Razorpay/Hugging Face) fail closed or fall back.
const REQUIRED = [
  "AI_DATABASE_URL",
  "IDENTITY_SERVICE_URL",
  "MARKETPLACE_SERVICE_URL",
  "JWT_PUBLIC_KEY",
  "JWT_ISSUER",
  "JWT_AUDIENCE",
  "INTERNAL_SERVICE_API_KEY"
];

const missing = REQUIRED.filter((key) =>
  process.env[key] === undefined || String(process.env[key]).trim() === '',
);
if (missing.length) {
  console.error('[check-env] Missing required variables:');
  for (const key of missing) console.error(`  - ${key}`);
  process.exit(1);
}
console.log(`[check-env] OK: ${REQUIRED.length} service-specific variables present.`);
