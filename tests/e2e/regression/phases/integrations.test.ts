import { join } from 'node:path'

import type { McpServerSchemas } from '@shared/data/api/schemas/mcpServers'
import { AssistantSchema } from '@shared/data/types/assistant'
import { createUniqueModelId } from '@shared/data/types/model'
import { TopicSchema } from '@shared/data/types/topic'
import type { IpcResult } from '@shared/ipc/errors/IpcError'

import { caseDefinition } from '../../../../scripts/e2e/regression/cases'
import { chooseNativeFile } from '../../../../scripts/e2e/regression/systemAutomation'
import type { Message } from '../../../../src/shared/data/types/message'
import { startMockChatServer } from '../../../helpers/http/mockChatServer'
import { expect, test } from '../fixture'
import { builtinAssistantAgent, startNewAgentTask } from '../helpers/agents'
import { sendChatMarker } from '../helpers/chat'
import { ensureCustomChatProvider, selectVisibleModel } from '../helpers/models'
import { dismissOnboarding, selectSidebarApp } from '../helpers/navigation'
import { closeSettings, openSettingsSection } from '../helpers/settings'
import { skillChatTrigger } from '../scenarios/skillChatTrigger'
import { toolSettings } from '../scenarios/toolSettings'

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

test(...caseDefinition('MCP-01'), async ({ app, mainWindow: page }, testInfo) => {
  await openSettingsSection(page, 'MCP')
  const servers = await page.evaluate(() =>
    window.api.dataApi.request({
      id: 'regression-mcp-servers',
      method: 'GET',
      path: '/mcp-servers',
      params: { limit: 200 }
    })
  )
  expect(servers.status).toBe(200)
  const existing = (servers.data as McpServerSchemas['/mcp-servers']['GET']['response']).items
  if (!existing.some(({ name }) => name === 'everything')) {
    await page.getByRole('button', { name: 'Add', exact: true }).click()
    await page.getByText('Quick Create', { exact: true }).click()
    await page.locator('input[name="name"]').fill('everything')
    await page.getByLabel('Command*').fill('npx')
    await page.getByLabel('Arguments').last().fill('-y\n@modelcontextprotocol/server-everything@1.0.0')
    await page.getByRole('button', { name: 'Add', exact: true }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
  }
  await page.locator('[data-ui~="settings.content"]:visible').getByText('everything', { exact: true }).first().click()
  const enabled = page.getByRole('switch').first()
  if ((await enabled.getAttribute('aria-checked')) !== 'true') await enabled.click()
  await expect(page.getByText('Connected', { exact: true })).toBeVisible({ timeout: 2 * 60_000 })
  await page.getByRole('radio', { name: /Tools/ }).click()
  await expect(page.getByText('get-sum', { exact: true })).toBeVisible()
  await expect(page.getByText('echo', { exact: true })).toBeVisible()
  await closeSettings(page)

  const originalNaming = await page.evaluate(() => window.api.preference.get('topic.naming.enabled'))
  const model = await startMockChatServer()
  const providerId = `mcp01-${Date.now()}`
  const assistantName = app.resourceName(`Everything assistant ${Date.now()}`)
  let assistantId: string | undefined
  testInfo.annotations.push({
    type: 'data-source',
    description:
      'Scripted loopback model requests a real Everything MCP get-sum execution; real UI binding, tool result persistence and restart. Does not validate external model quality.'
  })
  try {
    const topicName = app.resourceName(`Everything sum ${Date.now()}`)
    const setup = await page.evaluate(
      async ({ providerId, modelId, baseUrl, assistantName, topicName, uniqueModelId }) => {
        await window.api.preference.set('topic.naming.enabled', false)
        const provider = await window.api.dataApi.request({
          id: 'mcp01-provider',
          method: 'POST',
          path: '/providers',
          body: {
            providerId,
            name: 'Everything scripted model',
            defaultChatEndpoint: 'openai-chat-completions',
            endpointConfigs: { 'openai-chat-completions': { baseUrl } },
            apiKeys: [{ id: 'mock', key: 'mock-api-key', isEnabled: true }]
          }
        })
        const enabled = await window.api.dataApi.request({
          id: 'mcp01-enable',
          method: 'PATCH',
          path: `/providers/${providerId}`,
          body: { isEnabled: true }
        })
        const models = await window.api.dataApi.request({
          id: 'mcp01-model',
          method: 'POST',
          path: '/models',
          body: [
            {
              providerId,
              modelId,
              endpointTypes: ['openai-chat-completions'],
              capabilities: ['function-call'],
              contextWindow: 128000
            }
          ]
        })
        const assistant = await window.api.dataApi.request({
          id: 'mcp01-assistant',
          method: 'POST',
          path: '/assistants',
          body: { name: assistantName, modelId: uniqueModelId }
        })
        const topic = await window.api.dataApi.request({
          id: 'mcp01-topic',
          method: 'POST',
          path: '/topics',
          body: { name: topicName, assistantId: (assistant.data as { id: string }).id }
        })
        return { provider, enabled, models, assistant, topic }
      },
      {
        providerId,
        modelId: model.modelId,
        baseUrl: model.baseUrl,
        assistantName,
        topicName,
        uniqueModelId: createUniqueModelId(providerId, model.modelId)
      }
    )
    expect(setup.provider.status).toBe(201)
    expect(setup.enabled.status).toBe(200)
    expect(setup.models.status).toBe(201)
    expect(setup.assistant.status).toBe(201)
    assistantId = AssistantSchema.parse(setup.assistant.data).id
    expect(setup.topic.status).toBe(201)
    TopicSchema.parse(setup.topic.data)
    await page.reload()
    await selectSidebarApp(page, 'Chat')
    const chat = page.locator('[data-ui~="chat.view"]:visible')
    const group = chat.locator('[data-ui~="chat.group-header"]').filter({ hasText: assistantName }).first()
    await group.hover()
    const expand = group.getByRole('button', { name: 'Expand', exact: true })
    if (await expand.isVisible()) await expand.click()
    await chat.getByTestId('topic-list-row').filter({ hasText: topicName }).click()
    await page.getByRole('button', { name: `Edit Assistant: ${assistantName}`, exact: true }).click()
    await page.getByRole('tab', { name: 'MCP', exact: true }).click()
    await page.getByRole('radio', { name: 'Manual', exact: true }).click()
    await page.getByRole('switch', { name: 'everything', exact: true }).setChecked(true)
    await page.getByRole('button', { name: 'Close', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Selected models', exact: true })).toContainText(model.modelId)
    const [messageId] = await Promise.all([
      sendChatMarker(
        page,
        'Call the everything MCP server get-sum tool with a=31415 and b=27182, then report its result.',
        '58597',
        false
      ),
      (async () => {
        const request = await model.nextRequest()
        const tools = (request.body as { tools?: { function: { name: string } }[] }).tools ?? []
        const sum = tools.find(({ function: fn }) => /^mcp__.*__getSum(?:_|$)/.test(fn.name))
        expect(
          tools.map((tool) => tool.function.name),
          'The real Everything sum tool must be offered to the model'
        ).toEqual(expect.arrayContaining([expect.stringMatching(/^mcp__.*__getSum(?:_|$)/)]))
        request.completeToolCall({ id: 'everything-sum', name: sum!.function.name, arguments: { a: 31415, b: 27182 } })
        const followup = await model.nextRequest(30_000)
        expect(followup.body.messages.at(-1)).toMatchObject({
          role: 'tool',
          content: expect.stringMatching(/\b58597\b/)
        })
        followup.complete('58597')
      })()
    ])
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
    await page.locator('[data-ui~="settings.content"]:visible').getByText('everything', { exact: true }).first().click()
    const restartedEnabled = page.getByRole('switch').first()
    if ((await restartedEnabled.getAttribute('aria-checked')) !== 'true') await restartedEnabled.click()
    await expect(page.getByText('Connected', { exact: true })).toBeVisible({ timeout: 2 * 60_000 })
  } finally {
    await model.close()
    const restored = await page.evaluate(
      async ({ providerId, assistantId, originalNaming }) => {
        await window.api.preference.set('topic.naming.enabled', originalNaming)
        if (assistantId) {
          const removed = (await window.api.ipcApi.request('trash.assistant.delete_permanently', {
            assistantId,
            deleteTopics: true
          })) as IpcResult<{ deleted: boolean }>
          if (!removed.ok || !removed.data.deleted) throw new Error('MCP cleanup left its assistant in the trash')
        }
        return window.api.dataApi.request({
          id: 'mcp01-remove-provider',
          method: 'DELETE',
          path: `/providers/${providerId}`
        })
      },
      { providerId, assistantId, originalNaming }
    )
    expect(restored.status).toBe(204)
  }
})

test(...caseDefinition('A-02'), async ({ app, mainWindow: page }) => {
  const providerId = await ensureCustomChatProvider(app, page)
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
  const assistant = await builtinAssistantAgent(page)
  await startNewAgentTask(page, assistant.name)
  const agentView = page.locator('[data-ui~="agent.view"]:visible')
  await agentView
    .getByRole('button', { name: 'Select Model', exact: true })
    .or(agentView.locator('button:has(span[title*=" | "])'))
    .first()
    .click()
  await selectVisibleModel(page, app.config.customProvider.chatModel, providerId)
  await openSkillsPanel(page)
  await page.getByText('Manage skills', { exact: true }).click()
  const skillSwitch = page.getByRole('switch', { name: 'cherry-regression-fixture', exact: true })
  if ((await skillSwitch.getAttribute('aria-checked')) !== 'true') await skillSwitch.click()
  await page.getByRole('button', { name: 'Close', exact: true }).click()

  const composer = page.locator('[data-ui~="chat.composer"]:visible [contenteditable="true"]').first()
  await composer.fill('')
  await openSkillsPanel(page)
  await composer.pressSequentially('cherry-regression-fixture')
  await page.getByTestId('quick-panel').getByText('cherry-regression-fixture', { exact: true }).click()
  await expect(composer.locator('[data-composer-token-kind="skill"]')).toHaveCount(1)
  await composer.press('End')
  await composer.pressSequentially(
    ' Using the selected local skill reference, quote the Validation label field from its fixture catalog.'
  )
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

test(...caseDefinition('MP-139'), async ({ app, mainWindow: page }, testInfo) => {
  await toolSettings(app, page, testInfo)
})

test(...caseDefinition('MP-138'), async ({ app, mainWindow: page }, testInfo) => {
  await skillChatTrigger(app, page, testInfo)
})
