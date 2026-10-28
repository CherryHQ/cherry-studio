import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { type BrowserContext, type LaunchOptions, test as base, type Page } from '@playwright/test'

import type { CoreClient } from '../src/client/CoreClient'
import { MOCK_PROVIDER_PORT } from './mockProvider'

export interface Harness {
  client: CoreClient
  broadcasts: { channel: string; args: unknown[] }[]
  CoreClient: typeof CoreClient
}

declare global {
  var harness: Harness
}

/**
 * Each test gets a persistent context on a fresh profile: OPFS must survive reloads,
 * and WebKit's ephemeral contexts fail to open OPFS files at all.
 */
const CSP_REPORTS = `http://localhost:${MOCK_PROVIDER_PORT}/csp-reports`

export const test = base.extend<{
  context: BrowserContext
  page: Page
  account: string
  csp: void
  launch: Pick<LaunchOptions, 'args' | 'channel'>
}>({
  launch: [{}, { option: true }],
  // Fails the test on any CSP violation, in the page, its frames or its Workers.
  csp: [
    // oxlint-disable-next-line no-empty-pattern -- Playwright reads a fixture's dependencies from this pattern
    async ({}, provide) => {
      await fetch(CSP_REPORTS, { method: 'DELETE' })
      await provide()
      // Browsers send reports asynchronously.
      await new Promise((resolve) => setTimeout(resolve, 500))
      const reports = await (await fetch(CSP_REPORTS)).json()
      if (reports.length) throw new Error(`CSP violations:\n${JSON.stringify(reports, null, 2)}`)
    },
    { auto: true }
  ],
  context: async ({ playwright, browserName, baseURL, locale, launch }, provide) => {
    const profile = mkdtempSync(join(tmpdir(), 'web-core-e2e-'))
    const context = await playwright[browserName].launchPersistentContext(profile, {
      baseURL,
      locale,
      ...launch
    })
    await provide(context)
    await context.close()
    rmSync(profile, { recursive: true, force: true })
  },
  page: async ({ context }, provide) => {
    const page = context.pages()[0] ?? (await context.newPage())
    await gotoHarness(page)
    await provide(page)
  },
  // WebKit keeps OPFS outside the profile directory, so names must be unique per run and data removed afterwards.
  account: async ({ context }, provide, testInfo) => {
    const account = `account-${testInfo.testId}-${Date.now().toString(36)}`
    await provide(account)
    const removed = await removeAccountData(context, account).catch((error: Error) => error.message)
    if (removed !== true) testInfo.annotations.push({ type: 'warning', description: `OPFS cleanup failed: ${removed}` })
  }
})

async function removeAccountData(context: BrowserContext, account: string): Promise<true> {
  // Closing every page terminates the Workers that hold the database files open.
  for (const page of context.pages()) await page.close()
  const page = await context.newPage()
  await page.goto('/')
  return page.evaluate(async (directory) => {
    const root = await navigator.storage.getDirectory()
    for (let attempt = 1; ; attempt++) {
      try {
        const accounts = await root.getDirectoryHandle('cherry-studio')
        await accounts.removeEntry(directory, { recursive: true })
        return true as const
      } catch (error) {
        if ((error as DOMException).name === 'NotFoundError') return true as const
        if (attempt === 20) throw error
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
    }
  }, encodeURIComponent(account))
}

export async function gotoHarness(page: Page): Promise<void> {
  await page.goto('/')
  await page.waitForFunction(() => globalThis.harness !== undefined)
}

export async function reloadHarness(page: Page): Promise<void> {
  await page.reload()
  await page.waitForFunction(() => globalThis.harness !== undefined)
}

export { expect } from '@playwright/test'
