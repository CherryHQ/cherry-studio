import type { Locator, Page } from '@playwright/test'

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
  const codeView = page.locator('[data-ui="code.view"]:visible').first()
  let configure = codeView.getByRole('button', { name: 'Configure', exact: true }).first()
  let providerCard: Locator | undefined
  if (provider) {
    const providerName = codeView.getByText(provider, { exact: true }).first()
    providerCard = providerName.locator(
      'xpath=ancestor::div[contains(@class, "group") and .//button[normalize-space()="Configure"]][1]'
    )
    await providerCard.scrollIntoViewIfNeeded()
    await providerCard.hover()
    configure = providerCard.getByRole('button', { name: 'Configure', exact: true })
    await expect(configure).toBeVisible()
  }
  if (!(await configure.isVisible().catch(() => false))) return
  await configure.click()
  const dialog = page.getByRole('dialog').last()
  await expect(dialog).toBeVisible()
  const selectModel = dialog.getByRole('button', { name: 'Select a model', exact: true })
  if (await selectModel.isVisible().catch(() => false)) await selectModel.click()
  const search = dialog.getByRole('textbox').last()
  if (await search.isVisible().catch(() => false)) await search.fill(model)
  await page.getByRole('option').filter({ hasText: model }).first().click()
  await dialog.getByRole('button', { name: 'Save', exact: true }).click()
  const enable = (providerCard ?? codeView).getByRole('button', { name: 'Enable', exact: true }).first()
  if (await enable.isVisible().catch(() => false)) await enable.click()
}

async function launchWithWorkspace(app: RegressionApp, page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Launch', exact: true }).click()
  const selectFolder = page.getByText('Select Folder', { exact: true })
  if (await selectFolder.isVisible().catch(() => false)) {
    await selectFolder.click()
    await page.waitForTimeout(1_000)
    chooseNativeFile(app.record.platform, app.paths, app.paths.workspace)
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByRole('textbox', { name: 'Select working directory', exact: true })).toHaveValue(
      app.paths.workspace
    )
    await dialog.getByRole('button', { name: 'Launch', exact: true }).click()
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
})

test('[CODE-03] 启动 OpenClaw @openclaw', async ({ app, mainWindow: page }) => {
  await ensureCustomChatProvider(app, page)
  await closeSettings(page)
  const baseline = new Set(listOwnedProcessIds(app.record))
  await openCodeTool(page, 'OpenClaw')
  await configureTool(page, app.config.customProvider.chatModel, CUSTOM_CHAT_PROVIDER)
  await page
    .locator('[data-ui="code.view"]:visible')
    .first()
    .getByRole('button', { name: 'Launch', exact: true })
    .click()
  await expect
    .poll(() => observeOwnedProcess(app.record, 'openclaw', true, baseline).passed, { timeout: 2 * 60_000 })
    .toBe(true)
})
