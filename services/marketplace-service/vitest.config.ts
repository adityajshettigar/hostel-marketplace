import { defineConfig } from 'vitest/config';

// Integration tests boot their own harness (tests/setup.ts is called from the
// suite's beforeAll/afterAll). A live server must be running on TEST_BASE_URL
// (default http://localhost:4002) and TEST_DATABASE_URL must point at Postgres.
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    testTimeout: 30000,
    hookTimeout: 60000,
    fileParallelism: false, // shared DB schema; run suites sequentially
  },
});
