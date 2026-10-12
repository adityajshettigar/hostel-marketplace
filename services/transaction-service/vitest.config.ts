import { defineConfig } from 'vitest/config';

// Integration tests boot their own harness (tests/setup.ts) — a live server
// must be running on TEST_BASE_URL (default http://localhost:14004) with the
// stub identity/marketplace/Razorpay processes; scripts/test-integration.sh
// wires all of this up.
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    testTimeout: 30000,
    hookTimeout: 60000,
    fileParallelism: false, // shared DB schema; run suites sequentially
    env: {
      TRANSACTION_DATABASE_URL: 'postgresql://transaction_app:inert@localhost:5432/hostel_marketplace',
      DUAL_AUTH_THRESHOLD: '500000',
    },
  },
});
