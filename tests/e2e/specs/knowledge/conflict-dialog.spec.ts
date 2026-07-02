import { expect, test } from '../../fixtures/seeded-electron.fixture'
import { KnowledgePage } from '../../pages/knowledge.page'
import { fixturePath } from '../../utils/e2e-env'
import { t } from '../../utils/i18n'
import { waitForAppReady } from '../../utils/wait-helpers'

/**
 * Spec (kb-m2): adding two different files with the same basename (dupe/a/report.md and
 * dupe/b/report.md) triggers the same-name conflict dialog; "全部保留" keeps both.
 */
test.describe('Knowledge · same-name conflict', () => {
  test('keep-all keeps both same-named sources', async ({ mainWindow, picker }) => {
    test.setTimeout(120_000)
    await waitForAppReady(mainWindow)
    const kb = new KnowledgePage(mainWindow)
    await kb.openBase('E2E_Test_KB')

    await picker.stub([fixturePath('dupe-a')])
    await kb.addFileSource()
    await expect(kb.itemRow('report.md')).toHaveCount(1)

    // same basename from a different folder → conflict dialog
    await picker.stub([fixturePath('dupe-b')])
    await kb.addFileSource()
    await expect(mainWindow.getByText(t('knowledge.data_source.add_dialog.conflict_dialog.title'))).toBeVisible()
    await expect(mainWindow.getByText(t('knowledge.data_source.add_dialog.conflict_dialog.keep_all'))).toBeVisible()
    await expect(mainWindow.getByText(t('knowledge.data_source.add_dialog.conflict_dialog.replace'))).toBeVisible()
    await expect(mainWindow.getByText(t('common.cancel'))).toBeVisible()

    await mainWindow
      .getByRole('button', { name: t('knowledge.data_source.add_dialog.conflict_dialog.keep_all'), exact: true })
      .click()
    await expect(kb.itemRows.filter({ hasText: 'report' })).toHaveCount(2)
  })
})
