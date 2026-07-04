import { expect, test } from '../../fixtures/seeded-electron.fixture'
import { KnowledgePage } from '../../pages/knowledge.page'
import { providerSecret } from '../../utils/e2e-env'
import { t } from '../../utils/i18n'
import { waitForAppReady } from '../../utils/wait-helpers'

/**
 * Spec (kb-l1, live: embedding): create a new base with offline field validation, then a real
 * embedding model so it indexes to a terminal `completed` status. Probe name differs from the
 * golden `E2E_Test_KB` so the DetailHeader title/status assertions are unambiguous.
 */
test.describe('Knowledge · create base', () => {
  test('validates offline then creates a base that indexes to completed', async ({ mainWindow }) => {
    test.setTimeout(120_000)
    await waitForAppReady(mainWindow)
    const kb = new KnowledgePage(mainWindow)
    await kb.goto()

    await kb.openCreateBaseDialog()
    await expect(kb.createNameInput).toBeVisible()

    // offline validation: empty submit short-circuits before any network call
    await kb.dialogSubmit.click()
    await expect(mainWindow.getByText(t('knowledge.name_required'))).toBeVisible()
    await expect(mainWindow.getByText(t('knowledge.embedding_model_required'))).toBeVisible()

    // success path: fetchDimensions (live) only runs once validation passes
    await kb.createNameInput.fill('E2E Light KB')
    const embeddingModel = providerSecret('knowledge', 'embeddingModelId')
    if (!embeddingModel) throw new Error('no embeddingModelId in activeProviders.knowledge')
    await kb.pickModel('knowledge.embedding_model', embeddingModel)
    await kb.dialogSubmit.click()

    // result: probe base opened (DetailHeader title) + terminal status (locale-free data-*)
    await expect(kb.detailTitle('E2E Light KB')).toBeVisible()
    await expect(kb.baseStatus).toHaveAttribute('data-status', 'completed', { timeout: 60_000 })
  })
})
