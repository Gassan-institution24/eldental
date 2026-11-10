import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    setupFiles: ['test/setup-env.ts'],
    globalSetup: ['test/global-setup.ts'],
    testTimeout: 30000,
    hookTimeout: 120000,
    // One worker process for every file. On the Windows dev machine Node 24.15 crashes test workers
    // at random (0xC0000409 / "Worker exited unexpectedly"), worst with the threads pool; the same
    // suite is stable under Node 22. A single fork is the most reliable setting on both.
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
  },
});
