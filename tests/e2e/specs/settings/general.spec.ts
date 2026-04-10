import { expect, test } from '../../fixtures/electron.fixture'
import { SettingsPage } from '../../pages/settings.page'
import { SidebarPage } from '../../pages/sidebar.page'
import { waitForAppReady } from '../../utils/wait-helpers'

test.describe('Settings Page', () => {
  let settingsPage: SettingsPage
  let sidebarPage: SidebarPage

  test.beforeEach(async ({ mainWindow }) => {
    await waitForAppReady(mainWindow)
    sidebarPage = new SidebarPage(mainWindow)
    settingsPage = new SettingsPage(mainWindow)

    // Navigate to settings
    await sidebarPage.goToSettings()
    await mainWindow.waitForTimeout(1000)
  })

  test('should display settings page', async ({ mainWindow }) => {
    const currentUrl = mainWindow.url()
    expect(currentUrl).toContain('/settings')
  })

  test('should have settings menu items', async ({ mainWindow }) => {
    // Check for settings menu items by looking for links
    const menuItems = mainWindow.locator('a[href*="/settings/"]')
    const count = await menuItems.count()
    expect(count).toBeGreaterThan(0)
  })

  test('should navigate to General settings', async ({ mainWindow }) => {
    await settingsPage.goToGeneral()
    await mainWindow.waitForTimeout(500)

    const currentUrl = mainWindow.url()
    expect(currentUrl).toContain('/settings/general')
  })

  test('should navigate to Display settings', async ({ mainWindow }) => {
    await settingsPage.goToDisplay()
    await mainWindow.waitForTimeout(500)

    const currentUrl = mainWindow.url()
    expect(currentUrl).toContain('/settings/display')
  })

  test('should navigate to About page', async ({ mainWindow }) => {
    await settingsPage.goToAbout()
    await mainWindow.waitForTimeout(500)

    const currentUrl = mainWindow.url()
    expect(currentUrl).toContain('/settings/about')
  })
})
