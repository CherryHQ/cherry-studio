import type { Page } from '@playwright/test'
import { expect } from '@playwright/test'

export async function openSettings(page: Page): Promise<void> {
  const settings = page.locator('[data-ui~="settings.view"]:visible')
  if (await settings.isVisible()) return
  await page
    .locator('[data-ui~="app.sidebar"]')
    .getByRole('button', { name: /^(User|用户)$/ })
    .click()
  const menu = page.locator('[aria-label="Account menu"], [aria-label="账户菜单"]')
  await expect(menu).toBeVisible()
  await menu.getByRole('button', { name: /^(Settings|设置)$/ }).click()
  await expect(settings).toBeVisible()
}
