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
    // One worker thread for every file (same sharing as one fork). On Windows the child processes of the
    // forks pool were occasionally terminated mid-run ("Worker exited unexpectedly"); threads are not.
    pool: 'threads',
    poolOptions: { threads: { singleThread: true } },
  },
});
