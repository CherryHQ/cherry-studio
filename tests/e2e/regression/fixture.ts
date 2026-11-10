import type { Page } from '@playwright/test'
import { expect, test as base } from '@playwright/test'

import { getCase, missingCapabilities, supportsPlatform } from '../../../scripts/e2e/regression/cases'
import { getSensitiveConfigValues } from '../../../scripts/e2e/regression/config'
import { setOwnedMainWindowFocus } from '../../../scripts/e2e/regression/debugBridge'
import { cleanupExternalResources } from '../../../scripts/e2e/regression/externalResources'
import { getRunPaths } from '../../../scripts/e2e/regression/paths'
import { captureMaskedScreenshot } from '../../../scripts/e2e/regression/screenshotEvidence'
import { readRun } from '../../../scripts/e2e/regression/state'
import type { TestProfile } from '../../../scripts/e2e/regression/types'
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

  app: async ({}, provideFixture, testInfo) => {
    const runDirectory = process.env.CHERRY_TEST_RUN_DIR
    if (!runDirectory) throw new Error('CHERRY_TEST_RUN_DIR is required')
    const id = testInfo.annotations.find(({ type }) => type === 'regression-case')?.description
    const testCase = getCase(id ?? '')
    const run = readRun(getRunPaths(runDirectory).runState)
    base.skip(!supportsPlatform(testCase.id, run.metadata.platform), `Not supported on ${run.metadata.platform}`)
    const missing = missingCapabilities(testCase.id, run.capabilities)
    base.skip(missing.length > 0, `Missing capabilities: ${missing.join(', ')}`)
    const app = new RegressionApp(runDirectory, testCase.id)
    try {
      await provideFixture(app)
    } finally {
      try {
        cleanupExternalResources(app.paths)
      } finally {
        await app.disconnect()
      }
    }
  },

  mainWindow: async ({ app, profile }, provideFixture, testInfo) => {
    const page = await app.useProfile(profile)
    try {
      if (app.caseId !== 'S-01') {
        await setOwnedMainWindowFocus(app.record, true)
        await expect.poll(() => page.evaluate(() => document.hasFocus())).toBe(true)
        await prepareScenario(page)
      }
      await provideFixture(page)
    } finally {
      const currentPage = await app.mainWindow().catch(() => page)
      if (testInfo.status !== testInfo.expectedStatus) {
        const screenshot = await captureMaskedScreenshot(currentPage, getSensitiveConfigValues()).catch(() => undefined)
        if (screenshot) await testInfo.attach('Failure screenshot', { body: screenshot, contentType: 'image/png' })
      }

      await app.cleanupTransientUi(currentPage)
    }
  }
})

export { expect } from '@playwright/test'
