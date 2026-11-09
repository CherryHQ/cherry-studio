import { once } from 'node:events'
import { mkdirSync, realpathSync } from 'node:fs'
import { createServer, type AddressInfo } from 'node:net'
import { join } from 'node:path'

import type { Locator, Page } from '@playwright/test'

import type { IpcResult } from '@shared/ipc/errors/IpcError'
import type { OutputFor } from '@shared/ipc/types'

import { caseDefinition } from '../../../../scripts/e2e/regression/cases'
import { observeExternalResource, registerExternalResource } from '../../../../scripts/e2e/regression/externalResources'
import { chooseNativeFile } from '../../../../scripts/e2e/regression/systemAutomation'
import { expect, test } from '../fixture'
import { CUSTOM_CHAT_PROVIDER, ensureCustomChatProvider } from '../helpers/models'
import { openLaunchpadApp } from '../helpers/navigation'
import { closeSettings } from '../helpers/settings'
import type { RegressionApp } from '../RegressionApp'

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
  await providerCard.hover()
  const disable = providerCard.getByRole('button', { name: 'Disable', exact: true })
  if (await disable.isVisible()) await disable.click()
  const enable = providerCard.getByRole('button', { name: 'Enable', exact: true }).first()
  await enable.click()
}

async function launchWithWorkspace(app: RegressionApp, page: Page): Promise<void> {
  const workspace =
    app.record.platform === 'windows' ? join(app.paths.workspace, 'code tools {literal}') : app.paths.workspace
  mkdirSync(workspace, { recursive: true })
  await page.getByRole('button', { name: 'Launch', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Select Folder', exact: true }).click()
  chooseNativeFile(app.record.platform, app.paths, workspace)
  await expect
    .poll(async () =>
      realpathSync(await dialog.getByPlaceholder('Select working directory', { exact: true }).inputValue())
    )
    .toBe(realpathSync(workspace))
  if (app.record.platform === 'windows') {
    await dialog.getByRole('combobox').click()
    await page.getByRole('option', { name: 'Command Prompt', exact: true }).click()
  }
  const resource = registerExternalResource(app.paths, app.record.platform, { kind: 'terminal', directory: workspace })
  await dialog.getByRole('button', { name: 'Launch', exact: true }).click()
  await expect.poll(() => observeExternalResource(app.paths, resource), { timeout: 30_000 }).toBe(true)
}

test(...caseDefinition('CODE-01'), async ({ app, mainWindow: page }) => {
  await ensureCustomChatProvider(app, page)
  await closeSettings(page)
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
})

test(...caseDefinition('CODE-03'), async ({ app, mainWindow: page }) => {
  test.setTimeout(3 * 60_000)
  const previousPort = await page.evaluate(() => window.api.preference.get('feature.openclaw.gateway_port'))
  const reservation = createServer().listen(0, '127.0.0.1')
  await once(reservation, 'listening')
  const port = (reservation.address() as AddressInfo).port
  await new Promise<void>((resolve, reject) => reservation.close((error) => (error ? reject(error) : resolve())))
  const dashboardTab = page.locator('[data-ui~="app.tab-bar"]').getByRole('button', { name: 'OpenClaw', exact: true })
  const gatewayStatus = () =>
    page.evaluate(async () => {
      const result = (await window.api.ipcApi.request('openclaw.get_status')) as IpcResult<
        OutputFor<'openclaw.get_status'>
      >
      if (!result.ok) throw new Error(result.error.message)
      return result.data.status
    })
  try {
    await page.evaluate((port) => window.api.preference.set('feature.openclaw.gateway_port', port), port)
    await ensureCustomChatProvider(app, page)
    await closeSettings(page)
    await openCodeTool(page, 'OpenClaw')
    await configureTool(page, app.config.customProvider.chatModel, CUSTOM_CHAT_PROVIDER)
    const codeView = page.locator('[data-ui~="code.view"]:visible').first()
    await codeView.getByRole('button', { name: 'Launch', exact: true }).click()
    // The CLI also spawns config probes; only the running gateway and opened dashboard complete launch.
    await expect.poll(gatewayStatus, { timeout: 2 * 60_000 }).toBe('running')
    await expect(dashboardTab).toHaveAttribute('data-active', 'true')
    const guest = page.locator('webview[data-mini-app-id="openclaw-dashboard"]:visible')
    await expect(guest).toBeVisible()
    await expect
      .poll(() =>
        guest.evaluate((element) => {
          const url = (element as unknown as { getURL(): string }).getURL()
          return url ? new URL(url).origin : ''
        })
      )
      .toBe(`http://127.0.0.1:${port}`)
    await dashboardTab.getByRole('button', { name: 'Close Tab', exact: true }).click()
    await expect(dashboardTab).toHaveCount(0)
    await openCodeTool(page, 'OpenClaw')
    await codeView.getByRole('button', { name: 'Stop', exact: true }).click()
    await expect.poll(gatewayStatus).toBe('stopped')
  } finally {
    try {
      const stopped = (await page.evaluate(() => window.api.ipcApi.request('openclaw.stop_gateway'))) as IpcResult<
        OutputFor<'openclaw.stop_gateway'>
      >
      expect(stopped.ok && stopped.data.success, 'Owned OpenClaw gateway must stop').toBe(true)
      if (await dashboardTab.isVisible())
        await dashboardTab.getByRole('button', { name: 'Close Tab', exact: true }).click()
    } finally {
      await page.evaluate((port) => window.api.preference.set('feature.openclaw.gateway_port', port), previousPort)
    }
  }
})
