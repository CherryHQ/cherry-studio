import { expect, type Page } from '@playwright/test'

import { dismissOnboarding, openLaunchpadApp, selectSidebarApp } from './navigation'

export async function openMcpServers(page: Page): Promise<void> {
  await openLaunchpadApp(page, 'Marketplace')
  const marketplace = page.getByTestId('marketplace-page')
  await marketplace
    .getByRole('complementary', { name: 'Resource types' })
    .getByRole('button', { name: /^MCP\b/ })
    .click()
  await marketplace.getByRole('button', { name: 'Manage MCP', exact: true }).click()
  await expect(
    page.locator('[data-ui~="settings.content"]:visible').getByRole('button', { name: 'Add', exact: true })
  ).toBeVisible()
}

export async function closeOpenSettingsDrawer(page: Page): Promise<void> {
  const drawer = page.locator('[data-slot="page-side-panel"][role="dialog"]:visible').first()
  if (!(await drawer.isVisible().catch(() => false))) return

  await page.keyboard.press('Escape')
  if (await drawer.isVisible().catch(() => false)) {
    const closed = await drawer
      .waitFor({ state: 'hidden', timeout: 1_000 })
      .then(() => true)
      .catch(() => false)
    if (!closed) await drawer.getByRole('button', { name: 'Close', exact: true }).click()
  }
  await expect(drawer).toBeHidden()
}

export async function openSettingsSection(page: Page, section: string): Promise<void> {
  await dismissOnboarding(page)
  await page.keyboard.press('Escape')
  await closeOpenSettingsDrawer(page)
  const sectionButton = page
    .locator('[data-ui~="settings.navigation"] [data-slot="menu-item"]')
    .filter({ hasText: section })
    .first()
  if (!(await sectionButton.isVisible().catch(() => false))) {
    await selectSidebarApp(page, 'Settings')
  }
  await sectionButton.click()
}

export async function closeSettings(page: Page): Promise<void> {
  await closeOpenSettingsDrawer(page)
  await page.locator('[data-ui~="app.tab-bar"]').getByRole('button', { name: 'Back', exact: true }).click()
  await expect(page.locator('[data-ui~="settings.view"]:visible')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Chat', exact: true }).first()).toBeVisible()
}
