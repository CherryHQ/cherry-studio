import { expect, test } from '../../fixtures/seeded-electron.fixture'
import { KnowledgePage } from '../../pages/knowledge.page'
import { t } from '../../utils/i18n'
import { waitForAppReady } from '../../utils/wait-helpers'

/**
 * Spec (kb-m7): navigator group/base management — create group (empty-name gate + valid), move
 * a base into it, rename the base (DetailHeader h1 updates), search empty-state + clear. Fully
 * deterministic (local DB / state). Per-test golden isolation removes any self-reset burden.
 */
test.describe('Knowledge · navigator management', () => {
  test('creates a group, moves a base in, renames it, searches', async ({ mainWindow }) => {
    test.setTimeout(120_000)
    await waitForAppReady(mainWindow)
    const kb = new KnowledgePage(mainWindow)
    await kb.openBase('E2E_Test_KB')

    // create group: empty name gated, then valid name
    await kb.openCreateGroupDialog()
    await expect(kb.entityNameInput).toBeVisible()
    await kb.dialogSubmit.click()
    await expect(mainWindow.getByText(t('knowledge.groups.name_required'))).toBeVisible()
    await kb.entityNameInput.fill('e2e-group')
    await kb.dialogSubmit.click()
    await expect(kb.group('e2e-group')).toBeVisible()

    // move base into the group (move_to opens a submenu in a separate popper)
    await kb.openBaseRowMenu('E2E_Test_KB')
    await mainWindow.getByRole('menuitem', { name: t('knowledge.context.move_to') }).click()
    await mainWindow.getByRole('menuitem', { name: 'e2e-group', exact: true }).click()
    await kb.expandGroup('e2e-group')
    await expect(
      mainWindow.locator('[data-group-name="e2e-group"] [data-testid="kb-base-row"]').filter({ hasText: 'E2E_Test_KB' })
    ).toBeVisible()

    // rename base → DetailHeader h1 updates
    await kb.openBaseRowMenu('E2E_Test_KB')
    await mainWindow.getByRole('menuitem', { name: t('knowledge.context.rename') }).click()
    await kb.entityNameInput.fill('E2E_Test_KB Renamed')
    await kb.dialogSubmit.click()
    await expect(kb.detailTitle('E2E_Test_KB Renamed')).toBeVisible()

    // navigator search empty-state + clear restores the row
    await kb.searchInput.fill('no-match-e2e')
    await expect(mainWindow.getByText(t('knowledge.empty'))).toBeVisible()
    await kb.clearSearch.click()
    await expect(kb.baseRow('E2E_Test_KB Renamed')).toBeVisible()
  })
})
