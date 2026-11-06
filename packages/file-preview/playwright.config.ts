import { fileURLToPath } from 'node:url'

import { defineConfig } from '@playwright/test'

const workspaceRoot = fileURLToPath(new URL('../..', import.meta.url))
const baseURL = 'http://127.0.0.1:4174'

export default defineConfig({
  testDir: './tests/browser',
  timeout: 60000,
  expect: { timeout: 10000 },
  workers: 1,
  forbidOnly: !!process.env.CI,
  use: { baseURL, screenshot: 'only-on-failure' },
  webServer: {
    command:
      'pnpm --filter @cherrystudio/file-preview build && pnpm exec vite --config packages/file-preview/tests/browser/vite.config.ts --host 127.0.0.1 --port 4174 --strictPort',
    cwd: workspaceRoot,
    url: `${baseURL}/tests/browser/index.html`,
    timeout: 120000,
    reuseExistingServer: false
  }
})
