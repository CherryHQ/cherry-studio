import { expect, test } from '../../fixtures/seeded-electron.fixture'
import { FileProcessingPage } from '../../pages/file-processing.page'
import { t } from '../../utils/i18n'
import { waitForAppReady } from '../../utils/wait-helpers'

/**
 * Spec (fp-m3, light-medium.md §2 FP-M3): an invalid API host on blur raises the warning toast
 * (errors.invalid_api_host). mistral has an api-host field on both features. The toast is transient
 * → assert promptly (auto-retrying expect). No success signal on valid → invalid path only. Offline.
 */
test.describe('File processing · api host validation', () => {
  test('invalid host on blur raises the warning toast', async ({ mainWindow }) => {
    test.setTimeout(120_000)
    await waitForAppReady(mainWindow)
    const fp = new FileProcessingPage(mainWindow)
    await fp.goto()

    // mistral panel has an api-host field; replace its value with an invalid host, then blur
    await fp.selectProcessor('image_to_text', 'mistral')
    await fp.apiHostInput.fill('not a url')
    await mainWindow.keyboard.press('Tab')

    await expect(mainWindow.getByText(t('settings.tool.file_processing.errors.invalid_api_host'))).toBeVisible()
  })
})
