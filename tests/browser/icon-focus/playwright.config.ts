import { resolve } from 'node:path'

import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: '.',
  testMatch: 'focus.spec.ts',
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:4178',
    launchOptions: process.env.CHROME_EXECUTABLE
      ? { executablePath: process.env.CHROME_EXECUTABLE, args: ['--no-sandbox'] }
      : {}
  },
  webServer: {
    cwd: resolve(__dirname, '../../..'),
    command: 'node node_modules/vite/bin/vite.js --config tests/browser/icon-focus/vite.config.mts',
    url: 'http://127.0.0.1:4178/tests/browser/icon-focus/index.html',
    reuseExistingServer: false
  }
})
