import { expect, test } from '../../fixtures/seeded-electron.fixture'
import { WebSearchSettingsPage } from '../../pages/websearch-settings.page'
import { waitForAppReady } from '../../utils/wait-helpers'

/**
 * Spec (ws-l1): the web search settings page renders the provider list and the locale-free
 * default badges (keywords default = exa-mcp, fetch default = jina).
 */
test.describe('WebSearch · settings render', () => {
  test('renders provider list and default badges', async ({ mainWindow }) => {
    test.setTimeout(120_000)
    await waitForAppReady(mainWindow)
    const ws = new WebSearchSettingsPage(mainWindow)
    await ws.goto()

    await expect(ws.providerMenuItem('Tavily')).toBeVisible()
    await expect(ws.defaultBadge('exa-mcp')).toBeVisible()
    await expect(ws.defaultBadge('jina')).toBeVisible()
  })
})
