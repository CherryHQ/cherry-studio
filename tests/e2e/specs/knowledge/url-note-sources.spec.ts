import { expect, test } from '../../fixtures/seeded-electron.fixture'
import { KnowledgePage } from '../../pages/knowledge.page'
import { waitForAppReady } from '../../utils/wait-helpers'

/**
 * Spec (kb-m1): add a URL source and a Note source. Only add-time assertions (the row appears) —
 * does not wait for the URL crawl. Note source requires the golden to ship the seed note
 * `e2e-seed-note`.
 */
test.describe('Knowledge · url & note sources', () => {
  test.use({ seedNotes: true })

  test('adds a URL source and a seeded note source', async ({ mainWindow }) => {
    test.setTimeout(120_000)
    await waitForAppReady(mainWindow)
    const kb = new KnowledgePage(mainWindow)
    await kb.openBase('E2E_Test_KB')

    // URL source (add-time only; the dialog "添加" is disabled until a URL is entered)
    await kb.openAddSource('url')
    await expect(kb.dialogAddButton).toBeDisabled()
    await mainWindow.locator('#knowledge-source-url-input').fill('https://example.com')
    await expect(kb.dialogAddButton).toBeEnabled()
    await kb.dialogAddButton.click()
    await expect(kb.itemRow('example.com')).toBeVisible()

    // Note source (seeded)
    await kb.openAddSource('note')
    const noteList = mainWindow.locator('[data-testid="knowledge-source-note-list"]')
    await expect(noteList).toBeVisible()
    await noteList.getByRole('listitem').filter({ hasText: 'e2e-seed-note' }).click()
    await expect(kb.dialogAddButton).toBeEnabled()
    await kb.dialogAddButton.click()
    await expect(kb.itemRow('e2e-seed-note')).toBeVisible()
  })
})
