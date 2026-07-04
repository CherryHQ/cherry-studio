import { expect, test } from '../../fixtures/seeded-electron.fixture'
import { WebSearchSettingsPage } from '../../pages/websearch-settings.page'
import { waitForAppReady } from '../../utils/wait-helpers'

/**
 * Spec (ws-m1): inside a provider sub-panel, the "设为默认" button is enabled when the provider
 * is not the default; clicking it switches the label to "默认搜索" and disables it.
 */
test.describe('WebSearch · set-as-default button', () => {
  test('set-as-default toggles to default + disabled', async ({ mainWindow }) => {
    test.setTimeout(120_000)
    await waitForAppReady(mainWindow)
    const ws = new WebSearchSettingsPage(mainWindow)
    await ws.goto()

    await ws.providerMenuItem('Tavily').click()
    await expect(ws.setAsDefaultButton).toBeVisible()
    await expect(ws.setAsDefaultButton).toBeEnabled()

    await ws.setAsDefaultButton.click()
    await expect(ws.isDefaultButton).toBeVisible()
    await expect(ws.isDefaultButton).toBeDisabled()
  })
})
