import { expect, test } from '../../fixtures/seeded-electron.fixture'
import { WebSearchSettingsPage } from '../../pages/websearch-settings.page'
import { t } from '../../utils/i18n'
import { waitForAppReady } from '../../utils/wait-helpers'

/**
 * Spec (ws-m2): the API-key management dialog opens, "添加" creates an editable row, saving an
 * empty key is rejected (the edit input stays), and cancel removes the pending row (net-zero —
 * golden's existing keys are untouched).
 */
test.describe('WebSearch · API key dialog', () => {
  test('add row, empty-value rejection, cancel', async ({ mainWindow }) => {
    test.setTimeout(120_000)
    await waitForAppReady(mainWindow)
    const ws = new WebSearchSettingsPage(mainWindow)
    await ws.goto()

    await ws.providerMenuItem('Tavily').click()
    await ws.apiKeyManageButton.click()
    await expect(mainWindow.locator('[data-slot="dialog-content"]')).toBeVisible()

    await mainWindow.getByRole('button', { name: t('common.add'), exact: true }).click()
    await expect(ws.apiKeyInput).toBeVisible()

    // empty key save → rejected → edit input stays
    await mainWindow.locator(`[aria-label="${t('common.save')}"]`).click()
    await expect(ws.apiKeyInput).toBeVisible()

    // cancel → pending row removed
    await mainWindow.locator(`[aria-label="${t('common.cancel')}"]`).click()
    await expect(ws.apiKeyInput).toBeHidden()
  })
})
