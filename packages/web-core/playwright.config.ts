import { defineConfig, devices } from '@playwright/test'

import { MOCK_PROVIDER_PORT } from './e2e/mockProvider'

const PORT = 4318

// Runs against the built harness (`vite build`), served with the cross-origin-isolation headers.
export default defineConfig({
  testDir: 'e2e',
  outputDir: 'test-results',
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  reporter: [['list']],
  use: { baseURL: `http://localhost:${PORT}` },
  webServer: [
    {
      command: `./node_modules/.bin/vite preview --port ${PORT} --strictPort`,
      url: `http://localhost:${PORT}`,
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
