import { expect, test } from '../../fixtures/seeded-electron.fixture'
import { FileProcessingPage } from '../../pages/file-processing.page'
import { waitForAppReady } from '../../utils/wait-helpers'

/**
 * Spec (fp-l4, light-medium.md §2 FP-L4): the PaddleOCR parse-model select offers feature-specific
 * option sets (image → PP-OCRv*, document → PaddleOCR-VL* / PP-StructureV3). The two paddleocr menu
 * entries are disambiguated by their feature-scoped id. Model strings are locale-free. Offline.
 */
test.describe('File processing · PaddleOCR parse-model options per feature', () => {
  test('offers feature-specific model options', async ({ mainWindow }) => {
    test.setTimeout(120_000)
    await waitForAppReady(mainWindow)
    const fp = new FileProcessingPage(mainWindow)
    await fp.goto()

    // image paddleocr → PP-OCRv6 / PP-OCRv5
    await fp.selectProcessor('image_to_text', 'paddleocr')
    await fp.parseModelTrigger.click()
    await expect(fp.parseModelOption('PP-OCRv6')).toBeVisible()
    await expect(fp.parseModelOption('PP-OCRv5')).toBeVisible()
    await mainWindow.keyboard.press('Escape')

    // document paddleocr → PaddleOCR-VL-1.5 / PP-StructureV3
    await fp.selectProcessor('document_to_markdown', 'paddleocr')
    await fp.parseModelTrigger.click()
    await expect(fp.parseModelOption('PaddleOCR-VL-1.5')).toBeVisible()
    await expect(fp.parseModelOption('PP-StructureV3')).toBeVisible()
    await mainWindow.keyboard.press('Escape')
  })
})
