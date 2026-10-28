import type { Locator, Page } from '@playwright/test'

import { caseDefinition } from '../../../../scripts/e2e/regression/cases'
import { listOwnedProcessIds, observeOwnedProcess } from '../../../../scripts/e2e/regression/processEvidence'
import { chooseNativeFile } from '../../../../scripts/e2e/regression/systemAutomation'
import { expect, test } from '../fixture'
import { CUSTOM_CHAT_PROVIDER, ensureCustomChatProvider } from '../helpers/models'
import { openLaunchpadApp } from '../helpers/navigation'
import { closeSettings } from '../helpers/settings'
import type { RegressionApp } from '../RegressionApp'
import { verifyCodeMatePermissions } from '../scenarios/codeMatePermissions'

async function openCodeTool(page: Page, name: string): Promise<void> {
  await openLaunchpadApp(page, 'Code Mate')
  await page
    .locator('[data-ui~="code.view"]:visible')
    .getByRole('button', { name: new RegExp(`^${name}(?:\\s|$)`) })
    .first()
    .click()
}

async function configureTool(page: Page, model: string, provider: string): Promise<void> {
  const codeView = page.locator('[data-ui~="code.view"]:visible').first()
  const providerCard: Locator = codeView
    .locator('[data-ui~="code.provider-card"]')
    .filter({ has: page.getByText(provider, { exact: true }) })
  await providerCard.scrollIntoViewIfNeeded()
  await providerCard.hover()
  const configure = providerCard.getByRole('button', { name: 'Configure', exact: true })
  await expect(configure).toBeVisible()
  await configure.click()
  const dialog = page.getByRole('dialog').last()
  await expect(dialog).toBeVisible()
  const selectModel = dialog.getByRole('button', { name: 'Model Selection', exact: true })
  await expect(selectModel).toBeVisible()
  await selectModel.click()
  const search = dialog.getByRole('textbox').last()
  if (await search.isVisible().catch(() => false)) await search.fill(model)
  await page.getByRole('option').filter({ hasText: model }).first().click()
  const save = dialog.getByRole('button', { name: 'Save', exact: true })
  await dialog.getByRole('button', { name: (await save.isEnabled()) ? 'Save' : 'Cancel', exact: true }).click()
  await expect(dialog).toBeHidden()
  const disable = providerCard.getByRole('button', { name: 'Disable', exact: true })
  if (await disable.isVisible()) await disable.click()
  const enable = providerCard.getByRole('button', { name: 'Enable', exact: true }).first()
  await enable.click()
}

async function launchWithWorkspace(app: RegressionApp, page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Launch', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Select Folder', exact: true }).click()
  await page.waitForTimeout(1_000)
  chooseNativeFile(app.record.platform, app.paths, app.paths.workspace)
  await expect(dialog.getByPlaceholder('Select working directory', { exact: true })).toHaveValue(app.paths.workspace)
  if (app.record.platform === 'windows') {
    await dialog.getByRole('combobox').click()
    await page.getByRole('option', { name: 'Command Prompt', exact: true }).click()
  }
  await dialog.getByRole('button', { name: 'Launch', exact: true }).click()
}

test(...caseDefinition('CODE-01'), async ({ app, mainWindow: page }) => {
  await ensureCustomChatProvider(app, page)
  await closeSettings(page)
  const baseline = new Set(listOwnedProcessIds(app.record))
  await openCodeTool(page, 'Claude Code')
  const codeView = page.locator('[data-ui~="code.view"]:visible').first()
  const install = codeView.getByRole('button', { name: 'Install', exact: true })
  const launch = codeView.getByRole('button', { name: 'Launch', exact: true })
  await expect(install.or(launch)).toBeVisible()
  if (await install.isVisible()) {
    await install.click()
    await expect(launch).toBeVisible({ timeout: 5 * 60_000 })
  }
  await configureTool(page, app.config.customProvider.chatModel, 'Unified Gateway')
  await launchWithWorkspace(app, page)
  await expect
    .poll(
      () =>
        observeOwnedProcess(
          app.record,
          'claude',
          true,
          baseline,
          app.record.platform === 'windows' ? 'claude.exe' : undefined
        ).passed,
      { timeout: 60_000 }
    )
    .toBe(true)
})

test(...caseDefinition('CODE-02'), async ({ app, mainWindow: page }) => {
  await ensureCustomChatProvider(app, page)
  await closeSettings(page)
  const baseline = new Set(listOwnedProcessIds(app.record))
  await openCodeTool(page, 'OpenAI Codex')
  await configureTool(page, app.config.customProvider.chatModel, 'Unified Gateway')
  await launchWithWorkspace(app, page)
  await expect
    .poll(() => observeOwnedProcess(app.record, 'codex', true, baseline).passed, { timeout: 60_000 })
    .toBe(true)
})

test(...caseDefinition('CODE-03'), async ({ app, mainWindow: page }) => {
  await ensureCustomChatProvider(app, page)
  await closeSettings(page)
  const baseline = new Set(listOwnedProcessIds(app.record))
  await openCodeTool(page, 'OpenClaw')
  await configureTool(page, app.config.customProvider.chatModel, CUSTOM_CHAT_PROVIDER)
  await page
    .locator('[data-ui~="code.view"]:visible')
    .first()
    .getByRole('button', { name: 'Launch', exact: true })
    .click()
  await expect
    .poll(() => observeOwnedProcess(app.record, 'openclaw', true, baseline).passed, { timeout: 2 * 60_000 })
    .toBe(true)
})

test(...caseDefinition('MP-97'), async ({ app, mainWindow: page }, testInfo) => {
  await verifyCodeMatePermissions(app, page, testInfo)
})
