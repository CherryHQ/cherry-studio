import { expect, test } from '../../fixtures/seeded-electron.fixture'
import { WebSearchSettingsPage } from '../../pages/websearch-settings.page'
import { waitForAppReady } from '../../utils/wait-helpers'

/**
 * Spec (ws-l4): switching the default keywords provider migrates the default badge; the fetch
 * default (jina) is unaffected. Per-test golden isolation removes the old run-order reset need.
 */
test.describe('WebSearch · switch default provider', () => {
  test('default badge migrates with the keywords provider', async ({ mainWindow }) => {
    test.setTimeout(120_000)
    await waitForAppReady(mainWindow)
    const ws = new WebSearchSettingsPage(mainWindow)
    await ws.goto()

    await ws.selectKeywordsProvider('Tavily')
    await expect(ws.defaultBadge('tavily')).toBeVisible()
    await expect(ws.defaultBadge('exa-mcp')).toBeHidden()
    await expect(ws.defaultBadge('jina')).toBeVisible() // fetch default unaffected

    await ws.selectKeywordsProvider('ExaMCP')
    await expect(ws.defaultBadge('exa-mcp')).toBeVisible()
  })
})
