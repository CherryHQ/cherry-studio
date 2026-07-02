import { expect, test } from '../../fixtures/seeded-electron.fixture'
import { KnowledgePage } from '../../pages/knowledge.page'
import { fixturePath } from '../../utils/e2e-env'
import { waitForAppReady } from '../../utils/wait-helpers'

/**
 * Spec (fp-f1, full · live: file-processing + embedding): the configured parse engine actually
 * converts a PDF and indexes it. Adds a PDF to E2E_Test_KB (golden bakes fileProcessorId=mineru
 * with a live key) → engine converts to Markdown → chunk + embed → the PDF row reaches completed
 * with ≥1 chunk. Anchored by the PDF filename to avoid the pre-existing (already completed)
 * sample.md row. Structural signal only — never asserts chunk text / conversion quality.
 */
test.describe('File processing · PDF ingest via KB', { tag: '@full' }, () => {
  // fixme: live external dependency. The golden bakes fileProcessorId=mineru with a live key; the
  // PDF→Markdown conversion runs against the remote service and does not reliably finish inside the
  // window (slow/throttled key → the row stays processing). The structural add/chunk/embed path is
  // covered by the light/medium fileprocessing + knowledge specs; this end-to-end conversion is
  // reported, not gating. Re-enable with a fast/local engine or a longer budget.
  test.fixme('the parse engine converts a PDF to a completed, chunked item', async ({ mainWindow, picker }) => {
    test.setTimeout(300_000)
    await waitForAppReady(mainWindow)
    const kb = new KnowledgePage(mainWindow)
    await kb.openBase('E2E_Test_KB')

    await picker.stub([fixturePath('sample-pdf')])
    await kb.addFileSource()

    const pdfRow = kb.itemRow('fp-f1-sample').first()
    await expect(pdfRow).toHaveAttribute('data-status', 'completed', { timeout: 180_000 })

    await pdfRow.click()
    await expect(mainWindow.locator('[data-testid="kb-chunk-panel"]')).toBeVisible()
    await expect(mainWindow.locator('[data-testid="kb-chunks-count"]')).toBeVisible()
    await expect(mainWindow.locator('[data-testid="kb-chunk-card"]').first()).toBeVisible()
  })
})
