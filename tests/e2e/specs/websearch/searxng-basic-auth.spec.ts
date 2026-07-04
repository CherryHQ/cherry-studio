import type { Locator } from '@playwright/test'

import { expect, test } from '../../fixtures/seeded-electron.fixture'
import { WebSearchSettingsPage } from '../../pages/websearch-settings.page'
import { waitForAppReady } from '../../utils/wait-helpers'

/** Clear a controlled input via the keyboard (fill('') can be restored by React). */
async function keyboardClear(input: Locator): Promise<void> {
  await input.click()
  await input.press('ControlOrMeta+a')
  await input.press('Backspace')
}

/**
 * Spec (ws-m3): the Searxng password field is conditionally rendered iff the username is
 * non-empty. Clearing must be a real keyboard clear (controlled input). Net-zero.
 */
test.describe('WebSearch · searxng basic auth', () => {
  test('password field shows only when username is non-empty', async ({ mainWindow }) => {
    test.setTimeout(120_000)
    await waitForAppReady(mainWindow)
    const ws = new WebSearchSettingsPage(mainWindow)
    await ws.goto()
    await ws.providerMenuItem('Searxng').click()

    // baseline: empty username → no password field
    await keyboardClear(ws.basicAuthUsername)
    await expect(ws.basicAuthPassword).toBeHidden()

    // username → password field appears
    await ws.basicAuthUsername.fill('e2e-user')
    await expect(ws.basicAuthPassword).toBeVisible()

    // clear username → password field disappears (net-zero)
    await keyboardClear(ws.basicAuthUsername)
    await expect(ws.basicAuthPassword).toBeHidden()
  })
})
