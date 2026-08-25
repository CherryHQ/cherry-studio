import type { Page } from '@playwright/test'

import type { RegressionApp } from './app'
import { expect, test } from './fixture'
import { openLaunchpadApp } from './helpers'
import { closeSettings, CUSTOM_CHAT_PROVIDER, ensureCustomChatProvider } from './models'
import { listOwnedProcessIds, observeOwnedProcess } from '../../../scripts/cherry-regression-test/process-evidence'
import { chooseNativeFile } from '../../../scripts/cherry-regression-test/system-automation'

async function openCodeTool(page: Page, name: string): Promise<void> {
  await openLaunchpadApp(page, 'Code Mate')
  await page.getByRole('button', { name, exact: true }).first().click()
}

async function configureTool(page: Page, model: string, provider?: string): Promise<void> {
  const configure = page.getByRole('button', { name: 'Configure', exact: true }).first()
  if (!(await configure.isVisible().catch(() => false))) return
  await configure.click()
  if (provider) {
    const providerOption = page.getByText(provider, { exact: true })
    if (await providerOption.isVisible().catch(() => false)) await providerOption.click()
  }
  const selectModel = page.getByRole('button', { name: 'Select a model', exact: true })
  if (await selectModel.isVisible().catch(() => false)) await selectModel.click()
  const search = page.getByRole('textbox').last()
  if (await search.isVisible().catch(() => false)) await search.fill(model)
  await page.getByRole('option').filter({ hasText: model }).first().click()
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  const enable = page.getByRole('button', { name: 'Enable', exact: true })
  if (await enable.isVisible().catch(() => false)) await enable.click()
}

async function launchWithWorkspace(app: RegressionApp, page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Launch', exact: true }).click()
  const selectFolder = page.getByText('Select Folder', { exact: true })
  if (await selectFolder.isVisible().catch(() => false)) {
    await selectFolder.click()
    chooseNativeFile(app.record.platform, app.paths, app.paths.workspace)
    await expect(page.getByRole('dialog')).toContainText('agent-workspace')
    await page.getByRole('dialog').getByRole('button', { name: 'Launch', exact: true }).click()
  }
}

test('[CODE-01] 启动 Claude Code @code-cli', async ({ app, mainWindow: page }) => {
  await ensureCustomChatProvider(app, page)
  await closeSettings(page)
  const baseline = new Set(listOwnedProcessIds(app.record))
  await openCodeTool(page, 'Claude Code')
  await configureTool(page, app.config.customProvider.chatModel, CUSTOM_CHAT_PROVIDER)
  await launchWithWorkspace(app, page)
  await expect
    .poll(() => observeOwnedProcess(app.record, 'claude', true, baseline).passed, { timeout: 60_000 })
    .toBe(true)
  expect(
    observeOwnedProcess(app.record, 'claude', true, baseline).matched.some(({ command }) =>
      command.includes(app.paths.workspace)
    )
  ).toBe(true)
})

test('[CODE-02] 启动 Codex @code-cli', async ({ app, mainWindow: page }) => {
  await ensureCustomChatProvider(app, page)
  await closeSettings(page)
  const baseline = new Set(listOwnedProcessIds(app.record))
  await openCodeTool(page, 'OpenAI Codex')
  await configureTool(page, app.config.customProvider.chatModel)
  await launchWithWorkspace(app, page)
  await expect
    .poll(() => observeOwnedProcess(app.record, 'codex', true, baseline).passed, { timeout: 60_000 })
    .toBe(true)
  expect(
    observeOwnedProcess(app.record, 'codex', true, baseline).matched.some(({ command }) =>
      command.includes(app.paths.workspace)
    )
  ).toBe(true)
})

test('[CODE-03] 启动 OpenClaw @openclaw', async ({ app, mainWindow: page }) => {
  await ensureCustomChatProvider(app, page)
  await closeSettings(page)
  const baseline = new Set(listOwnedProcessIds(app.record))
  await openCodeTool(page, 'OpenClaw')
  await configureTool(page, app.config.customProvider.chatModel, CUSTOM_CHAT_PROVIDER)
  await page.getByRole('button', { name: 'Launch', exact: true }).click()
  await expect
    .poll(() => observeOwnedProcess(app.record, 'openclaw', true, baseline).passed, { timeout: 2 * 60_000 })
    .toBe(true)
  await expect(page.getByRole('button', { name: 'Open Web UI', exact: true })).toBeVisible({ timeout: 2 * 60_000 })
  await page.getByRole('button', { name: 'Open Web UI', exact: true }).click()
  await expect(page.locator('body')).toContainText(/connected|dashboard/i, { timeout: 60_000 })

  await openLaunchpadApp(page, 'Code Mate')
  await page.getByRole('button', { name: 'OpenClaw', exact: true }).first().click()
  await page.getByRole('button', { name: 'Stop', exact: true }).click()
  await expect.poll(() => observeOwnedProcess(app.record, 'openclaw', false).passed, { timeout: 60_000 }).toBe(true)
})
