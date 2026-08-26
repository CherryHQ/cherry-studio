import { join } from 'node:path'

import { expect, test } from './fixture'
import { CUSTOM_ASSISTANT, ensureCustomAssistant } from './assistants'
import { dismissOnboarding, selectSidebarApp } from './helpers'
import { closeSettings, ensureCustomChatProvider, openSettingsSection } from './models'
import { chooseNativeFile } from '../../../scripts/cherry-regression-test/system-automation'

async function openSkillsPanel(page: Parameters<typeof selectSidebarApp>[0]): Promise<void> {
  const direct = page.getByRole('button', { name: 'Skills', exact: true })
  if (await direct.isVisible().catch(() => false)) {
    await direct.click()
    return
  }
  await page
    .locator('[data-ui="chat.composer"]')
    .getByRole('button', { name: 'Input Quick Panel', exact: true })
    .click()
  await page.getByTestId('quick-panel').getByText('Skills', { exact: true }).click()
}

test('[MCP-01] 创建并使用 Everything MCP @everything-mcp', async ({ app, mainWindow: page }) => {
  await openSettingsSection(page, 'MCP')
  if (
    !(await page
      .getByText('everything', { exact: true })
      .isVisible()
      .catch(() => false))
  ) {
    await page.getByRole('button', { name: 'Add', exact: true }).click()
    await page.getByText('Quick Create', { exact: true }).click()
    await page.getByPlaceholder('Name').fill('everything')
    await page.getByLabel('Command*').fill('npx')
    await page.getByLabel('Arguments').last().fill('-y\n@modelcontextprotocol/server-everything')
    await page.getByRole('button', { name: 'Add', exact: true }).click()
  }
  await page
    .getByText(/everything STDIO|everything/, { exact: true })
    .first()
    .click()
  const enabled = page.getByRole('switch').first()
  if ((await enabled.getAttribute('aria-checked')) !== 'true') await enabled.click()
  await expect(page.getByText('Connected', { exact: true })).toBeVisible({ timeout: 2 * 60_000 })
  await page.getByRole('radio', { name: /Tools/ }).click()
  await expect(page.getByText('get-sum', { exact: true })).toBeVisible()
  await expect(page.getByText('echo', { exact: true })).toBeVisible()
  await closeSettings(page)

  await ensureCustomAssistant(app, page)
  await page.getByRole('button', { name: `Edit Assistant: ${CUSTOM_ASSISTANT}`, exact: true }).click()
  await page.getByRole('tab', { name: 'MCP', exact: true }).click()
  await page.getByRole('radio', { name: 'Manual', exact: true }).click()
  const server = page.getByRole('switch', { name: 'everything', exact: true })
  if ((await server.getAttribute('aria-checked')) !== 'true') await server.click()
  await page.getByRole('button', { name: 'Close', exact: true }).click()

  await page
    .locator('[data-ui="chat.composer"] [contenteditable="true"]')
    .first()
    .fill('You must call get-sum with a=31415 and b=27182, then reply with exactly 58597.')
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await expect(page.locator('body')).toContainText('31415', { timeout: 2 * 60_000 })
  await expect(page.locator('body')).toContainText('27182')
  await expect(page.locator('[data-ui="chat.message"]:visible').last()).toContainText('58597')

  page = await app.restart('authenticated')
  await dismissOnboarding(page)
  await openSettingsSection(page, 'MCP')
  await page
    .getByText(/everything STDIO|everything/, { exact: true })
    .first()
    .click()
  const restartedEnabled = page.getByRole('switch').first()
  if ((await restartedEnabled.getAttribute('aria-checked')) !== 'true') await restartedEnabled.click()
  await expect(page.getByText('Connected', { exact: true })).toBeVisible({ timeout: 2 * 60_000 })
})

test('[A-02] 从文件夹导入 Skill 并验证生效 @skill-import', async ({ app, mainWindow: page }) => {
  await ensureCustomChatProvider(app, page)
  await openSettingsSection(page, 'Skills')
  if (
    !(await page
      .getByText('cherry-regression-fixture', { exact: true })
      .isVisible()
      .catch(() => false))
  ) {
    await page.getByRole('button', { name: 'Add Skill', exact: true }).click()
    await page.getByText('Local import', { exact: true }).click()
    await page.getByRole('button', { name: 'Install from directory', exact: true }).click()
    await page.waitForTimeout(1_000)
    chooseNativeFile(app.record.platform, app.paths, join(app.paths.fixtures, 'cherry-regression-fixture'))
    await expect(page.getByText('cherry-regression-fixture', { exact: true })).toBeVisible({ timeout: 60_000 })
  }

  page = await app.restart('authenticated')
  await dismissOnboarding(page)
  await selectSidebarApp(page, 'Work')
  await page.getByText('Cherry Assistant', { exact: true }).first().click()
  const model = page.getByRole('button', { name: /Select Model|Selected models/ }).first()
  if (await model.isVisible().catch(() => false)) {
    await model.click()
    await page.getByTestId('model-selector-search').fill(app.config.customProvider.chatModel)
    await page.getByRole('option').filter({ hasText: app.config.customProvider.chatModel }).first().click()
  }
  const newTask = page.locator('[data-ui="chat.composer"] button').filter({ hasText: 'New task' })
  if (await newTask.isVisible().catch(() => false)) await newTask.click()
  await openSkillsPanel(page)
  await page.getByText('Manage skills', { exact: true }).click()
  const skillSwitch = page.getByRole('switch', { name: 'cherry-regression-fixture', exact: true })
  if ((await skillSwitch.getAttribute('aria-checked')) !== 'true') await skillSwitch.click()
  await page.getByRole('button', { name: 'Close', exact: true }).click()

  const composer = page.locator('[data-ui="chat.composer"] [contenteditable="true"]').first()
  await composer.fill('What is the Cherry regression marker? Reply exactly as the selected local skill requires.')
  await openSkillsPanel(page)
  await page.getByText('cherry-regression-fixture', { exact: true }).click()
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await expect(page.getByText('SKILL_IMPORT_PASS', { exact: true }).last()).toBeVisible({ timeout: 2 * 60_000 })
})
