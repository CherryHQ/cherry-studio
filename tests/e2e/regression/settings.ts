import { expect, type Page } from '@playwright/test'

import { dismissOnboarding, selectSidebarApp } from './navigation'

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
    .locator('[data-ui="settings.navigation"] [data-slot="menu-item"]')
    .filter({ hasText: section })
    .first()
  if (!(await sectionButton.isVisible().catch(() => false))) {
    await selectSidebarApp(page, 'Settings')
  }
  await sectionButton.click()
}

export async function closeSettings(page: Page): Promise<void> {
  await closeOpenSettingsDrawer(page)
  await page.getByRole('button', { name: 'Back', exact: true }).first().click()
  await expect(page.getByRole('button', { name: 'Chat', exact: true }).first()).toBeVisible()
}
