import { expect, test } from '../../fixtures/seeded-electron.fixture'
import { KnowledgePage } from '../../pages/knowledge.page'
import { waitForAppReady } from '../../utils/wait-helpers'

/**
 * Spec (kb-l3): open the chunk drawer for a completed item. The golden `E2E_Test_KB` ships
 * sample.md already indexed to `completed`, so this runs without a live embedding call —
 * clicking a completed row opens its chunks.
 */
test.describe('Knowledge · index & chunks', () => {
  test('opens the chunk drawer for a completed item', async ({ mainWindow }) => {
    test.setTimeout(120_000)
    await waitForAppReady(mainWindow)
    const kb = new KnowledgePage(mainWindow)
    await kb.openBase('E2E_Test_KB')

    const completedRow = kb.itemRowByStatus('completed').first()
    await expect(completedRow).toBeVisible({ timeout: 120_000 })
    await completedRow.click()

    await expect(mainWindow.locator('[data-testid="kb-chunk-panel"]')).toBeVisible()
    await expect(mainWindow.locator('[data-testid="kb-chunks-count"]')).toBeVisible()
    await expect(mainWindow.locator('[data-testid="kb-chunk-card"]').first()).toBeVisible()
  })
})
