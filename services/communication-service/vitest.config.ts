import { defineConfig } from 'vitest/config';

// Integration tests boot their own harness (tests/setup.ts). A live server
// must be running on TEST_BASE_URL (default http://localhost:14003) with stub
// identity + stub marketplace processes — npm run test:integration wires all
// of this up. Unit tests (chat-safety) run standalone anywhere.
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    testTimeout: 30000,
    hookTimeout: 60000,
    fileParallelism: false, // shared DB schema; run suites sequentially
  },
});
