import type { Page } from '@playwright/test'
import { test as base } from '@playwright/test'

import { getCase, missingCapabilities } from '../../../scripts/cherry-regression-test/cases'
import { getRunPaths } from '../../../scripts/cherry-regression-test/paths'
import { readRun } from '../../../scripts/cherry-regression-test/state'
import type { TestProfile } from '../../../scripts/cherry-regression-test/types'
import { RegressionApp } from './RegressionApp'
import { prepareScenario } from './setup'

interface RegressionFixtures {
  app: RegressionApp
  mainWindow: Page
}

interface RegressionOptions {
  profile: TestProfile
}

export const test = base.extend<RegressionFixtures & RegressionOptions>({
  profile: ['authenticated', { option: true }],

  app: async ({}, use, testInfo) => {
    const runDirectory = process.env.CHERRY_TEST_RUN_DIR
    if (!runDirectory) throw new Error('CHERRY_TEST_RUN_DIR is required')
    const id = testInfo.annotations.find(({ type }) => type === 'regression-case')?.description
    const testCase = getCase(id ?? '')
    const run = readRun(getRunPaths(runDirectory).runState)
    const missing = missingCapabilities(testCase.id, run.capabilities)
    base.skip(missing.length > 0, `缺少运行能力：${missing.join(', ')}`)
    const app = new RegressionApp(runDirectory, testCase.id)
    try {
      await use(app)
    } finally {
      await app.disconnect()
    }
  },

  mainWindow: async ({ app, profile }, use, testInfo) => {
    const page = await app.useProfile(profile)
    if (app.caseId !== 'S-01') await prepareScenario(page)
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
