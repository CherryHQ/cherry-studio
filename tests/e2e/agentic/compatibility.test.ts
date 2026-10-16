import { readFileSync } from 'node:fs'

import { test } from '@e2e-dev/web'
import { expect } from 'e2e'

test('the engine controls the real Electron window', async ({ app, browser }) => {
  const record = JSON.parse(readFileSync(process.env.AGENTIC_APP_RECORD!, 'utf8'))
  await app.open(record.targetUrl)
  await expect(browser.locator('#root > *').first()).toBeVisible()
  expect(
    await browser.evaluate(() => typeof (window as unknown as { api?: { preference?: unknown } }).api?.preference)
  ).toBe('object')
  await app.screenshot('electron-compatibility')
})
