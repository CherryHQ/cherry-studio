import { defineConfig } from '@playwright/test'

const gate = process.env.THE_BOSS_E2E_GATE ?? 'uarExperienceGate.test.ts'
const artifactName = gate
  .replace(/\.test\.ts$/, '')
  .replace(/([a-z])([A-Z])/g, '$1-$2')
  .toLowerCase()

export default defineConfig({
  testDir: '.',
  testMatch: gate,
  timeout: 10 * 60 * 1000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: [['list']],
  outputDir: `./artifacts/${artifactName}/playwright`,
  use: {
    actionTimeout: 20_000,
    navigationTimeout: 30_000,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure'
  }
})
