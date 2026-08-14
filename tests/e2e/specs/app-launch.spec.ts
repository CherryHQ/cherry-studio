import { expect, test } from '../fixtures/electron.fixture'
import { waitForAppReady } from '../utils/wait-helpers'

test.describe('App Launch', () => {
  test('should have window with reasonable size', async ({ electronApp, mainWindow }) => {
    await waitForAppReady(mainWindow)

    const bounds = await electronApp.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0]
      return win?.getBounds()
    })

    expect(bounds).toBeDefined()
    // Window should have some reasonable size (may vary based on saved state)
    expect(bounds!.width).toBeGreaterThan(400)
    expect(bounds!.height).toBeGreaterThan(300)
  })
})
