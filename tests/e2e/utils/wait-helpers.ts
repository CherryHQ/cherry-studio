import { Page } from '@playwright/test'

/**
 * Wait for the application to be fully ready.
 * The app uses PersistGate which may delay initial render.
 * Layout can be either Sidebar-based or TabsContainer-based depending on settings.
 */
export async function waitForAppReady(page: Page, timeout: number = 60000): Promise<void> {
  // First, wait for React root to be attached
  await page.waitForSelector('#root', { state: 'attached', timeout })

  // Wait for main app content to render
  // The app may show either:
  // 1. Sidebar layout (navbarPosition === 'left')
  // 2. TabsContainer layout (default)
  // 3. Home page content
  await page.waitForSelector(
    [
      '#home-page', // Home page container
      '[class*="Sidebar"]', // Sidebar component
      '[class*="TabsContainer"]', // Tabs container
      '[class*="home-navbar"]', // Home navbar
      '[class*="Container"]' // Generic container from styled-components
    ].join(', '),
    {
      state: 'visible',
      timeout
    }
  )

  // Additional wait for React to fully hydrate
  await page.waitForLoadState('domcontentloaded')
}

/**
 * Wait for navigation to a specific path.
 * The app uses HashRouter, so paths are prefixed with #.
 */
export async function waitForNavigation(page: Page, path: string, timeout: number = 15000): Promise<void> {
  await page.waitForURL(`**/#${path}**`, { timeout })
}

/**
 * Wait for the chat interface to be ready.
 */
export async function waitForChatReady(page: Page, timeout: number = 30000): Promise<void> {
  await page.waitForSelector(
    [
      '#home-page',
      '[class*="Chat"]',
      '[class*="Inputbar"]',
      '[class*="home-tabs"]'
    ].join(', '),
    { state: 'visible', timeout }
  )
}

/**
 * Wait for the settings page to load.
 */
export async function waitForSettingsLoad(page: Page, timeout: number = 30000): Promise<void> {
  await page.waitForSelector(
    [
      '[class*="SettingsPage"]',
      '[class*="Settings"]',
      'a[href*="/settings/"]'
    ].join(', '),
    { state: 'visible', timeout }
  )
}

/**
 * Wait for a modal/dialog to appear.
 */
export async function waitForModal(page: Page, timeout: number = 10000): Promise<void> {
  await page.waitForSelector('.ant-modal, [role="dialog"], .ant-drawer', { state: 'visible', timeout })
}

/**
 * Wait for a modal/dialog to close.
 */
export async function waitForModalClose(page: Page, timeout: number = 10000): Promise<void> {
  await page.waitForSelector('.ant-modal, [role="dialog"], .ant-drawer', { state: 'hidden', timeout })
}

/**
 * Wait for loading state to complete.
 */
export async function waitForLoadingComplete(page: Page, timeout: number = 30000): Promise<void> {
  const spinner = page.locator('.ant-spin, [class*="Loading"], [class*="Spinner"]')
  if ((await spinner.count()) > 0) {
    await spinner.first().waitFor({ state: 'hidden', timeout })
  }
}

/**
 * Wait for a notification/toast to appear.
 */
export async function waitForNotification(page: Page, timeout: number = 10000): Promise<void> {
  await page.waitForSelector('.ant-notification, .ant-message, [class*="Notification"]', {
    state: 'visible',
    timeout
  })
}

/**
 * Sleep for a specified duration.
 * Use sparingly - prefer explicit waits when possible.
 */
export async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
