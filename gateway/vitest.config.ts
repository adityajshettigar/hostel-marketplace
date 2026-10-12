import { defineConfig } from 'vitest/config';

// Integration tests need the live gateway on TEST_BASE_URL (default
// http://localhost:14000) with the stub processes — scripts/test-integration.sh
// wires all of this up in one command.
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    testTimeout: 30000,
    hookTimeout: 60000,
    fileParallelism: false, // shared in-memory rate limiter; run sequentially
  },
});
