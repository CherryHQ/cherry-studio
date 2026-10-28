import { writeFile } from 'node:fs/promises'

import { expect, type Page, type TestInfo } from '@playwright/test'

import { AssistantSchema } from '@shared/data/types/assistant'
import { McpServerSchema } from '@shared/data/types/mcpServer'
import { MessageSchema } from '@shared/data/types/message'
import { createUniqueModelId } from '@shared/data/types/model'
import { TopicSchema } from '@shared/data/types/topic'
import type { IpcResult } from '@shared/ipc/errors/IpcError'

import { getSensitiveConfigValues } from '../../../../scripts/e2e/regression/config'
import { captureMaskedScreenshot } from '../../../../scripts/e2e/regression/screenshotEvidence'
import { startMcpConversationServer } from '../fixtures/mcpConversationServer'
import { sendChatMarker } from '../helpers/chat'
import { selectSidebarApp } from '../helpers/navigation'
import type { RegressionApp } from '../RegressionApp'

export async function mcpConversation(app: RegressionApp, page: Page, testInfo: TestInfo): Promise<void> {
  const screenshot = async (name: string) => {
    const path = testInfo.outputPath(`${name}.png`)
    await writeFile(path, await captureMaskedScreenshot(page, getSensitiveConfigValues()))
    await testInfo.attach(name, { path, contentType: 'image/png' })
  }
  const original = await page.evaluate(async () => ({
    naming: await window.api.preference.get('topic.naming.enabled'),
    pinned: await window.api.preference.get('chat.input.toolbar.pinned_tools')
  }))
  testInfo.annotations.push({
    type: 'data-source',
    description:
      'Loopback mock chat replies and MCP tool server; real Electron UI, IPC and persisted data. Does not validate external model quality.'
  })
  const fixture = await startMcpConversationServer()
  const providerId = `mp135-${Date.now()}`
  const modelId = 'gpt-4o-mini'
  const name = app.resourceName('fetch')
  let assistantId: string | undefined
  let serverId: string | undefined
  try {
    await page.evaluate(async () =>
      window.api.preference.setMultiple({
        'topic.naming.enabled': false,
        'chat.input.toolbar.pinned_tools': ['composer:new-conversation', 'mcp-status']
      })
    )
    const seeded = await page.evaluate(
      async ({ providerId, modelId, baseUrl, name }) => {
        const provider = await window.api.dataApi.request({
          id: 'mp135-provider',
          method: 'POST',
          path: '/providers',
          body: {
            providerId,
            name: 'MP-135 scripted model',
            defaultChatEndpoint: 'openai-chat-completions',
            endpointConfigs: { 'openai-chat-completions': { baseUrl: `${baseUrl}/v1` } },
            apiKeys: [{ id: 'mock', key: 'mock-api-key', isEnabled: true }]
          }
        })
        const enabled = await window.api.dataApi.request({
          id: 'mp135-enable',
          method: 'PATCH',
          path: `/providers/${providerId}`,
          body: { isEnabled: true }
        })
        const model = await window.api.dataApi.request({
          id: 'mp135-model',
          method: 'POST',
          path: '/models',
          body: [{ providerId, modelId, endpointTypes: ['openai-chat-completions'] }]
        })
        const mcp = await window.api.dataApi.request({
          id: 'mp135-mcp',
          method: 'POST',
          path: '/mcp-servers',
          body: {
            name,
            type: 'streamableHttp',
            baseUrl: `${baseUrl}/mcp`,
            isActive: true,
            isTrusted: true,
            disabledAutoApproveTools: ['fetch']
          }
        })
        return { provider, enabled, model, mcp }
      },
      { providerId, modelId, baseUrl: fixture.baseUrl, name }
    )
    expect(seeded.provider.status).toBe(201)
    expect(seeded.enabled.status).toBe(200)
    expect(seeded.model.status).toBe(201)
    expect(seeded.mcp.status).toBe(201)
    serverId = McpServerSchema.parse(seeded.mcp.data).id
    const assistant = await page.evaluate(
      ({ name, modelId, serverId }) =>
        window.api.dataApi.request({
          id: 'mp135-assistant',
          method: 'POST',
          path: '/assistants',
          body: { name, modelId, mcpServerIds: [serverId] }
        }),
      { name, modelId: createUniqueModelId(providerId, modelId), serverId }
    )
    expect(assistant.status).toBe(201)
    assistantId = AssistantSchema.parse(assistant.data).id
    const topic = await page.evaluate(
      ({ name, assistantId }) =>
        window.api.dataApi.request({
          id: 'mp135-topic',
          method: 'POST',
          path: '/topics',
          body: { name, assistantId }
        }),
      { name, assistantId }
    )
    expect(topic.status).toBe(201)
    TopicSchema.parse(topic.data)
    await page.reload()
    await selectSidebarApp(page, 'Chat')
    const chat = page.locator('[data-ui~="chat.view"]:visible')
    const group = chat.locator('[data-ui~="chat.group-header"]').filter({ hasText: name }).first()
    await expect(group).toBeVisible()
    await group.hover()
    const expand = group.getByRole('button', { name: 'Expand', exact: true })
    if (await expand.isVisible()) await expand.click()
    await chat.getByTestId('topic-list-row').filter({ hasText: name }).click()
    await expect(page.getByRole('button', { name: 'Selected models', exact: true })).toContainText('GPT-4o mini')
    const binding = async () =>
      page.evaluate(async (id) => {
        const result = await window.api.dataApi.request({
          id: 'mp135-binding',
          method: 'GET',
          path: `/assistants/${id}`
        })
        return (result.data as { mcpServerIds: string[] }).mcpServerIds
      }, assistantId!)
    const mcpButton = page
      .locator('[data-ui~="chat.composer"]:visible')
      .getByRole('button', { name: 'MCP', exact: true })
    const entry = page.getByTestId('quick-panel').getByRole('button').filter({ hasText: name })
    await expect
      .poll(
        async () => {
          if (await entry.isVisible().catch(() => false)) return true
          await mcpButton.click()
          return entry
            .waitFor({ state: 'visible', timeout: 2_000 })
            .then(() => true)
            .catch(() => false)
        },
        { timeout: 15_000 }
      )
      .toBe(true)
    await expect(entry).toBeVisible()
    await entry.click()
    await expect.poll(binding).toEqual([])
    await entry.click()
    await expect.poll(binding).toEqual([serverId])
    await page.keyboard.press('Escape')
    await screenshot('MP-135 enabled MCP conversation')

    for (const [index, url] of ['https://example.com', 'https://example.com/mp-135-missing'].entries()) {
      const marker = index === 0 ? 'Example Domain' : 'HTTP 404'
      const [messageId] = await Promise.all([
        sendChatMarker(page, `用 fetch 读取 ${url} 的标题`, marker, false),
        (async () => {
          const allow = page.getByRole('button', { name: 'Allow', exact: true })
          await expect(allow)
            .toBeVisible({ timeout: 15_000 })
            .catch(async (error) => {
              throw new Error(
                `${error.message}\n${JSON.stringify({ errors: fixture.errors, requests: fixture.requests, ui: await page.locator('body').innerText() })}`
              )
            })
          await expect(page.getByTestId('permission-mcp-args-scroll')).toContainText(url)
          expect(fixture.calls).toHaveLength(index)
          await screenshot(`MP-135 approval ${index + 1}`)
          await allow.click()
        })()
      ])
      expect(fixture.errors).toEqual([])
      expect(fixture.calls).toHaveLength(index + 1)
      expect(fixture.calls[index]).toEqual({ url, text: expect.stringContaining(marker), isError: index === 1 })
      const response = await page.evaluate(
        (id) => window.api.dataApi.request({ id: 'mp135-message', method: 'GET', path: `/messages/${id}` }),
        messageId
      )
      const message = MessageSchema.parse(response.data)
      expect(message.status).toBe('success')
      expect(message.data.parts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            state: index === 0 ? 'output-available' : 'output-error',
            input: { url },
            ...(index === 0
              ? {
                  output: expect.objectContaining({
                    isError: false,
                    metadata: expect.objectContaining({ type: 'mcp', name: 'fetch', serverName: name }),
                    content: expect.arrayContaining([
                      expect.objectContaining({ type: 'text', text: expect.stringContaining(marker) })
                    ])
                  })
                }
              : {
                  errorText: expect.stringContaining('HTTP 404'),
                  toolMetadata: expect.objectContaining({
                    cherry: expect.objectContaining({
                      tool: expect.objectContaining({ type: 'mcp', name: 'fetch', serverName: name })
                    })
                  })
                })
          })
        ])
      )
      expect(
        fixture.requests.some(({ messages }) =>
          messages.some((item) => item.role === 'tool' && item.content?.includes(marker))
        )
      ).toBe(true)
      const messageView = page.locator(`[data-ui~="chat.message"][data-message-id="${messageId}"]`)
      const card = messageView
        .getByRole('button')
        .filter({ hasText: index === 0 ? 'View web page' : 'Extension failed' })
      await messageView.getByTestId('completed-process-trigger').click()
      await card.click()
      await messageView
        .getByRole('button')
        .filter({ hasText: `${name} : fetch` })
        .last()
        .click()
      await expect(messageView).toContainText(url)
      await screenshot(`MP-135 ${index === 0 ? 'tool result in answer' : '404 error returned'}`)
    }
  } finally {
    await page.evaluate(
      async ({ assistantId, serverId, providerId, original }) => {
        await window.api.preference.setMultiple({
          'topic.naming.enabled': original.naming,
          'chat.input.toolbar.pinned_tools': original.pinned
        })
        if (assistantId) {
          const permanentlyDeletedAssistant = (await window.api.ipcApi.request('trash.assistant.delete_permanently', {
            assistantId,
            deleteTopics: true
          })) as IpcResult<{ deleted: boolean }>
          if (!permanentlyDeletedAssistant.ok || !permanentlyDeletedAssistant.data.deleted)
            throw new Error('cleanup left the case assistant in the trash')
        }
        if (serverId) await window.api.ipcApi.request('mcp.server.remove', { serverId })
        await window.api.dataApi.request({ id: 'mp135-delete', method: 'DELETE', path: `/providers/${providerId}` })
      },
      { assistantId, serverId, providerId, original }
    )
    await fixture.close()
  }
}
