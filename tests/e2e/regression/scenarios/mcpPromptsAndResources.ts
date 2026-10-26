import { randomUUID } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { expect, type Page, type TestInfo } from '@playwright/test'

import { AssistantSchema, DEFAULT_ASSISTANT_SETTINGS } from '@shared/data/types/assistant'
import { McpServerSchema } from '@shared/data/types/mcpServer'
import { type BranchMessagesResponse, MessageSchema } from '@shared/data/types/message'
import { createUniqueModelId } from '@shared/data/types/model'
import { TopicSchema } from '@shared/data/types/topic'

import { getSensitiveConfigValues } from '../../../../scripts/e2e/regression/config'
import { captureMaskedScreenshot } from '../../../../scripts/e2e/regression/screenshotEvidence'
import { selectSidebarApp } from '../helpers/navigation'
import type { RegressionApp } from '../RegressionApp'

export async function mcpPromptsAndResources(app: RegressionApp, page: Page, testInfo: TestInfo): Promise<void> {
  const providerId = `mp36-${Date.now()}`
  const assistantName = app.resourceName('MCP catalog assistant')
  const topicName = app.resourceName('MCP catalog conversation')
  const value = `orchid-${randomUUID().slice(0, 8)}`
  const resourceCode = `IRIS-${randomUUID()}`
  const serverIds: string[] = []
  let assistantId: string | undefined
  const previousNaming = await page.evaluate(() => window.api.preference.get('topic.naming.enabled'))
  const screenshot = async (name: string) => {
    const path = testInfo.outputPath(`${name}.png`)
    await writeFile(path, await captureMaskedScreenshot(page, getSensitiveConfigValues()))
    await testInfo.attach(name, { path, contentType: 'image/png' })
  }

  try {
    await page.evaluate(() => window.api.preference.set('topic.naming.enabled', false))
    for (const empty of [false, true]) {
      const result = await page.evaluate(
        ({ command, fixture, empty, resourceCode }) =>
          window.api.dataApi.request({
            id: 'mp36-server',
            method: 'POST',
            path: '/mcp-servers',
            body: {
              name: empty ? 'MP36 empty catalog' : 'MP36 populated catalog',
              type: 'stdio',
              command,
              args: [fixture, ...(empty ? ['--empty'] : [])],
              env: { MP36_RESOURCE_CODE: resourceCode },
              isActive: true,
              isTrusted: true
            }
          }),
        {
          command: process.execPath,
          fixture: resolve('tests/e2e/regression/fixtures/mcpPromptResourceServer.mjs'),
          empty,
          resourceCode
        }
      )
      expect(result.status).toBe(201)
      serverIds.push(McpServerSchema.parse(result.data).id)
    }
    // Real configured provider proves instruction following and tool-based readback.
    const config = app.config.customProvider
    const statuses = await page.evaluate(
      async ({ providerId, config }) => {
        const provider = await window.api.dataApi.request({
          id: 'mp36-provider',
          method: 'POST',
          path: '/providers',
          body: {
            providerId,
            name: 'MP36 real provider',
            defaultChatEndpoint: 'openai-chat-completions',
            endpointConfigs: { 'openai-chat-completions': { baseUrl: config.baseUrl } },
            apiKeys: [{ id: 'mp36-key', key: config.apiKey, isEnabled: true }]
          }
        })
        const enabled = await window.api.dataApi.request({
          id: 'mp36-enable',
          method: 'PATCH',
          path: `/providers/${providerId}`,
          body: { isEnabled: true }
        })
        const model = await window.api.dataApi.request({
          id: 'mp36-model',
          method: 'POST',
          path: '/models',
          body: [
            {
              providerId,
              modelId: config.chatModel,
              endpointTypes: ['openai-chat-completions'],
              capabilities: ['function-call']
            }
          ]
        })
        return [provider.status, enabled.status, model.status]
      },
      { providerId, config }
    )
    expect(statuses).toEqual([201, 200, 201])
    const assistant = await page.evaluate(
      ({ name, modelId, serverId, settings }) =>
        window.api.dataApi.request({
          id: 'mp36-assistant',
          method: 'POST',
          path: '/assistants',
          body: { name, modelId, mcpServerIds: [serverId], settings }
        }),
      {
        name: assistantName,
        modelId: createUniqueModelId(providerId, config.chatModel),
        serverId: serverIds[0],
        settings: { ...DEFAULT_ASSISTANT_SETTINGS, mcpMode: 'manual' }
      }
    )
    expect(assistant.status).toBe(201)
    assistantId = AssistantSchema.parse(assistant.data).id
    const topic = await page.evaluate(
      ({ name, assistantId }) =>
        window.api.dataApi.request({
          id: 'mp36-topic',
          method: 'POST',
          path: '/topics',
          body: { name, assistantId }
        }),
      { name: topicName, assistantId }
    )
    expect(topic.status).toBe(201)
    const topicId = TopicSchema.parse(topic.data).id
    const navigate = async () => {
      await page.reload()
      await selectSidebarApp(page, 'Chat')
      const chat = page.locator('[data-ui~="chat.view"]:visible')
      const group = chat.locator('[data-ui~="chat.group-header"]').filter({ hasText: assistantName }).first()
      await expect(group).toBeVisible()
      await group.hover()
      const expand = group.getByRole('button', { name: 'Expand', exact: true })
      if (await expand.isVisible()) await expand.click()
      await chat.getByTestId('topic-list-row').filter({ hasText: topicName }).click()
      await expect(page.getByRole('button', { name: 'Selected models', exact: true })).toContainText(
        'MP36 real provider'
      )
    }
    await navigate()
    const composer = page.locator('[data-ui~="chat.composer"]')
    const editor = composer.locator('[contenteditable="true"]').first()
    const openCatalog = async (name: string) => {
      await composer.getByRole('button', { name: 'Input Quick Panel', exact: true }).click()
      await page.getByText(name, { exact: true }).last().click()
    }
    const readMessages = async () => {
      const result = await page.evaluate(
        (topicId) =>
          window.api.dataApi.request({
            id: 'mp36-messages',
            method: 'GET',
            path: `/topics/${topicId}/messages`
          }),
        topicId
      )
      expect(result.status).toBe(200)
      return (result.data as BranchMessagesResponse).items.map(({ message }) => MessageSchema.parse(message))
    }
    const sendDraft = async (answer: string) => {
      const previousIds = (await readMessages()).map(({ id }) => id)
      await page.getByRole('button', { name: 'Send', exact: true }).click()
      await expect
        .poll(
          async () =>
            (await readMessages()).filter(
              ({ id, role, status }) => !previousIds.includes(id) && role === 'assistant' && status === 'success'
            ).length,
          { timeout: 120_000 }
        )
        .toBe(1)
      const response = page
        .locator('[data-ui~="chat.message"][data-message-id]:visible')
        .filter({ has: page.locator('.message-assistant') })
        .last()
      await expect(response).toContainText(answer)
    }

    await openCatalog('MCP Prompts')
    await page.getByText('mp36-uppercase', { exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Fill prompt arguments', exact: true })
    await expect(dialog).toBeVisible()
    await dialog.getByRole('textbox', { name: 'value', exact: false }).fill(value)
    await dialog.getByRole('button', { name: 'Insert', exact: true }).click()
    await expect(dialog).toBeHidden()
    await expect(editor).toContainText(`Convert "${value}" to uppercase.`)
    await expect(editor).toBeEditable()
    await editor.press('End')
    await editor.press('ControlOrMeta+End')
    await editor.pressSequentially(' Append the literal suffix -EDITED to your answer.')
    await expect(editor).toContainText('-EDITED')
    await screenshot('MP-36 parameterized prompt inserted and edited')
    await sendDraft(`${value.toUpperCase()}-EDITED`)
    const userPrompt = (await readMessages()).find(({ role }) => role === 'user')!
    expect(JSON.stringify(userPrompt.data.parts)).toContain(value)
    expect(JSON.stringify(userPrompt.data.parts)).toContain('-EDITED')

    await openCatalog('MCP Resources')
    await page.getByText('MP36 project reference', { exact: true }).click()
    const reference = composer
      .locator('[data-composer-token-kind="reference"]')
      .filter({ hasText: 'MP36 project reference' })
    await expect(reference).toBeVisible()
    expect(await editor.innerText()).not.toContain(resourceCode)
    await editor.click()
    await editor.press('ControlOrMeta+End')
    await editor.pressSequentially(' Read the attached MCP resource and reply with its project verification code only.')
    await screenshot('MP-36 resource attached as reference')
    await sendDraft(resourceCode)
    const messages = await readMessages()
    const resourceUser = messages.filter(({ role }) => role === 'user').at(-1)!
    expect(JSON.stringify(resourceUser.data)).toContain('mp36://project/brief')
    const resourceAnswer = messages.filter(({ role }) => role === 'assistant').at(-1)!
    expect(JSON.stringify(resourceAnswer.data.parts)).toContain('mcp_resource_read')
    expect(JSON.stringify(resourceAnswer.data.parts)).toContain(resourceCode)
    await screenshot('MP-36 real model reads resource back')

    const switched = await page.evaluate(
      ({ assistantId, serverId }) =>
        window.api.dataApi.request({
          id: 'mp36-empty-binding',
          method: 'PATCH',
          path: `/assistants/${assistantId}`,
          body: { mcpServerIds: [serverId] }
        }),
      { assistantId, serverId: serverIds[1] }
    )
    expect(switched.status).toBe(200)
    await navigate()
    for (const [catalog, emptyText] of [
      ['MCP Prompts', 'No MCP prompts available'],
      ['MCP Resources', 'No MCP resources available']
    ]) {
      await openCatalog(catalog)
      const empty = page.getByRole('button', { name: emptyText, exact: true })
      await expect(empty).toBeVisible()
      await expect(empty).toHaveAttribute('aria-disabled', 'true')
      await screenshot(`MP-36 ${catalog} empty feedback`)
      await page.keyboard.press('Escape')
    }
  } finally {
    await page.evaluate(
      async ({ assistantId, providerId, serverIds, previousNaming }) => {
        await window.api.preference.set('topic.naming.enabled', previousNaming)
        if (assistantId) {
          await window.api.ipcApi.request('trash.assistant.archive', { assistantId, deleteTopics: true })
          await window.api.ipcApi.request('trash.assistant.delete_permanently', { assistantId, deleteTopics: true })
        }
        for (const serverId of serverIds) await window.api.ipcApi.request('mcp.server.remove', { serverId })
        await window.api.dataApi.request({ id: 'mp36-cleanup', method: 'DELETE', path: `/providers/${providerId}` })
      },
      { assistantId, providerId, serverIds, previousNaming }
    )
  }
}
