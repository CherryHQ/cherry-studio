import { defineConfig } from '@playwright/test'

/**
 * Playwright configuration for Electron e2e testing.
 * See https://playwright.dev/docs/test-configuration
 */
export default defineConfig({
  // Look for test files in the specs directory
  testDir: './tests/e2e/specs',

  // Global timeout for each test
  timeout: 60000,

  // Assertion timeout
  expect: {
    timeout: 10000
  },

  // Each spec launches its own Electron instance against an isolated copy of the userData
  // profile (see seeded-electron.fixture's userDataDir), so specs don't share state. Serialized
  // (workers: 1) rather than parallel: concurrent Electron instances contend for CPU/GPU enough to
  // widen UI transition races (e.g. navbar-intercepts-click flakes seen under workers: 3).
  fullyParallel: false,
  workers: 1,

  // Fail the build on CI if you accidentally left test.only in the source code
  forbidOnly: !!process.env.CI,

  // Retry on CI only
  retries: process.env.CI ? 2 : 0,

  // Reporter configuration
  reporter: [['html', { outputFolder: 'playwright-report' }], ['list']],

  // Global setup and teardown
  globalSetup: './tests/e2e/global-setup.ts',
  globalTeardown: './tests/e2e/global-teardown.ts',

  // Output directory for test artifacts
  outputDir: './test-results',

  // Shared settings for all tests
  use: {
    // Collect trace when retrying the failed test
    trace: 'retain-on-failure',

    // Take screenshot only on failure
    screenshot: 'only-on-failure',

    // Record video only on failure
    video: 'retain-on-failure',

    // Action timeout
    actionTimeout: 15000,

    // Navigation timeout
    navigationTimeout: 30000
  },

  // Single project for Electron testing
  projects: [
    {
      name: 'electron',
      testMatch: '**/*.spec.ts'
    }
  ]
})
