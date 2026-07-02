import { expect, test } from '../../fixtures/seeded-electron.fixture'
import { WebSearchSettingsPage } from '../../pages/websearch-settings.page'
import { t } from '../../utils/i18n'
import { waitForAppReady } from '../../utils/wait-helpers'

/**
 * Spec (ws-m4): blacklist save-time validation. An invalid entry ("/(/" → bad RegExp) shows an
 * error Alert and the Save button stays (still dirty); a valid entry persists — the Save button
 * unmounts (only mounts while dirty), which is the deterministic "persisted" signal.
 */
test.describe('WebSearch · blacklist validation', () => {
  test('rejects an invalid entry and persists a valid one', async ({ mainWindow }) => {
    test.setTimeout(120_000)
    await waitForAppReady(mainWindow)
    const ws = new WebSearchSettingsPage(mainWindow)
    await ws.goto()

    const save = mainWindow.getByRole('button', { name: t('common.save'), exact: true })

    // invalid → save → error alert, not persisted (save button stays)
    await ws.blacklistInput.fill('/(/')
    await save.click()
    await expect(mainWindow.getByRole('alert')).toBeVisible()
    await expect(save).toBeVisible()

    // valid → save → alert gone + save button gone (persisted)
    await ws.blacklistInput.fill('*://*.example.com/*')
    await save.click()
    await expect(mainWindow.getByRole('alert')).toBeHidden()
    await expect(save).toBeHidden()
  })
})
