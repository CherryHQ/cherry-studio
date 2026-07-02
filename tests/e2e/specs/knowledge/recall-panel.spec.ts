import { expect, test } from '../../fixtures/seeded-electron.fixture'
import { KnowledgePage } from '../../pages/knowledge.page'
import { t } from '../../utils/i18n'
import { waitForAppReady } from '../../utils/wait-helpers'

/**
 * Spec (kb-l4): recall panel renders and gates submit on a non-empty query. Stops before the
 * IPC search — pure local state, no live model.
 */
test.describe('Knowledge · recall panel', () => {
  test('renders the panel and gates submit on non-empty input', async ({ mainWindow }) => {
    test.setTimeout(120_000)
    await waitForAppReady(mainWindow)
    const kb = new KnowledgePage(mainWindow)
    await kb.openBase('E2E_Test_KB')

    await kb.openRecallTest()
    await expect(mainWindow.getByText(t('knowledge.recall.empty_title'))).toBeVisible()
    await expect(kb.recallInput).toBeVisible()

    await expect(kb.recallSubmit).toBeDisabled()
    await kb.recallInput.fill('   ')
    await expect(kb.recallSubmit).toBeDisabled()
    await kb.recallInput.fill('knowledge base')
    await expect(kb.recallSubmit).toBeEnabled()
  })
})
