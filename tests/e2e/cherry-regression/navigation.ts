import type { Page } from '@playwright/test'
import { expect } from '@playwright/test'

export async function dismissTransientDialogs(page: Page): Promise<void> {
  // Close the model-picker popover before dismissing its parent configuration dialog.
  await page.keyboard.press('Escape')
  const dialogs = page.getByRole('dialog')
  for (let count = await dialogs.count(); count > 0; count -= 1) {
    const dismiss = dialogs
      .last()
      .getByRole('button', { name: /^(Cancel|Close)$/ })
      .last()
    if (await dismiss.isVisible()) await dismiss.click()
    else await page.keyboard.press('Escape')
    await expect(dialogs).toHaveCount(count - 1, { timeout: 5_000 })
  }
}

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
  await page.getByRole('button', { name, exact: true }).last().click()
}

export async function selectSidebarApp(page: Page, name: string): Promise<void> {
  await dismissOnboarding(page)
  const targetView = {
    Chat: '[data-ui="chat.view"]:visible',
    Settings: '[data-ui="settings.view"]:visible',
    Work: '[data-ui="agent.view"]:visible'
  }[name]
  if (
    await page
      .locator('[data-ui="settings.view"]:visible')
      .isVisible()
      .catch(() => false)
  ) {
    await page.getByRole('button', { name: 'Back', exact: true }).first().click()
    await expect(page.getByRole('button', { name: 'Chat', exact: true }).first()).toBeVisible()
  }
  const sidebarButton = page.getByRole('button', { name, exact: true }).first()
  if (await sidebarButton.isVisible().catch(() => false)) {
    await sidebarButton.click({ noWaitAfter: true })
  } else {
    const back = page.getByRole('button', { name: 'Back', exact: true }).first()
    if (await back.isVisible().catch(() => false)) {
      await back.click()
      await sidebarButton.waitFor({ state: 'visible', timeout: 30_000 }).catch(() => undefined)
    }
    if (await sidebarButton.isVisible().catch(() => false)) {
      await sidebarButton.click({ noWaitAfter: true })
    } else {
      await openLaunchpad(page)
      await page.getByRole('button', { name, exact: true }).last().click({ noWaitAfter: true })
    }
  }
  if (targetView) await expect(page.locator(targetView).first()).toBeVisible({ timeout: 30_000 })
}
