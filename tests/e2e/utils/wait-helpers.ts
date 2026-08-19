import type { Page } from '@playwright/test'

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
      '[class*="Container"]' // Generic generated container class
    ].join(', '),
    {
      state: 'visible',
      timeout
    }
  )

  // Additional wait for React to fully hydrate
  await page.waitForLoadState('domcontentloaded')
}
