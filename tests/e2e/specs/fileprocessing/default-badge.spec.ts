import { expect, test } from '../../fixtures/seeded-electron.fixture'
import { FileProcessingPage } from '../../pages/file-processing.page'
import { waitForAppReady } from '../../utils/wait-helpers'

/**
 * Spec (fp-l2, light-medium.md §2 FP-L2): golden default engines (doc=mineru / image=paddleocr)
 * carry the menu default Badge; selecting the default processor shows the panel default Badge and
 * the "设为默认" button is absent. Locale-free data-feature / data-processor-id anchors.
 */
test.describe('File processing · default-engine badges', () => {
  test('shows menu default badges and panel badge replaces the set-default button', async ({ mainWindow }) => {
    test.setTimeout(120_000)
    await waitForAppReady(mainWindow)
    const fp = new FileProcessingPage(mainWindow)
    await fp.goto()

    // menu default badges: document → mineru, image → paddleocr
    await expect(fp.menuDefaultBadge('document_to_markdown', 'mineru')).toBeVisible()
    await expect(fp.menuDefaultBadge('image_to_text', 'paddleocr')).toBeVisible()

    // selecting the default doc processor → panel default badge + no set-default button
    await fp.selectProcessor('document_to_markdown', 'mineru')
    await expect(fp.panelDefaultBadge('mineru')).toBeVisible()
    await expect(fp.setDefaultButton).toBeHidden()
  })
})
