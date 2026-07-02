import { expect, test } from '../../fixtures/seeded-electron.fixture'
import { KnowledgePage } from '../../pages/knowledge.page'
import { fixturePath } from '../../utils/e2e-env'
import { waitForAppReady } from '../../utils/wait-helpers'

/**
 * Spec (kb-l2): in the seeded base `E2E_Test_KB` (golden ships it with a single item, sample.md),
 * add a file through the data-source picker (stubbed → report.md) and verify the new item row.
 *
 * Deterministic / offline: adding a file creates the item row immediately; embedding is not
 * required for the row to appear, so no live model is needed.
 */
const TARGET_BASE = 'E2E_Test_KB'

test.describe('Knowledge · add file source', () => {
  test('adds a picked file to the knowledge base', async ({ mainWindow, picker }) => {
    test.setTimeout(120_000) // golden copy + Electron launch can exceed the default 60s
    await waitForAppReady(mainWindow)
    const kb = new KnowledgePage(mainWindow)

    await kb.openBase(TARGET_BASE)
    await expect(kb.itemRows).toHaveCount(1)

    const report = fixturePath('dupe-a')
    await picker.stub([report])

    await kb.addFileSource()

    await expect(kb.itemRows).toHaveCount(2)
    await expect(kb.itemRow('report.md')).toBeVisible()
    expect(await picker.hits()).toBe(1)
  })
})
