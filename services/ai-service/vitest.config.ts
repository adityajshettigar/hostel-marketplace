import { defineConfig } from 'vitest/config';

// Integration tests boot their own harness (tests/setup.ts) — a live server
// must be running on TEST_BASE_URL (default http://localhost:14005) with the
// stub identity/marketplace/HF processes; scripts/test-integration.sh wires
// all of this up. Unit tests (ai-core) are pure and run standalone anywhere,
// so vitest injects INERT env values here to satisfy lazy validation — the
// unit suites never open sockets or DB connections.
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    testTimeout: 30000,
    hookTimeout: 60000,
    fileParallelism: false, // shared DB schema; run suites sequentially
    env: {
      AI_DATABASE_URL: 'postgresql://ai_app:inert@localhost:5432/hostel_ai',
      HF_API_TOKEN: '',
      HF_CAPTION_MODEL: 'Salesforce/blip-image-captioning-base',
      HF_API_URL: 'http://localhost:14103/models',
    },
  },
});
