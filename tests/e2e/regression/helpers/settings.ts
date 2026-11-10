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
  await selectSidebarApp(page, 'Settings')
  const navigation = page.locator('[data-ui~="settings.navigation"]:visible')
  const sectionButton = navigation.locator('[data-slot="menu-item"]').filter({ hasText: section }).first()
  if (await sectionButton.count()) {
    await sectionButton.click()
    return
  }
  await navigation.getByRole('button', { name: 'Built-in Tools', exact: true }).click()
  await page
    .getByRole('navigation', { name: 'Built-in Tools', exact: true })
    .getByRole('button', { name: section, exact: true })
    .click()
}

export async function closeSettings(page: Page): Promise<void> {
  await closeOpenSettingsDrawer(page)
  await page.locator('[data-ui~="app.tab-bar"]').getByRole('button', { name: 'Back', exact: true }).click()
  await expect(page.locator('[data-ui~="settings.view"]:visible')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Chat', exact: true }).first()).toBeVisible()
}
