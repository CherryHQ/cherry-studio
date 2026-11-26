import type { Locator, Page } from '@playwright/test'
import { expect } from '@playwright/test'

export async function showConversationSidebar(chatView: Locator): Promise<Locator> {
  const topics = chatView.locator('[data-ui~="chat.topic-list"]:visible').first()
  const showSidebar = chatView.getByRole('button', { name: 'Show Sidebar', exact: true }).first()
  await expect(topics.or(showSidebar).first()).toBeVisible({ timeout: 20_000 })
  if (!(await topics.isVisible())) await showSidebar.click()
  await expect(topics).toBeVisible({ timeout: 20_000 })
  return topics
}

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

/** Polls until no dialog is mounted; returns false when the budget runs out. */
async function waitForDialogsGone(page: Page, timeout: number): Promise<boolean> {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if ((await page.getByRole('dialog').count()) === 0) return true
    await page.waitForTimeout(100)
  }
  return (await page.getByRole('dialog').count()) === 0
}

export async function dismissTransientDialogs(page: Page): Promise<void> {
  // Escape also closes popovers; repeated presses let nested dialogs finish their exit animations.
  await page.keyboard.press('Escape')
  for (let attempt = 0; attempt < 3; attempt++) {
    // A dialog that is merely animating out still counts as mounted, so wait for the count to
    // drop before deciding another attempt is needed.
    if (await waitForDialogsGone(page, 1_500)) return
    // Some dialogs (channel config, key setup) have no Escape handler — only their own close
    // button removes them, and one left open used to fail every later test on the same page.
    const close = page
      .getByRole('dialog')
      .getByRole('button', { name: /^(关闭|Close)$/ })
      .first()
    if (await close.isVisible().catch(() => false)) {
      await close.click({ timeout: 2_000 }).catch(() => undefined)
    } else {
      await page.keyboard.press('Escape')
    }
  }
  // Keep the original 10s budget: 3 attempts plus this tail, so a slow exit never fails a test.
  if (await waitForDialogsGone(page, 5_000)) return
  const leftover = page.getByRole('dialog')
  const count = await leftover.count()
  const names = await leftover.evaluateAll((nodes) =>
    nodes.map((node) => (node.getAttribute('aria-label') || node.textContent || '').trim().slice(0, 40))
  )
  // Fail with the offending dialog named: an anonymous "expected 0, received 1" hides the leak.
  throw new Error(`dialogs survived dismissal: ${count} still open (${names.join(' | ')})`)
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
