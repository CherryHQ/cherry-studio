import { defineConfig, devices } from '@playwright/test'

import { APP_PORT } from './e2e/appPage'
import { MOCK_PROVIDER_PORT } from './e2e/mockProvider'

const PORT = 4318

// Runs against the built harness (`vite build`) and Web app (`build:app`), served with the
// cross-origin-isolation headers.
export default defineConfig({
  testDir: 'e2e',
  outputDir: 'test-results',
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  reporter: [['list']],
  // The app picks its language from the browser, which WebKit takes from the system.
  use: { baseURL: `http://localhost:${PORT}`, locale: 'en-US' },
  webServer: [
    {
      command: `./node_modules/.bin/vite preview --port ${PORT} --strictPort`,
      url: `http://localhost:${PORT}`,
      reuseExistingServer: false
    },
    {
      command: `packages/web-core/node_modules/.bin/vite preview --config packages/web-core/vite.app.config.ts --port ${APP_PORT} --strictPort`,
      cwd: '../..',
      url: `http://localhost:${APP_PORT}`,
      reuseExistingServer: false
    },
    {
      command: 'node e2e/mockProvider.ts',
      url: `http://localhost:${MOCK_PROVIDER_PORT}`,
      reuseExistingServer: false
    }
  ],
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } }
  ]
})
