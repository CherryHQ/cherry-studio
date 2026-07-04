import { expect, test } from '../../fixtures/seeded-electron.fixture'
import { WebSearchSettingsPage } from '../../pages/websearch-settings.page'
import { waitForAppReady } from '../../utils/wait-helpers'

/**
 * Spec (ws-l2): selecting compression method "截断" (cutoff) reveals the cutoff-limit input;
 * switching back to "不压缩" (none) hides it. Pure conditional render.
 */
test.describe('WebSearch · compression field', () => {
  test('cutoff method conditionally reveals the limit input', async ({ mainWindow }) => {
    test.setTimeout(120_000)
    await waitForAppReady(mainWindow)
    const ws = new WebSearchSettingsPage(mainWindow)
    await ws.goto()

    await expect(ws.cutoffLimitInput).toBeHidden()
    await ws.selectCompression('cutoff')
    await expect(ws.cutoffLimitInput).toBeVisible()
    await ws.selectCompression('none')
    await expect(ws.cutoffLimitInput).toBeHidden()
  })
})
