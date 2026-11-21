import type { Locator, Page } from '@playwright/test'
import { expect } from '@playwright/test'

export async function openConversationListOptions(view: Locator): Promise<void> {
  const options = view.getByRole('button', { name: 'List options', exact: true })
  const showSidebar = view.getByRole('button', { name: 'Show Sidebar', exact: true })
  await expect(options.or(showSidebar).first()).toBeVisible()
  if (!(await options.isVisible())) await showSidebar.click()
  await options.click()
}

export async function selectConversationListOption(
  view: Locator,
  section: 'Group by' | 'Sort by',
  option: string
): Promise<void> {
  const page = view.page()
  await openConversationListOptions(view)
  await page.getByRole('menuitem', { name: new RegExp(`^${section}\\b`) }).press('ArrowRight')
  await page.getByRole('menuitemradio', { name: option, exact: true }).click()
  await expect(view.getByRole('button', { name: 'List options', exact: true })).toHaveAttribute(
    'aria-expanded',
    'false'
  )
}

export async function dismissTransientDialogs(page: Page): Promise<void> {
  // Escape closes popovers and most dialogs, but a dialog without an Escape handler stays
  // on screen and then poisons every later case in the same copy (one leftover modal made
  // 40 unrelated cases fail). So: press Escape, then fall back to the dialog's own dismissal
  // control, and fail with the dialog's text so the culprit is named instead of anonymous.
  await page.keyboard.press('Escape')
  const dialogs = page.getByRole('dialog')
  for (let attempt = 0; attempt < 4; attempt += 1) {
    if ((await dialogs.count()) === 0) return
    const dialog = dialogs.first()
    const close = dialog.getByRole('button', { name: /^(close|dismiss|cancel|got it)$/i }).first()
    if (await close.isVisible().catch(() => false)) {
      await close.click({ timeout: 2_000 }).catch(() => undefined)
    } else {
      await page.keyboard.press('Escape')
    }
    await page.waitForTimeout(250)
  }
  const remaining = await dialogs.count()
  if (remaining > 0) {
    const text = await dialogs
      .first()
      .innerText()
      .catch(() => '<unreadable>')
    throw new Error(`A dialog stayed open after Escape and its own dismissal control: ${text.slice(0, 400)}`)
  }
}

export async function dismissOnboarding(page: Page): Promise<void> {
  const button = page.getByRole('button', { name: 'Set up later', exact: true })
  if (await button.isVisible().catch(() => false)) await button.click()
  await expect(page.locator('#app-sidebar, [data-ui~="settings.view"]:visible').first()).toBeVisible({
    timeout: 30_000
  })
}

export async function openLaunchpad(page: Page): Promise<void> {
  await dismissOnboarding(page)
  if (await page.getByRole('heading', { name: 'Apps', exact: true }).isVisible()) return
  await page.getByRole('button', { name: 'Launchpad', exact: true }).last().click()
  await expect(page.getByRole('heading', { name: 'Apps', exact: true })).toBeVisible()
}

export async function openLaunchpadApp(page: Page, name: string): Promise<void> {
  await openLaunchpad(page)
  await page.getByRole('button', { name, exact: true }).last().click()
}

async function openAccountMenu(page: Page): Promise<Locator> {
  const accountMenu = page.locator('[aria-label="Account menu"], [aria-label="账户菜单"]')
  if (!(await accountMenu.isVisible())) {
    await page.locator('[data-ui~="app.sidebar"]').locator('button[data-notification-anchor="left"]').click()
  }
  await expect(accountMenu).toBeVisible()
  return accountMenu
}

export async function openHelpMenu(page: Page): Promise<void> {
  const accountMenu = await openAccountMenu(page)
  await accountMenu.getByRole('button', { name: /^(Help|帮助)$/ }).click()
}

export async function selectSidebarApp(page: Page, name: string): Promise<void> {
  await dismissOnboarding(page)
  if (name === 'Settings') {
    const settings = page.locator('[data-ui~="settings.view"]:visible')
    // The account menu re-renders while its entry animation runs, so a single click can land on
    // a detached item and leave the menu closed; retry the whole open-then-click sequence.
    await expect(async () => {
      if (await settings.isVisible()) return
      if (await page.locator('[data-slot="dialog-overlay"]:visible').first().isVisible()) {
        await dismissTransientDialogs(page)
      }
      const accountMenu = await openAccountMenu(page)
      await accountMenu.getByRole('button', { name: 'Settings', exact: true }).click({ timeout: 5_000 })
      await expect(settings).toBeVisible({ timeout: 5_000 })
    }).toPass({ timeout: 30_000 })
    return
  }
  const targetView = {
    Chat: '[data-ui~="chat.view"]:visible',
    Files: '[data-ui~="files.view"]:visible',
    Settings: '[data-ui~="settings.view"]:visible',
    Work: '[data-ui~="agent.view"]:visible'
  }[name]
  if (
    await page
      .locator('[data-ui~="settings.view"]:visible')
      .isVisible()
      .catch(() => false)
  ) {
    await page.locator('[data-ui~="app.tab-bar"]').getByRole('button', { name: 'Back', exact: true }).click()
    await expect(page.locator('[data-ui~="settings.view"]:visible')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Chat', exact: true }).first()).toBeVisible()
  }
  const sidebarButton = page.getByRole('button', { name, exact: true }).first()
  if (await sidebarButton.isVisible().catch(() => false)) {
    await sidebarButton.click({ noWaitAfter: true })
  } else {
    const back = page.locator('[data-ui~="app.tab-bar"]').getByRole('button', { name: 'Back', exact: true })
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
