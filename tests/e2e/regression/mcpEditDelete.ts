import { once } from 'node:events'
import { writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { expect, type Page, type TestInfo } from '@playwright/test'

import { AssistantSchema } from '@shared/data/types/assistant'
import { McpServerSchema } from '@shared/data/types/mcpServer'
import { createUniqueModelId } from '@shared/data/types/model'

import { getSensitiveConfigValues } from '../../../scripts/e2e/regression/config'
import { captureMaskedScreenshot } from '../../../scripts/e2e/regression/screenshotEvidence'
import { startMockChatServer } from '../../helpers/http/mockChatServer'
import { sendChatMarker } from './chat'
import { selectSidebarApp } from './navigation'
import type { RegressionApp } from './RegressionApp'
import { closeSettings, openSettingsSection } from './settings'

// Only external servers are fixtures; configuration, reconnection and deletion use the real application.
async function startServer() {
  let unavailable = false
  const connections: string[] = []
  const server = createServer((req, res) => {
    void (async () => {
      if (unavailable && req.url === '/edited') {
        res.writeHead(503).end('MP136 maintenance: retry after recovery')
        return
      }
      if (req.method !== 'POST') {
        res.writeHead(405).end()
        return
      }
      const chunks: Buffer[] = []
      for await (const chunk of req) chunks.push(Buffer.from(chunk))
      const body = JSON.parse(Buffer.concat(chunks).toString())
      if (body.method === 'initialize' && req.url === '/edited') connections.push(String(req.headers['x-mp136']))
      const tool = req.url === '/edited' ? 'edited_echo' : 'survivor_echo'
      const mcp = new McpServer({ name: tool, version: '1.0.0' })
      mcp.registerTool(tool, { description: tool }, async () => ({ content: [{ type: 'text', text: tool }] }))
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
      res.on('close', () => {
        void transport.close()
        void mcp.close()
      })
      await mcp.connect(transport)
      await transport.handleRequest(req, res, body)
    })().catch((error: Error) => {
      if (!res.headersSent) res.writeHead(500)
      res.end(error.message)
    })
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('No MCP fixture port')
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    connections,
    setUnavailable(value: boolean) {
      unavailable = value
    },
    async close() {
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  }
}

export async function mcpEditDelete(app: RegressionApp, page: Page, testInfo: TestInfo): Promise<void> {
  const screenshot = async (name: string) => {
    const path = testInfo.outputPath(`${name}.png`)
    await writeFile(path, await captureMaskedScreenshot(page, getSensitiveConfigValues()))
    await testInfo.attach(name, { path, contentType: 'image/png' })
  }
  const original = await page.evaluate(async () => ({
    naming: await window.api.preference.get('topic.naming.enabled'),
    pinned: await window.api.preference.get('chat.input.toolbar.pinned_tools')
  }))
  const fixture = await startServer()
  const model = await startMockChatServer()
  const providerId = `mp136-${Date.now()}`
  const modelId = 'gpt-4o-mini'
  const name = app.resourceName('edit')
  const assistantName = app.resourceName('MCP editor')
  const survivorName = app.resourceName('keep')
  const serverIds: string[] = []
  let assistantId: string | undefined
  try {
    await page.evaluate(() =>
      window.api.preference.setMultiple({
        'topic.naming.enabled': false,
        'chat.input.toolbar.pinned_tools': ['composer:new-conversation', 'mcp-status']
      })
    )
    for (const [serverName, endpoint] of [
      [name, 'edited'],
      [survivorName, 'survivor']
    ]) {
      const response = await page.evaluate(
        ({ name, baseUrl }) =>
          window.api.dataApi.request({
            id: 'mp136-seed',
            method: 'POST',
            path: '/mcp-servers',
            body: { name, type: 'streamableHttp', baseUrl, isActive: true, isTrusted: true, timeout: 60 }
          }),
        { name: serverName, baseUrl: `${fixture.baseUrl}/${endpoint}` }
      )
      expect(response.status).toBe(201)
      serverIds.push(McpServerSchema.parse(response.data).id)
    }
    const readServer = (id: string) =>
      page.evaluate(
        (id) =>
          window.api.dataApi.request({
            id: 'mp136-read',
            method: 'GET',
            path: `/mcp-servers/${id}`
          }),
        id
      )
    const survivorBefore = await readServer(serverIds[1])
    expect(survivorBefore.status).toBe(200)
    const seeded = await page.evaluate(
      async ({ providerId, baseUrl, modelId, uniqueModelId, name, serverIds }) => {
        const provider = await window.api.dataApi.request({
          id: 'mp136-provider',
          method: 'POST',
          path: '/providers',
          body: {
            providerId,
            name: 'MP-136 local model',
            defaultChatEndpoint: 'openai-chat-completions',
            endpointConfigs: { 'openai-chat-completions': { baseUrl } },
            apiKeys: [{ id: 'mock', key: 'mock-api-key', isEnabled: true }]
          }
        })
        const enabled = await window.api.dataApi.request({
          id: 'mp136-enable',
          method: 'PATCH',
          path: `/providers/${providerId}`,
          body: { isEnabled: true }
        })
        const models = await window.api.dataApi.request({
          id: 'mp136-model',
          method: 'POST',
          path: '/models',
          body: [{ providerId, modelId, endpointTypes: ['openai-chat-completions'] }]
        })
        const assistant = await window.api.dataApi.request({
          id: 'mp136-assistant',
          method: 'POST',
          path: '/assistants',
          body: { name, modelId: uniqueModelId, mcpServerIds: serverIds }
        })
        return { provider, enabled, models, assistant }
      },
      {
        providerId,
        baseUrl: model.baseUrl,
        modelId,
        uniqueModelId: createUniqueModelId(providerId, modelId),
        name: assistantName,
        serverIds
      }
    )
    expect(seeded.provider.status).toBe(201)
    expect(seeded.enabled.status).toBe(200)
    expect(seeded.models.status).toBe(201)
    expect(seeded.assistant.status).toBe(201)
    assistantId = AssistantSchema.parse(seeded.assistant.data).id
    const topic = await page.evaluate(
      ({ assistantId, name }) =>
        window.api.dataApi.request({
          id: 'mp136-topic',
          method: 'POST',
          path: '/topics',
          body: { assistantId, name }
        }),
      { assistantId, name: assistantName }
    )
    expect(topic.status).toBe(201)
    await page.reload()
    await selectSidebarApp(page, 'Chat')
    const chat = page.locator('[data-ui~="chat.view"]:visible')
    const group = chat.locator('[data-ui~="chat.group-header"]').filter({ hasText: assistantName }).first()
    await expect(group).toBeVisible()
    await group.hover()
    const expand = group.getByRole('button', { name: 'Expand', exact: true })
    if (await expand.isVisible()) await expand.click()
    await chat.getByTestId('topic-list-row').filter({ hasText: assistantName }).click()
    const offeredTools = async (marker: string) => {
      const [, tools] = await Promise.all([
        sendChatMarker(page, marker, marker),
        (async () => {
          const request = await model.nextRequest()
          const tools = (request.body as { tools?: { function: { name: string } }[] }).tools ?? []
          request.complete(marker)
          return tools.map((tool) => tool.function.name)
        })()
      ])
      return tools
    }
    const before = await offeredTools('MP136 before deletion')
    expect(before, 'Both real MCP tools must be offered before deletion').toEqual(
      expect.arrayContaining([expect.stringContaining('__editedEcho_'), expect.stringContaining('__survivorEcho_')])
    )

    await openSettingsSection(page, 'MCP')
    await page.getByText(name, { exact: true }).click()
    await page.getByLabel('Headers', { exact: true }).fill('X-MP136=edited-value')
    await page.getByLabel('Timeout', { exact: true }).fill('75')
    await page.getByLabel('Timeout', { exact: true }).press('Tab')
    fixture.setUnavailable(true)
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Retry', exact: true })).toBeVisible()
    await expect(page.getByText('Error', { exact: true })).toBeVisible()
    await expect
      .poll(async () => {
        const response = await readServer(serverIds[0])
        expect(response.status).toBe(200)
        return McpServerSchema.parse(response.data)
      })
      .toMatchObject({ timeout: 75, headers: { 'X-MP136': 'edited-value' } })
    await page.getByRole('radio', { name: 'Logs', exact: true }).click()
    await expect(page.getByRole('tabpanel')).toContainText(/503|maintenance/)
    await screenshot('MP-136 failed reconnect with reason and logs')
    fixture.setUnavailable(false)
    const connectionCount = fixture.connections.length
    await page.getByRole('button', { name: 'Retry', exact: true }).click()
    await expect(page.getByText('Connected', { exact: true })).toBeVisible()
    await expect.poll(() => fixture.connections.length).toBeGreaterThan(connectionCount)
    expect(fixture.connections.at(-1)).toBe('edited-value')
    await expect(page.getByRole('tabpanel')).toContainText('Server connected')
    await screenshot('MP-136 successful reconnect logs')
    await page.getByRole('radio', { name: 'General', exact: true }).click()
    await page.reload()
    await expect(page.getByLabel('Timeout', { exact: true })).toHaveValue('75')
    await expect(page.getByLabel('Headers', { exact: true })).toHaveValue('X-MP136=edited-value')

    await page.getByRole('button', { name: 'Delete', exact: true }).click()
    const confirmation = page.getByRole('dialog', { name: 'Delete Server', exact: true })
    await expect(confirmation).toContainText('Are you sure you want to delete this server?')
    expect((await readServer(serverIds[0])).status).toBe(200)
    await confirmation.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(confirmation).toBeHidden()
    expect((await readServer(serverIds[0])).status).toBe(200)
    await page.getByRole('button', { name: 'Delete', exact: true }).click()
    await expect(confirmation).toBeVisible()
    await screenshot('MP-136 delete confirmation')
    await confirmation.getByRole('button', { name: 'Delete', exact: true }).click()
    await expect(confirmation).toBeHidden()
    await expect.poll(async () => (await readServer(serverIds[0])).status).toBe(404)
    expect((await readServer(serverIds[1])).data).toEqual(survivorBefore.data)
    await expect(page.getByText(name, { exact: true })).toHaveCount(0)
    await expect(page.getByText(survivorName, { exact: true })).toBeVisible()
    await closeSettings(page)
    const mcpButton = page
      .locator('[data-ui~="chat.composer"]:visible')
      .getByRole('button', { name: 'MCP', exact: true })
    const panel = page.getByTestId('quick-panel')
    await expect
      .poll(async () => {
        if (await panel.isVisible()) return true
        await mcpButton.click()
        return panel
          .waitFor({ state: 'visible', timeout: 2000 })
          .then(() => true)
          .catch(() => false)
      })
      .toBe(true)
    await expect(panel.getByRole('button').filter({ hasText: name })).toHaveCount(0)
    await expect(panel.getByRole('button').filter({ hasText: survivorName })).toBeVisible()
    await screenshot('MP-136 deleted server absent from conversation')
    await page.keyboard.press('Escape')
    const after = await offeredTools('MP136 after deletion')
    expect(after.some((tool) => tool.includes('__editedEcho_'))).toBe(false)
    expect(after.some((tool) => tool.includes('__survivorEcho_'))).toBe(true)
    await openSettingsSection(page, 'MCP')
    await page.getByText(survivorName, { exact: true }).click()
    await expect(page.getByText('Connected', { exact: true })).toBeVisible()
    await page.getByRole('radio', { name: /Tools/ }).click()
    await expect(page.getByTitle('survivor_echo', { exact: true })).toBeVisible()
  } finally {
    fixture.setUnavailable(false)
    await page.evaluate(
      async ({ assistantId, serverIds, providerId, original }) => {
        await window.api.preference.setMultiple({
          'topic.naming.enabled': original.naming,
          'chat.input.toolbar.pinned_tools': original.pinned
        })
        if (assistantId) {
          await window.api.ipcApi.request('trash.assistant.archive', { assistantId, deleteTopics: true })
          await window.api.ipcApi.request('trash.assistant.delete_permanently', { assistantId, deleteTopics: true })
        }
        for (const serverId of serverIds) {
          const response = await window.api.dataApi.request({
            id: 'mp136-cleanup-check',
            method: 'GET',
            path: `/mcp-servers/${serverId}`
          })
          if (response.status === 200) await window.api.ipcApi.request('mcp.server.remove', { serverId })
        }
        await window.api.dataApi.request({ id: 'mp136-cleanup', method: 'DELETE', path: `/providers/${providerId}` })
      },
      { assistantId, serverIds, providerId, original }
    )
    await model.close()
    await fixture.close()
  }
}
