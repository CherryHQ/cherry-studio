import { expect, test } from '../../fixtures/seeded-electron.fixture'
import { KnowledgePage } from '../../pages/knowledge.page'
import { providerSecret } from '../../utils/e2e-env'
import { t } from '../../utils/i18n'
import { waitForAppReady } from '../../utils/wait-helpers'

/**
 * Spec (kb-m3): RAG chunk-size/overlap validation + dirty/save gating (one local DB write),
 * then asserting the primary button switches from "保存" to "重建" when the embedding model
 * changes. Deterministic apart from the second embedding model being available in the picker.
 */
test.describe('Knowledge · RAG chunking', () => {
  test('gates save on chunk validation and switches to rebuild on model change', async ({ mainWindow }) => {
    test.setTimeout(120_000)
    await waitForAppReady(mainWindow)
    const kb = new KnowledgePage(mainWindow)
    await kb.openBase('E2E_Test_KB')
    await kb.openRagConfig()

    // overlap >= size → error + save disabled
    await kb.ragChunkSize.fill('256')
    await kb.ragChunkOverlap.fill('256')
    await expect(mainWindow.getByText(t('knowledge.rag.chunk_overlap_must_be_smaller'))).toBeVisible()
    await expect(kb.ragSaveButton).toBeDisabled()

    // overlap < size → error gone + save enabled
    await kb.ragChunkOverlap.fill('64')
    await expect(mainWindow.getByText(t('knowledge.rag.chunk_overlap_must_be_smaller'))).toBeHidden()
    await expect(kb.ragSaveButton).toBeEnabled()

    // empty size → save disabled
    await kb.ragChunkSize.fill('')
    await expect(kb.ragSaveButton).toBeDisabled()

    // restore valid value → save → toast → save disabled again
    await kb.ragChunkSize.fill('512')
    await kb.ragSaveButton.click()
    await expect(mainWindow.getByText(t('knowledge.rag.saved'))).toBeVisible()
    await expect(kb.ragSaveButton).toBeDisabled()

    // change embedding model → primary action becomes "重建" (assert label only, do not click)
    const secondModel = providerSecret('knowledge', 'secondEmbeddingModelId')
    if (secondModel) {
      await kb.pickModel('knowledge.rag.embedding_model', secondModel)
      await expect(mainWindow.getByText(t('knowledge.restore.submit'))).toBeVisible()
      await expect(kb.ragSaveButton).toBeHidden()
    }
  })
})
