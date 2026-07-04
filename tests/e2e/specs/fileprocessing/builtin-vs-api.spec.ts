import { expect, test } from '../../fixtures/seeded-electron.fixture'
import { FileProcessingPage } from '../../pages/file-processing.page'
import { waitForAppReady } from '../../utils/wait-helpers'

/**
 * Spec (fp-l3, light-medium.md §2 FP-L3): panel conditional render — builtin processors
 * (system/tesseract) expose NO api config; api processors (mineru) show api key input +
 * key-list button + api host, and only paddleocr shows the parse-model select. Offline.
 */
test.describe('File processing · builtin vs api panel render', () => {
  test('builtin has no api config; api processor shows api fields but no parse-model', async ({ mainWindow }) => {
    test.setTimeout(120_000)
    await waitForAppReady(mainWindow)
    const fp = new FileProcessingPage(mainWindow)
    await fp.goto()

    // system (builtin): status block; no api key input / no key-list button
    await fp.selectProcessor('image_to_text', 'system')
    await expect(fp.systemStatusAvailable).toBeVisible()
    await expect(fp.apiKeysInput).toBeHidden()
    await expect(fp.apiKeyListOpen).toBeHidden()

    // tesseract (builtin): language-pack row; no api key input
    await fp.selectProcessor('image_to_text', 'tesseract')
    await expect(fp.languagesRow).toBeVisible()
    await expect(fp.apiKeysInput).toBeHidden()

    // mineru (api): api key + key-list button + api host; no parse-model (not paddleocr)
    await fp.selectProcessor('document_to_markdown', 'mineru')
    await expect(fp.apiKeysInput).toBeVisible()
    await expect(fp.apiKeyListOpen).toBeVisible()
    await expect(fp.apiHostInput).toBeVisible()
    await expect(fp.parseModelTrigger).toBeHidden()
  })
})
