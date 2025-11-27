import { test, expect } from '../fixtures/electron.fixture'
import { waitForAppReady } from '../utils/wait-helpers'

test.describe('App Launch', () => {
  test('should launch the application successfully', async ({ mainWindow }) => {
    await waitForAppReady(mainWindow)
    expect(mainWindow).toBeDefined()

    const title = await mainWindow.title()
    expect(title).toBeTruthy()
  })

  test('should display the main content', async ({ mainWindow }) => {
    await waitForAppReady(mainWindow)

    // Check for main app content
    const hasContent = await mainWindow.evaluate(() => {
      const root = document.querySelector('#root')
      return root !== null && root.innerHTML.length > 100
    })

    expect(hasContent).toBe(true)
  })

  test('should have React root mounted', async ({ mainWindow }) => {
    await waitForAppReady(mainWindow)

    const hasReactRoot = await mainWindow.evaluate(() => {
      const root = document.querySelector('#root')
      return root !== null && root.children.length > 0
    })

    expect(hasReactRoot).toBe(true)
  })

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
