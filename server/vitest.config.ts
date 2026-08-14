import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    globalSetup: ['./test/helpers/global-setup.ts'],
    // SQLite is single-writer. Parallel workers against one file produce flaky
    // SQLITE_BUSY failures that look exactly like product bugs, so each test
    // file gets its own database file and the pool runs single-threaded.
    pool: 'forks',
    maxWorkers: 1,
    minWorkers: 1,
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
  resolve: {
    alias: {
      '@classroom-copier/shared': fileURLToPath(new URL('../shared/src/index.ts', import.meta.url)),
    },
  },
})
