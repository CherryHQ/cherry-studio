import { join } from 'node:path'

import { caseDefinition } from '../../../scripts/e2e/regression/cases'
import { chooseNativeFile } from '../../../scripts/e2e/regression/systemAutomation'
import type { Message } from '../../../src/shared/data/types/message'
import { startNewAgentTask } from './agents'
import { customAssistantName, ensureCustomAssistant } from './assistants'
import { sendChatMarker } from './chat'
import { expect, test } from './fixture'
import { ensureCustomChatProvider, selectVisibleModel } from './models'
import { dismissOnboarding, selectSidebarApp } from './navigation'
import { closeSettings, openSettingsSection } from './settings'

async function openSkillsPanel(page: Parameters<typeof selectSidebarApp>[0]): Promise<void> {
  const direct = page.locator('[data-ui~="chat.composer"]:visible').getByRole('button', { name: 'Skills', exact: true })
  await expect(direct).toBeVisible({ timeout: 30_000 })
  const manageSkills = page.getByText('Manage skills', { exact: true })
  await expect
    .poll(
      async () => {
        if (await manageSkills.isVisible().catch(() => false)) return true
        await direct.click()
        return manageSkills
          .waitFor({ state: 'visible', timeout: 2_000 })
          .then(() => true)
          .catch(() => false)
      },
      { timeout: 10_000 }
    )
    .toBe(true)
}

test(...caseDefinition('MCP-01'), async ({ app, mainWindow: page }) => {
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
  await page.getByRole('button', { name: `Edit Assistant: ${customAssistantName(app)}`, exact: true }).click()
  await page.getByRole('tab', { name: 'MCP', exact: true }).click()
  await page.getByRole('radio', { name: 'Manual', exact: true }).click()
  const server = page.getByRole('switch', { name: 'everything', exact: true })
  if ((await server.getAttribute('aria-checked')) !== 'true') await server.click()
  await page.getByRole('button', { name: 'Close', exact: true }).click()

  const messageId = await sendChatMarker(
    page,
    'Call the everything MCP server get-sum tool with a=31415 and b=27182, then report its result.',
    '58597',
    false
  )
  await expect
    .poll(
      () =>
        page.evaluate(async (id) => {
          const response = await window.api.dataApi.request({
            id: `regression-mcp-result-${Date.now()}`,
            method: 'GET',
            path: `/messages/${id}`
          })
          const message = response.data as Message | undefined
          if (message?.role !== 'assistant' || message.status !== 'success') return false
          return (
            message.data.parts?.some((part) => {
              if (!(part.type === 'dynamic-tool' || part.type.startsWith('tool-'))) return false
              if (!('state' in part) || part.state !== 'output-available') return false
              const input = part.input as { a?: number; b?: number } | undefined
              const output = part.output as
                | {
                    isError?: boolean
                    metadata?: { type?: string; name?: string; serverName?: string }
                    content?: { type: string; text?: string }[]
                  }
                | undefined
              return (
                input?.a === 31415 &&
                input.b === 27182 &&
                output?.isError !== true &&
                output?.metadata?.type === 'mcp' &&
                output.metadata.name === 'get-sum' &&
                output.metadata.serverName === 'everything' &&
                output.content?.some((item) => item.type === 'text' && /\b58597\b/.test(item.text ?? ''))
              )
            }) ?? false
          )
        }, messageId),
      { timeout: 30_000, message: 'This response must contain a successful everything/get-sum execution' }
    )
    .toBe(true)

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

test(...caseDefinition('A-02'), async ({ app, mainWindow: page }) => {
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
  await openSettingsSection(page, 'API Gateway')
  const startGateway = page.getByRole('button', { name: 'Start', exact: true })
  const stopGateway = page.getByRole('button', { name: 'Stop', exact: true })
  await expect(startGateway.or(stopGateway)).toBeVisible()
  if (await startGateway.isVisible()) await startGateway.click()
  await expect(stopGateway).toBeVisible({ timeout: 30_000 })
  await closeSettings(page)
  await startNewAgentTask(page, 'Cherry Assistant')
  const agentView = page.locator('[data-ui~="agent.view"]:visible')
  await agentView
    .getByRole('button', { name: 'Select Model', exact: true })
    .or(agentView.locator('button:has(span[title*=" | "])'))
    .first()
    .click()
  await selectVisibleModel(page, app.config.customProvider.chatModel)
  await openSkillsPanel(page)
  await page.getByText('Manage skills', { exact: true }).click()
  const skillSwitch = page.getByRole('switch', { name: 'cherry-regression-fixture', exact: true })
  if ((await skillSwitch.getAttribute('aria-checked')) !== 'true') await skillSwitch.click()
  await page.getByRole('button', { name: 'Close', exact: true }).click()

  const composer = page.locator('[data-ui~="chat.composer"]:visible [contenteditable="true"]').first()
  await composer.fill(
    'Using the selected local skill reference, quote the Validation label field from its fixture catalog.'
  )
  await openSkillsPanel(page)
  await page.getByText('cherry-regression-fixture', { exact: true }).click()
  await expect(composer.locator('[data-composer-token-kind="skill"]')).toHaveCount(1)
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  const response = agentView
    .locator('[data-ui~="chat.message"]')
    .filter({ has: page.locator('.message-assistant') })
    .last()
  const answer = response
    .getByText('SKILL_IMPORT_PASS')
    .and(response.locator(':not([data-ui~="part:message-reasoning"] *)'))
    .last()
  await expect(answer).toBeVisible({ timeout: 5 * 60_000 })
  await expect(response.getByTestId('completed-process-trigger')).toBeVisible()
})
