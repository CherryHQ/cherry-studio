import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e/gates',
  timeout: 15 * 60_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  outputDir: './test-results/gates',
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 30_000,
    navigationTimeout: 60_000
  }
})
