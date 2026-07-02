import { expect, test } from '../../fixtures/seeded-electron.fixture'
import { WebSearchSettingsPage } from '../../pages/websearch-settings.page'
import { waitForAppReady } from '../../utils/wait-helpers'

/**
 * Spec (ws-l3): max_results clamps to 1..100 on blur (Enter), reset restores 5 and hides the
 * reset button, and >20 results with no compression shows the InfoTooltip icon.
 */
test.describe('WebSearch · max results bounds', () => {
  test('clamps bounds, resets to 5, shows the >20 info tooltip', async ({ mainWindow }) => {
    test.setTimeout(120_000)
    await waitForAppReady(mainWindow)
    const ws = new WebSearchSettingsPage(mainWindow)
    await ws.goto()

    // upper bound: 200 → blur → 100
    await ws.maxResultInput.fill('200')
    await ws.maxResultInput.press('Enter')
    await expect(ws.maxResultInput).toHaveValue('100')

    // lower bound: 0 → blur → 1
    await ws.maxResultInput.fill('0')
    await ws.maxResultInput.press('Enter')
    await expect(ws.maxResultInput).toHaveValue('1')

    // non-default → reset appears → click → 5 → reset gone
    await expect(ws.resetButton).toBeVisible()
    await ws.resetButton.click()
    await expect(ws.maxResultInput).toHaveValue('5')
    await expect(ws.resetButton).toBeHidden()

    // >20 + no compression → InfoTooltip icon appears
    await ws.maxResultInput.fill('25')
    await ws.maxResultInput.press('Enter')
    await expect(ws.infoIcon).toBeVisible()

    // reset back to 5 → icon gone
    await ws.resetButton.click()
    await expect(ws.infoIcon).toBeHidden()
  })
})
