import { join } from 'node:path'

import { defineConfig } from '@playwright/test'

const runDirectory = process.env.CHERRY_TEST_RUN_DIR
if (!runDirectory) throw new Error('CHERRY_TEST_RUN_DIR is required')

const phase = process.env.CHERRY_TEST_PHASE ?? 'all'

export default defineConfig({
  testDir: './tests/e2e/cherry-regression',
  testMatch: '**/*.test.ts',
  timeout: 10 * 60 * 1000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: [
    ['./tests/e2e/cherry-regression/reporter.ts'],
    ['list'],
    ['html', { open: 'never', outputFolder: join(runDirectory, 'report', `playwright-${phase}`) }]
  ],
  outputDir: join(runDirectory, 'evidence', 'playwright', phase),
  use: {
    actionTimeout: 20_000,
    navigationTimeout: 30_000
  }
})
