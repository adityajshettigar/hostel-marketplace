#!/usr/bin/env node
// Validate only this service's runtime requirements.
// Optional integrations (Razorpay/Hugging Face) fail closed or fall back.
const REQUIRED = [
  "SERVICE_IDENTITY_URL",
  "SERVICE_MARKETPLACE_URL",
  "SERVICE_COMMUNICATION_URL",
  "SERVICE_TRANSACTION_URL",
  "SERVICE_AI_URL",
  "INTERNAL_SERVICE_KEY",
  "JWT_PUBLIC_KEY",
  "JWT_ISSUER",
  "JWT_AUDIENCE"
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
