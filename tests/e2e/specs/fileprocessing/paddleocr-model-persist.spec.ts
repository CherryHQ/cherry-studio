import { expect, test } from '../../fixtures/seeded-electron.fixture'
import { FileProcessingPage } from '../../pages/file-processing.page'
import { waitForAppReady } from '../../utils/wait-helpers'

/**
 * Spec (fp-m4, light-medium.md §2 FP-M4): the PaddleOCR parse-model selection persists across
 * navigation (preference write). Select PP-StructureV3, navigate away (mineru) and back, the
 * trigger value still reads PP-StructureV3. Pure local state + preference persistence; offline.
 */
test.describe('File processing · PaddleOCR model persistence', () => {
  test('parse-model selection survives navigating away and back', async ({ mainWindow }) => {
    test.setTimeout(120_000)
    await waitForAppReady(mainWindow)
    const fp = new FileProcessingPage(mainWindow)
    await fp.goto()

    // document paddleocr → select PP-StructureV3
    await fp.selectProcessor('document_to_markdown', 'paddleocr')
    await fp.selectParseModel('PP-StructureV3')

    // navigate away (mineru) then back → trigger still shows PP-StructureV3
    await fp.selectProcessor('document_to_markdown', 'mineru')
    await fp.selectProcessor('document_to_markdown', 'paddleocr')
    await expect(fp.parseModelTrigger).toContainText('PP-StructureV3')
  })
})
