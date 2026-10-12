import { defineConfig } from 'vitest/config';

// Identity integration tests (audit 2e) run against the real compose
// Postgres + Redis and a live identity server. npm run test:integration
// starts everything, waits for health, runs vitest, and kills the server.
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    testTimeout: 30000,
    hookTimeout: 60000,
    fileParallelism: false,
  },
});
