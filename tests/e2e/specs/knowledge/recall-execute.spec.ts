import { expect, test } from '../../fixtures/seeded-electron.fixture'
import { KnowledgePage } from '../../pages/knowledge.page'
import { fixturePath } from '../../utils/e2e-env'
import { t } from '../../utils/i18n'
import { waitForAppReady } from '../../utils/wait-helpers'

/**
 * Spec (kb-m5, live: embedding): execute a recall (assert only the envelope — count text, not
 * ranking/scores/content), then exercise history CRUD and result-card copy/expand/collapse.
 */
test.describe('Knowledge · execute recall', () => {
  test('runs a recall and exercises history + result cards', async ({ mainWindow }) => {
    test.setTimeout(120_000)
    await waitForAppReady(mainWindow)
    const kb = new KnowledgePage(mainWindow)
    await kb.openBase('E2E_Test_KB')
    await kb.openRecallTest()

    const query = fixturePath('recall-query')
    await kb.recallInput.fill(query)
    await kb.recallSubmit.click()
    await expect(kb.recallSubmit).toBeDisabled() // searching

    const resultCount = new RegExp(t('knowledge.recall.result_count').replace('{{count}}', '\\d+'))
    await expect(mainWindow.getByText(resultCount)).toBeVisible({ timeout: 60_000 })

    // history CRUD (local state): focus → panel opens with the query; pick → backfills + closes
    await kb.recallInput.click()
    await expect(kb.recallHistory).toBeVisible()
    await expect(mainWindow.getByText(t('knowledge.recall.history_title'))).toBeVisible()
    await kb.recallHistoryItem(query).click()
    await expect(kb.recallHistory).toBeHidden()

    // re-open via toggle → hover → single delete empties history → panel/title gone
    await kb.recallHistoryToggle.click()
    await expect(kb.recallHistory).toBeVisible()
    await kb.recallHistoryItem(query).hover()
    await kb
      .recallHistoryItem(query)
      .locator(`[aria-label="${t('knowledge.recall.history_remove')}"]`)
      .click()
    await expect(mainWindow.getByText(t('knowledge.recall.history_title'))).toBeHidden()

    // result card: copy icon, then expand → collapse
    await mainWindow
      .locator(`[aria-label="${t('knowledge.recall.copy')}"]`)
      .first()
      .click()
    await mainWindow
      .locator(`[aria-label="${t('knowledge.recall.expand')}"]`)
      .first()
      .click()
    await mainWindow
      .locator(`[aria-label="${t('knowledge.recall.collapse')}"]`)
      .first()
      .click()
  })
})
