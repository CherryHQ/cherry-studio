import { expect, test } from '../../fixtures/seeded-electron.fixture'
import { KnowledgePage } from '../../pages/knowledge.page'
import { providerSecret } from '../../utils/e2e-env'
import { waitForAppReady } from '../../utils/wait-helpers'

/**
 * Spec (kb-m4): RAG retrieval fields show/hide by search mode — pure conditional render, no
 * network. vector → threshold, hybrid → hybrid_alpha, bm25 → neither; selecting a rerank model
 * brings threshold back.
 */
test.describe('Knowledge · RAG retrieval fields', () => {
  test('shows/hides threshold & hybrid_alpha by search mode', async ({ mainWindow }) => {
    test.setTimeout(120_000)
    await waitForAppReady(mainWindow)
    const kb = new KnowledgePage(mainWindow)
    await kb.openBase('E2E_Test_KB')
    await kb.openRagConfig()

    await expect(kb.ragSlider('knowledge.rag.document_count')).toBeVisible()

    await kb.selectSearchMode('vector')
    await expect(kb.ragSlider('knowledge.rag.threshold')).toBeVisible()
    await expect(kb.ragSlider('knowledge.rag.hybrid_alpha')).toBeHidden()

    await kb.selectSearchMode('hybrid')
    await expect(kb.ragSlider('knowledge.rag.hybrid_alpha')).toBeVisible()
    await expect(kb.ragSlider('knowledge.rag.threshold')).toBeHidden()

    await kb.selectSearchMode('bm25')
    await expect(kb.ragSlider('knowledge.rag.threshold')).toBeHidden()

    // rerank model brings threshold back (skip if no rerank model configured)
    const rerankModel = providerSecret('knowledge', 'rerankModelId')
    if (rerankModel) {
      await kb.pickModel('knowledge.rag.rerank_model', rerankModel)
      await expect(kb.ragSlider('knowledge.rag.threshold')).toBeVisible()
    }
  })
})
