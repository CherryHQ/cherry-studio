import { existsSync } from 'node:fs'
import { readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { expect, type Page, type TestInfo } from '@playwright/test'

import { getSensitiveConfigValues } from '../../../../scripts/e2e/regression/config'
import { captureMaskedScreenshot } from '../../../../scripts/e2e/regression/screenshotEvidence'
import { createAgent, selectAgentWorkspace } from '../helpers/agents'
import { ensureCustomChatProvider } from '../helpers/models'
import { closeSettings } from '../helpers/settings'
import type { RegressionApp } from '../RegressionApp'

export async function agentGlobalInstallApproval(app: RegressionApp, page: Page, testInfo: TestInfo): Promise<void> {
  const screenshot = async (name: string) => {
    const path = testInfo.outputPath(`${name}.png`)
    await writeFile(path, await captureMaskedScreenshot(page, getSensitiveConfigValues()))
    await testInfo.attach(name, { path, contentType: 'image/png' })
  }
  await testInfo.attach('MP-153 model source', {
    body: 'Real configured provider; real Pi and Claude Agent runtimes and a real shell, no mocked permission decisions. No package is installed: npm install -g --help only displays help.',
    contentType: 'text/plain'
  })
  for (const runtime of ['Pi', 'Claude Agent'] as const) {
    const providerId = await ensureCustomChatProvider(app, page)
    await closeSettings(page)
    await createAgent(page, {
      name: app.resourceName(`Global install approval ${runtime} ${Date.now()}`),
      runtime,
      permission: 'Ask Before Acting',
      providerId,
      model: app.config.customProvider.chatModel
    })
    await page.evaluate(({ path, name }) => window.api.ipcApi.request('ai.agent.workspace.register', { path, name }), {
      path: app.paths.workspace,
      name: app.workspaceName
    })
    await selectAgentWorkspace(app, page)
    const slug = runtime === 'Pi' ? 'pi' : 'claude'
    const sentinel = join(app.paths.workspace, `qa-global-install-${slug}.txt`)
    const content = 'MP60_GLOBAL_INSTALL_EXECUTED'
    const command = `printf '%s' '${content}' > '${sentinel}'; npm install -g --help`
    const prompt = `Use the Bash tool exactly once to run this exact command: \`${command}\`. Do not use any other tools or split or change the command. If permission is denied, stop without retrying and explain that the user denied the command. If allowed, report success only after the tool succeeds.`
    const view = page.locator('[data-ui~="agent.view"]:visible').first()
    const composer = view.locator('[data-ui~="chat.composer"] [contenteditable="true"]').first()
    const preview = view.getByTestId('permission-preview')
    const messages = view.locator('[data-ui~="chat.message"]:visible')
    const pause = view.getByRole('button', { name: 'Pause', exact: true })
    const send = async () => {
      await rm(sentinel, { force: true })
      expect(existsSync(sentinel), 'The workspace must not hold a stale sentinel before the command').toBe(false)
      await composer.fill(prompt)
      await view.getByRole('button', { name: 'Send', exact: true }).click()
      await expect(preview).toBeVisible({ timeout: 120_000 })
      await expect(preview).toContainText(sentinel)
      await expect(preview).toContainText('npm install -g --help')
      expect(existsSync(sentinel), 'The pending command must not execute before approval').toBe(false)
    }
    const expandProcess = async () => {
      const process = messages.last().getByTestId('completed-process-trigger')
      await expect(process).toBeVisible({ timeout: 90_000 })
      if ((await process.getAttribute('aria-expanded')) !== 'true') await process.click()
      const tools = messages.last().getByTestId('child-tool-group').getByRole('button').first()
      await expect(tools).toBeVisible()
      if ((await tools.getAttribute('aria-expanded')) !== 'true') await tools.click()
    }
    try {
      await send()
      await screenshot(`MP-153 ${runtime} install awaiting denial`)
      await view.getByRole('button', { name: /^Deny/ }).click()
      await expect(preview).toBeHidden()
      await expect(pause).toBeHidden({ timeout: 120_000 })
      await expandProcess()
      await expect
        .soft(view.getByText('Denied', { exact: true }), 'The denied tool card must preserve the rejection decision')
        .toBeVisible({ timeout: 1_000 })
      expect(existsSync(sentinel), 'Denied command must leave no sentinel after the turn finishes').toBe(false)
      await screenshot(`MP-153 ${runtime} install denied and absent`)

      await send()
      await view.getByRole('button', { name: /^Allow/ }).click()
      await expect(preview).toBeHidden()
      await expect.poll(() => existsSync(sentinel), { timeout: 120_000 }).toBe(true)
      expect(await readFile(sentinel, 'utf8')).toBe(content)
      await expect(pause).toBeHidden({ timeout: 120_000 })
      await screenshot(`MP-153 ${runtime} install allowed and executed`)
    } finally {
      if (await pause.isVisible().catch(() => false)) await pause.click()
      await rm(sentinel, { force: true })
    }
  }
}
