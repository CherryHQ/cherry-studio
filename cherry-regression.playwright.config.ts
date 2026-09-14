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
  projects: [{ name: process.platform === 'win32' ? 'Windows' : 'macOS' }],
  reporter: [
    ['./scripts/cherry-regression-test/CherryRegressionReporter.ts'],
    ['list'],
    ['html', { open: 'never', outputFolder: join(runDirectory, 'report', `playwright-${phase}`) }],
    [
      'blob',
      { outputDir: join(runDirectory, 'report', `blob-${phase}`), fileName: `report-${process.platform}-${phase}.zip` }
    ]
  ],
  outputDir: join(runDirectory, 'evidence', 'playwright', phase),
  use: {
    actionTimeout: 20_000,
    navigationTimeout: 30_000
  }
})
