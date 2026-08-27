import type { Page } from '@playwright/test'
import { test as base } from '@playwright/test'

import { RegressionApp } from './app'
import type { TestProfile } from '../../../scripts/cherry-regression-test/types'

interface RegressionFixtures {
  app: RegressionApp
  mainWindow: Page
}

interface RegressionOptions {
  profile: TestProfile
}

export const test = base.extend<RegressionFixtures & RegressionOptions>({
  profile: ['authenticated', { option: true }],

  app: async ({}, use) => {
    const runDirectory = process.env.CHERRY_TEST_RUN_DIR
    if (!runDirectory) throw new Error('CHERRY_TEST_RUN_DIR is required')
    const app = new RegressionApp(runDirectory)
    await use(app)
    await app.disconnect()
  },

  mainWindow: async ({ app, profile }, use, testInfo) => {
    const page = await app.useProfile(profile)
    await use(page)

    const currentPage = await app.mainWindow().catch(() => page)
    if (testInfo.status !== testInfo.expectedStatus) {
      await currentPage
        .locator('input[type="password"]')
        .evaluateAll((inputs) => {
          for (const input of inputs) (input as HTMLInputElement).value = ''
        })
        .catch(() => undefined)
      const screenshotPath = testInfo.outputPath('failure.png')
      const captured = await currentPage.screenshot({ path: screenshotPath, fullPage: true }).then(
        () => true,
        () => false
      )
      if (captured) await testInfo.attach('失败截图', { path: screenshotPath, contentType: 'image/png' })
    }

    await app.cleanupTransientUi(currentPage)
  }
})

export { expect } from '@playwright/test'
