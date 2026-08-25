import type { Page } from '@playwright/test'

import { expect } from './fixture'

export async function dismissOnboarding(page: Page): Promise<void> {
  const button = page.getByRole('button', { name: 'Set up later', exact: true })
  if (await button.isVisible().catch(() => false)) await button.click()
  await expect(page.locator('[data-ui="app.shell"]').first()).toBeVisible({ timeout: 2 * 60_000 })
}

export async function openLaunchpad(page: Page): Promise<void> {
  await dismissOnboarding(page)
  await page.getByRole('button', { name: 'Launchpad', exact: true }).last().click()
  await expect(page.getByRole('heading', { name: 'Apps', exact: true })).toBeVisible()
}

export async function openLaunchpadApp(page: Page, name: string): Promise<void> {
  await openLaunchpad(page)
  await page.locator('button').filter({ hasText: name }).last().click()
}

export async function selectSidebarApp(page: Page, name: string): Promise<void> {
  await dismissOnboarding(page)
  if (
    await page
      .locator('[data-ui="settings.view"]:visible')
      .isVisible()
      .catch(() => false)
  ) {
    await page.getByRole('button', { name: 'Back', exact: true }).first().click()
    await expect(page.getByRole('button', { name: 'Chat', exact: true }).first()).toBeVisible()
  }
  await page.getByRole('button', { name, exact: true }).first().click()
}
