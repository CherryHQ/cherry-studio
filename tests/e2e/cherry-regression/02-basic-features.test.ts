import { expect, test } from './fixture'
import { dismissOnboarding, openLaunchpad, openLaunchpadApp, selectSidebarApp } from './helpers'

test('[APP-01] 打开小程序 @mini-app', async ({ mainWindow: page }) => {
  await dismissOnboarding(page)

  await openLaunchpadApp(page, 'MiniApp')
  await expect(page.getByRole('button', { name: 'ChatGPT', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'ChatGPT', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Go Back', exact: true })).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole('button', { name: 'Refresh', exact: true })).toBeVisible()

  await selectSidebarApp(page, 'Chat')
  await page.getByRole('button', { name: 'Apps', exact: true }).click()
  await page.getByRole('button', { name: 'ChatGPT', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Refresh', exact: true })).toBeVisible({ timeout: 30_000 })
})

test('[N-01] 创建和保存笔记 @notes', async ({ app, mainWindow }) => {
  let page = mainWindow
  await openLaunchpadApp(page, 'Notes')

  const notesView = page.locator('[data-ui="notes.view"]')
  await expect(notesView).toBeVisible()
  const existing = page.getByText('Cherry Regression Note 31415', { exact: true })
  if (!(await existing.isVisible().catch(() => false))) {
    await page.locator('[data-ui="notes.navigation"] div:has(> svg.lucide-file-plus-2)').click()
    const title = notesView.locator('input')
    await title.fill('Cherry Regression Note 31415')
    await title.press('Enter')
    await page.locator('[data-ui="notes.editor"] [contenteditable="true"]').fill('NOTE_AUTOSAVE_PASS_27182')
    await expect(page.locator('[data-ui="notes.editor"]').first()).toContainText('NOTE_AUTOSAVE_PASS_27182')
  }

  await selectSidebarApp(page, 'Chat')
  await openLaunchpad(page)
  await page.locator('button').filter({ hasText: 'Notes' }).last().click()
  await page.getByText('Cherry Regression Note 31415', { exact: true }).click()
  await expect(page.locator('[data-ui="notes.view"]')).toContainText('NOTE_AUTOSAVE_PASS_27182')

  page = await app.restart('authenticated')
  await dismissOnboarding(page)
  const notesTab = page.getByRole('button', { name: 'Notes', exact: true })
  if (await notesTab.isVisible().catch(() => false)) await notesTab.click()
  else await openLaunchpadApp(page, 'Notes')
  await page.getByText('Cherry Regression Note 31415', { exact: true }).click()
  await expect(page.locator('[data-ui="notes.view"]')).toContainText('NOTE_AUTOSAVE_PASS_27182')
})
