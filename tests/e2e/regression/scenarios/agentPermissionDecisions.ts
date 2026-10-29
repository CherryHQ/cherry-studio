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

export async function agentPermissionDecisions(app: RegressionApp, page: Page, testInfo: TestInfo): Promise<void> {
  const screenshot = async (name: string) => {
    const path = testInfo.outputPath(`${name}.png`)
    await writeFile(path, await captureMaskedScreenshot(page, getSensitiveConfigValues()))
    await testInfo.attach(name, { path, contentType: 'image/png' })
  }
  await testInfo.attach('MP-51 model source', {
    body: 'Real configured custom provider; real Pi runtime and filesystem writes, no mocked permission decisions.',
    contentType: 'text/plain'
  })
  const providerId = await ensureCustomChatProvider(app, page)
  await closeSettings(page)
  await createAgent(page, {
    name: app.resourceName(`Permission decisions ${Date.now()}`),
    runtime: 'Pi',
    permission: 'Ask Before Acting',
    providerId,
    model: app.config.customProvider.chatModel
  })
  await page.evaluate(({ path, name }) => window.api.ipcApi.request('ai.agent.workspace.register', { path, name }), {
    path: app.paths.workspace,
    name: app.workspaceName
  })
  await selectAgentWorkspace(app, page)
  const output = join(app.paths.workspace, 'qa-permission.txt')
  const content = 'MP51_PERMISSION_ALLOWED'
  // The workspace is shared with every other case in this run directory, so the previous run of this
  // case can leave its own output behind. Clear it before asserting the pre-write state.
  await rm(output, { force: true })
  expect(existsSync(output), 'The workspace must not hold a stale case output before the write').toBe(false)
  const view = page.locator('[data-ui~="agent.view"]:visible').first()
  const composer = view.locator('[data-ui~="chat.composer"] [contenteditable="true"]').first()
  const preview = view.getByTestId('permission-preview')
  const messages = view.locator('[data-ui~="chat.message"]:visible')
  const pause = view.getByRole('button', { name: 'Pause', exact: true })
  const send = async () => {
    await composer.fill(
      `Use the Write tool exactly once to create ${JSON.stringify(output)} containing exactly ${content} with no trailing newline. Do not use any other tools. If permission is denied, stop without retrying and explain that the user denied the write. If allowed, report success only after the tool succeeds.`
    )
    await view.getByRole('button', { name: 'Send', exact: true }).click()
    await expect(preview).toBeVisible({ timeout: 90_000 })
    await expect(preview.locator('..')).toContainText('qa-permission.txt')
    await expect(preview).toContainText(content)
    expect(existsSync(output), 'The pending write must not execute before approval').toBe(false)
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
    await screenshot('MP-51 first write awaiting denial')
    await view.getByRole('button', { name: /^Deny/ }).click()
    await expect(preview).toBeHidden()
    await expect(pause).toBeHidden({ timeout: 90_000 })
    await expandProcess()
    await expect
      .soft(view.getByText('Denied', { exact: true }), 'The denied tool card must preserve the rejection decision')
      .toBeVisible({ timeout: 1_000 })
    const deniedReply = messages.last()
    await expect(deniedReply.locator('.markdown').last()).toContainText(/denied|rejected|拒绝/i)
    expect(existsSync(output), 'Denied write must leave no file after the turn finishes').toBe(false)
    await screenshot('MP-51 denied tool and absent file')

    await send()
    await screenshot('MP-51 second write awaiting approval')
    await view.getByRole('button', { name: /^Allow/ }).click()
    await expect(preview).toBeHidden()
    await expect.poll(() => existsSync(output), { timeout: 90_000 }).toBe(true)
    expect(await readFile(output, 'utf8')).toBe(content)
    await expect(pause).toBeHidden({ timeout: 90_000 })
    await expandProcess()
    const allowedReply = messages.last()
    await expect(allowedReply.getByText('Denied', { exact: true })).toHaveCount(0)
    await expect(allowedReply.getByRole('link', { name: 'qa-permission.txt', exact: true }).first()).toBeVisible()
    await expect(allowedReply.locator('.markdown').last()).toContainText(
      /created|wrote|written|success|创建|写入|成功/i
    )
    await screenshot('MP-51 allowed tool and verified file')
  } finally {
    if (await pause.isVisible().catch(() => false)) await pause.click()
    // Leave the shared workspace as this case found it so a repeated phase is reproducible.
    await rm(output, { force: true })
  }
}
