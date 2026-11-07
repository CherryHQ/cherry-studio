import type { Page } from '@playwright/test'
import { test as base } from '@playwright/test'

import { getCase, missingCapabilities, supportsPlatform } from '../../../scripts/e2e/regression/cases'
import { getSensitiveConfigValues } from '../../../scripts/e2e/regression/config'
import { getRunPaths } from '../../../scripts/e2e/regression/paths'
import { captureMaskedScreenshot } from '../../../scripts/e2e/regression/screenshotEvidence'
import { readRun } from '../../../scripts/e2e/regression/state'
import type { TestProfile } from '../../../scripts/e2e/regression/types'
import { createApplicationWatchdog } from '../../../scripts/e2e/regression/watchdog'
import { RegressionApp } from './RegressionApp'
import { prepareScenario } from './setup'

const TEARDOWN_TIMEOUT_MS = 45_000

interface RegressionFixtures {
  app: RegressionApp
  mainWindow: Page
}

interface RegressionOptions {
  profile: TestProfile
}

/**
 * A frozen main process never answers the CDP call a fixture awaits, so every teardown
 * step has a deadline. Exceeding it is reported instead of hanging until the phase
 * timeout discards the whole report.
 */
async function bounded<T>(work: () => Promise<T>, label: string, timeoutMs = TEARDOWN_TIMEOUT_MS): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} did not finish within ${timeoutMs}ms`)), timeoutMs)
    timer.unref()
  })
  try {
    return await Promise.race([work(), timeout])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export const test = base.extend<RegressionFixtures & RegressionOptions>({
  profile: ['authenticated', { option: true }],

  app: async ({}, use, testInfo) => {
    const runDirectory = process.env.CHERRY_TEST_RUN_DIR
    if (!runDirectory) throw new Error('CHERRY_TEST_RUN_DIR is required')
    const id = testInfo.annotations.find(({ type }) => type === 'regression-case')?.description
    const testCase = getCase(id ?? '')
    const run = readRun(getRunPaths(runDirectory).runState)
    base.skip(!supportsPlatform(testCase.id, run.metadata.platform), `Not supported on ${run.metadata.platform}`)
    const missing = missingCapabilities(testCase.id, run.capabilities)
    base.skip(missing.length > 0, `Missing capabilities: ${missing.join(', ')}`)
    const app = new RegressionApp(runDirectory, testCase.id)
    const watchdog = createApplicationWatchdog(() => app.record)
    watchdog.start()
    try {
      await use(app)
    } finally {
      watchdog.stop()
      // Wait for a kill that is already in flight so the reported reason is final.
      await watchdog.settled()
      const stall = watchdog.reason
      // A killed application has nothing left to disconnect from, and any CDP call
      // would only wait for a socket that is already gone. When a stall is being
      // reported, the stall is the failure, not the disconnect that followed it.
      if (!watchdog.killedApplication) {
        await bounded(() => app.disconnect(), 'disconnect').catch((error: Error) => {
          if (!stall) throw error
        })
      }
      if (stall) throw new Error(stall)
    }
  },

  mainWindow: async ({ app, profile }, use, testInfo) => {
    const page = await app.useProfile(profile)
    try {
      if (app.caseId !== 'S-01') await prepareScenario(page)
      await use(page)
    } finally {
      const currentPage = await bounded(() => app.mainWindow().catch(() => page), 'locate main window').catch(
        () => page
      )
      if (testInfo.status !== testInfo.expectedStatus) {
        const screenshot = await bounded(
          () => captureMaskedScreenshot(currentPage, getSensitiveConfigValues()),
          'capture failure screenshot'
        ).catch(() => undefined)
        if (screenshot) await testInfo.attach('Failure screenshot', { body: screenshot, contentType: 'image/png' })
      }

      await bounded(() => app.cleanupTransientUi(currentPage), 'clean up transient UI')
    }
  }
})

export { expect } from '@playwright/test'
