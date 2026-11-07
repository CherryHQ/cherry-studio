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

const TEARDOWN_TIMEOUT_MS = 20_000

interface RegressionFixtures {
  app: RegressionApp
  mainWindow: Page
}

interface RegressionOptions {
  profile: TestProfile
}

/**
 * A frozen main process never answers the CDP call a fixture awaits, so every teardown
 * step gets a deadline that starts before the work does. The case still reports its own
 * result instead of hanging until the phase timeout discards the report.
 */
async function bounded<T>(
  work: () => Promise<T>,
  label: string,
  timeoutMs = TEARDOWN_TIMEOUT_MS
): Promise<T | undefined> {
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => {
      process.stderr.write(`[regression-fixture] ${label} exceeded ${timeoutMs}ms; continuing teardown\n`)
      resolve(undefined)
    }, timeoutMs)
    timer.unref()
  })
  const outcome = await Promise.race([
    work().then(
      (value) => ({ value }),
      (error) => ({ error })
    ),
    timeout
  ])
  if (timer) clearTimeout(timer)
  if (outcome && 'error' in outcome) throw outcome.error
  return outcome?.value
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
      // A killed application has nothing left to disconnect from, and any CDP call
      // would only wait for a socket that is already gone.
      if (watchdog.reason) throw new Error(watchdog.reason)
      await bounded(() => app.disconnect(), 'disconnect')
    }
  },

  mainWindow: async ({ app, profile }, use, testInfo) => {
    const page = await app.useProfile(profile)
    try {
      if (app.caseId !== 'S-01') await prepareScenario(page)
      await use(page)
    } finally {
      const currentPage = (await bounded(() => app.mainWindow().catch(() => page), 'locate main window')) ?? page
      if (testInfo.status !== testInfo.expectedStatus) {
        const screenshot = await bounded(
          () => captureMaskedScreenshot(currentPage, getSensitiveConfigValues()).catch(() => undefined),
          'capture failure screenshot'
        )
        if (screenshot) await testInfo.attach('Failure screenshot', { body: screenshot, contentType: 'image/png' })
      }

      await bounded(() => app.cleanupTransientUi(currentPage), 'clean up transient UI')
    }
  }
})

export { expect } from '@playwright/test'
