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

  // Electron apps should run tests sequentially to avoid conflicts
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
