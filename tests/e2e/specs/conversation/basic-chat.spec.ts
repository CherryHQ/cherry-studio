import { expect, test } from '../../fixtures/electron.fixture'
import { waitForAppReady } from '../../utils/wait-helpers'

test.describe('Basic Chat', () => {
  test.beforeEach(async ({ mainWindow }) => {
    await waitForAppReady(mainWindow)
  })

  test('should display main content on home page', async ({ mainWindow }) => {
    // Home page is the default, just verify content exists
    const hasContent = await mainWindow.evaluate(() => {
      const root = document.querySelector('#root')
      return root !== null && root.innerHTML.length > 100
    })

    expect(hasContent).toBe(true)
  })

  test('should have input area for chat', async ({ mainWindow }) => {
    // Look for textarea or input elements that could be chat input
    const inputElements = mainWindow.locator('textarea, [contenteditable="true"], input[type="text"]')
    const count = await inputElements.count()

    // There should be at least one input element
    expect(count).toBeGreaterThan(0)
  })

  test('should have interactive elements', async ({ mainWindow }) => {
    // Check for buttons or clickable elements
    const buttons = mainWindow.locator('button')
    const count = await buttons.count()

    expect(count).toBeGreaterThan(0)
  })
})
