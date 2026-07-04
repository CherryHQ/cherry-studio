import { expect, test } from '../../fixtures/seeded-electron.fixture'
import { FileProcessingPage } from '../../pages/file-processing.page'
import { waitForAppReady } from '../../utils/wait-helpers'

/**
 * Spec (fp-m1, light-medium.md §2 FP-M1): "设为默认" toggles button → panel/menu default Badge
 * (no toast). The mutation lives in the per-test golden copy; we still reset the doc default back
 * to mineru at the end (matches the YAML's idempotency intent — harmless under per-test isolation).
 */
test.describe('File processing · set-as-default toggle', () => {
  test('sets doc2x default (button→badge), then resets to mineru', async ({ mainWindow }) => {
    test.setTimeout(120_000)
    await waitForAppReady(mainWindow)
    const fp = new FileProcessingPage(mainWindow)
    await fp.goto()

    // doc2x is non-default → set-default button visible & enabled, no panel badge
    await fp.selectProcessor('document_to_markdown', 'doc2x')
    await expect(fp.panelDefaultBadge()).toBeHidden()
    await expect(fp.setDefaultButton).toBeVisible()
    await expect(fp.setDefaultButton).toBeEnabled()

    // click set-default → panel badge + menu badge migrate to doc2x (no toast)
    await fp.setDefaultButton.click()
    await expect(fp.panelDefaultBadge('doc2x')).toBeVisible()
    await expect(fp.menuDefaultBadge('document_to_markdown', 'doc2x')).toBeVisible()

    // reset doc default → mineru (golden idempotency)
    await fp.selectProcessor('document_to_markdown', 'mineru')
    await fp.setDefaultButton.click()
    await expect(fp.panelDefaultBadge('mineru')).toBeVisible()
  })
})
