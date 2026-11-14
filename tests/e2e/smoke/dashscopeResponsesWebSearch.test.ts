import { once } from 'node:events'
import { rm, writeFile } from 'node:fs/promises'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'

import { _electron as electron } from '@playwright/test'

import { createUniqueModelId } from '../../../src/shared/data/types/model'
import { LATEST_PRIVACY_POLICY_VERSION } from '../../../src/shared/utils/constants'
import { selectSidebarApp } from '../regression/navigation'
import { closeElectronApp, expect, test as base } from './fixtures/electron.fixture'

const test = base.extend({
  electronApp: async ({}, runTest, testInfo) => {
    const profileRoot = testInfo.outputPath('profile')
    const env = { ...process.env, NODE_ENV: 'development', CS_DEV_PROFILE_ROOT: profileRoot }
    Reflect.deleteProperty(env, 'ELECTRON_RENDERER_URL')
    try {
      const electronApp = await electron.launch({ args: ['.'], env, timeout: 60_000 })
      try {
        await runTest(electronApp)
      } finally {
        await closeElectronApp(electronApp)
      }
    } finally {
      await rm(profileRoot, { recursive: true, force: true, maxRetries: 3 })
    }
  }
})

type ResponsesRequest = {
  model?: string
  stream?: boolean
  tools?: Array<{ type?: string; name?: string }>
  input?: Array<{ type?: string; call_id?: string; output?: unknown }>
}

type SearchRequest = {
  method?: string
  params?: { name?: string; arguments?: { query?: string } }
}

test('executes client web search for DashScope Responses when model tools are preferred', async ({
  mainWindow: page
}, testInfo) => {
  test.setTimeout(180_000)
  const query = 'Cherry Studio deterministic responses query'
  const resultTitle = 'Issue 23950 DashScope Responses fixture result'
  const resultUrl = 'https://example.com/issue-23950-responses-search'
  const resultText = 'Deterministic ExaMCP content for the DashScope Responses client search route.'
  const finalText = 'The DashScope Responses client search completed.'
  const apiKey = 'issue-23950-fixture-api-key'
  const modelRequests: ResponsesRequest[] = []
  const searchRequests: SearchRequest[] = []
  const servers: Server[] = []

  const readBody = async (request: IncomingMessage) => {
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(Buffer.from(chunk))
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  }
  const json = (response: ServerResponse, status: number, body: unknown) => {
    response.writeHead(status, { 'Content-Type': 'application/json' })
    response.end(JSON.stringify(body))
  }
  const startServer = async (handler: (request: IncomingMessage, response: ServerResponse) => Promise<void>) => {
    const server = createServer((request, response) => {
      void handler(request, response).catch(() => json(response, 500, { error: 'Fixture error' }))
    })
    servers.push(server)
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Fixture failed to bind a TCP port')
    return `http://127.0.0.1:${address.port}`
  }

  try {
    await page.route(/^https?:\/\//, (route) => {
      const hostname = new URL(route.request().url()).hostname
      return hostname === '127.0.0.1' || hostname === 'localhost' ? route.continue() : route.abort()
    })
    const modelUrl = await startServer(async (request, response) => {
      if (request.method === 'GET' && request.url === '/v1/models') {
        json(response, 200, { object: 'list', data: [{ id: 'qwen-plus', object: 'model' }] })
        return
      }
      if (request.method !== 'POST' || request.url !== '/v1/responses') {
        json(response, 404, {})
        return
      }
      const body: ResponsesRequest = await readBody(request)
      modelRequests.push(body)
      const hasToolResult = body.input?.some((item) => item.type === 'function_call_output')
      response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' })
      const chunk = (value: object) => response.write(`data: ${JSON.stringify(value)}\n\n`)
      chunk({ type: 'response.created', response: { id: hasToolResult ? 'resp_2' : 'resp_1' } })
      if (hasToolResult) {
        const item = { type: 'message', id: 'msg_2' }
        chunk({ type: 'response.output_item.added', output_index: 0, item })
        chunk({ type: 'response.output_text.delta', item_id: 'msg_2', delta: finalText })
        chunk({ type: 'response.output_item.done', output_index: 0, item })
      } else {
        const item = { type: 'function_call', id: 'fc_1', call_id: 'call_1', name: 'web_search' }
        const args = JSON.stringify({ query })
        chunk({ type: 'response.output_item.added', output_index: 0, item: { ...item, arguments: '' } })
        chunk({
          type: 'response.function_call_arguments.delta',
          item_id: 'fc_1',
          output_index: 0,
          delta: args
        })
        chunk({
          type: 'response.function_call_arguments.done',
          item_id: 'fc_1',
          output_index: 0,
          arguments: args
        })
        chunk({
          type: 'response.output_item.done',
          output_index: 0,
          item: { ...item, arguments: args, status: 'completed' }
        })
      }
      chunk({
        type: 'response.completed',
        response: { usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } }
      })
      response.end()
    })
    const searchUrl = await startServer(async (request, response) => {
      if (request.method !== 'POST' || request.url !== '/mcp') {
        json(response, 404, {})
        return
      }
      searchRequests.push(await readBody(request))
      json(response, 200, {
        jsonrpc: '2.0',
        id: 1,
        result: {
          content: [{ type: 'text', text: `Title: ${resultTitle}\nURL: ${resultUrl}\nText: ${resultText}` }]
        }
      })
    })

    await page.evaluate(async (policyVersion) => {
      await window.api.preference.setMultiple({
        'app.language': 'en-US',
        'app.onboarding.provider_setup.status': 'skipped',
        'app.privacy.policy_version': policyVersion,
        'topic.naming.enabled': false
      })
    }, LATEST_PRIVACY_POLICY_VERSION)
    await page.reload()
    await expect(page.locator('[data-ui~="app.content"]').first()).toBeVisible({ timeout: 60_000 })

    const providerId = `dashscope-responses-smoke-${Date.now()}`
    const assistantName = `DashScope Responses smoke ${providerId}`
    const provider = await page.evaluate(
      ({ providerId, baseUrl, apiKey }) =>
        window.api.dataApi.request({
          id: `${providerId}-create`,
          method: 'POST',
          path: '/providers',
          body: {
            providerId,
            presetProviderId: 'dashscope',
            name: 'DashScope Responses smoke mock',
            defaultChatEndpoint: 'openai-responses',
            endpointConfigs: { 'openai-responses': { baseUrl } },
            apiKeys: [{ id: 'mock-key', key: apiKey, isEnabled: true }]
          }
        }),
      { providerId, baseUrl: `${modelUrl}/v1`, apiKey }
    )
    expect(provider.status).toBe(201)
    const enabled = await page.evaluate(
      (providerId) =>
        window.api.dataApi.request({
          id: `${providerId}-enable`,
          method: 'PATCH',
          path: `/providers/${providerId}`,
          body: { isEnabled: true }
        }),
      providerId
    )
    expect(enabled.status).toBe(200)
    const models = await page.evaluate(
      (providerId) =>
        window.api.dataApi.request({
          id: `${providerId}-model`,
          method: 'POST',
          path: '/models',
          body: [
            {
              providerId,
              modelId: 'qwen-plus',
              endpointTypes: ['openai-responses'],
              capabilities: ['function-call']
            }
          ]
        }),
      providerId
    )
    expect(models.status).toBe(201)
    const assistant = await page.evaluate(
      ({ providerId, name, modelId }) =>
        window.api.dataApi.request({
          id: `${providerId}-assistant`,
          method: 'POST',
          path: '/assistants',
          body: { name, modelId }
        }),
      { providerId, name: assistantName, modelId: createUniqueModelId(providerId, 'qwen-plus') }
    )
    expect(assistant.status).toBe(201)
    const assistantId = (assistant.data as { id: string }).id
    const updated = await page.evaluate(
      ({ providerId, assistantId }) =>
        window.api.dataApi.request({
          id: `${providerId}-assistant-update`,
          method: 'PATCH',
          path: `/assistants/${assistantId}`,
          body: { settings: { enableWebSearch: true } }
        }),
      { providerId, assistantId }
    )
    expect(updated.status).toBe(200)
    await page.evaluate(async (searchUrl) => {
      await window.api.preference.setMultiple({
        'chat.web_search.model_tools_preferred': true,
        'chat.web_search.default_search_keywords_provider': 'exa-mcp',
        // @ts-expect-error Seed the requested null state; persisted preferences accept JSON null.
        'chat.web_search.default_fetch_urls_provider': null,
        'chat.web_search.provider_overrides': {
          'exa-mcp': { capabilities: { searchKeywords: { apiHost: `${searchUrl}/mcp` } } }
        }
      })
    }, searchUrl)

    await page.reload()
    await selectSidebarApp(page, 'Chat')
    const chatView = page.locator('[data-ui~="chat.view"]:visible')
    await expect(chatView).toBeVisible({ timeout: 60_000 })
    const assistantRow = chatView.locator('[data-ui~="chat.group-header"]').filter({ hasText: assistantName }).first()
    await assistantRow.hover()
    await assistantRow.getByRole('button', { name: 'New Chat', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Selected models', exact: true })).toContainText(
      /Qwen Plus|qwen-plus/i
    )
    const composer = page.locator('[data-ui~="chat.composer"]:visible').first()
    await composer.locator('[contenteditable="true"]').first().fill('Search the web for Cherry Studio.')
    await page.getByRole('button', { name: 'Send', exact: true }).click()

    await expect.poll(() => modelRequests.length, { timeout: 60_000 }).toBeGreaterThanOrEqual(1)
    expect(modelRequests[0]).toMatchObject({ model: 'qwen-plus', stream: true })
    const tools = modelRequests[0].tools ?? []
    expect(tools.filter((tool) => tool.name === 'web_search')).toEqual([
      expect.objectContaining({ type: 'function', name: 'web_search' })
    ])
    expect(tools.some((tool) => tool.type === 'web_search')).toBe(false)

    await expect.poll(() => modelRequests.length, { timeout: 60_000 }).toBeGreaterThanOrEqual(2)
    const toolOutputs = modelRequests[1].input?.filter((item) => item.type === 'function_call_output') ?? []
    expect(toolOutputs).toHaveLength(1)
    expect(toolOutputs[0].call_id).toBe('call_1')
    expect(JSON.stringify(toolOutputs[0].output)).toContain(resultTitle)
    expect(JSON.stringify(toolOutputs[0].output)).toContain(resultUrl)
    expect(JSON.stringify(toolOutputs[0].output)).toContain(resultText)
    expect(JSON.stringify(toolOutputs)).not.toMatch(/unavailable tool/i)
    expect(searchRequests).toContainEqual({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'web_search_exa',
        arguments: expect.objectContaining({ query })
      }
    })

    const messages = chatView.locator('[data-ui~="chat.message"][data-message-id]')
    const reply = messages.filter({ hasText: finalText }).last()
    await expect(reply.getByText(finalText, { exact: true })).toBeVisible({ timeout: 60_000 })
    const processed = reply.getByRole('button', { name: /^Processed/ })
    await expect(processed.first()).toBeVisible()
    if ((await processed.first().getAttribute('aria-expanded')) !== 'true') await processed.first().click()
    const nestedProcess = reply.getByRole('button', { name: /^Processed/, expanded: false }).first()
    await expect(nestedProcess).toBeVisible()
    await nestedProcess.click()
    await expect(reply.getByText(query, { exact: true })).toBeVisible()
    await expect(reply.getByText('1 search result(s)', { exact: true })).toBeVisible()
    await reply.getByRole('button', { name: new RegExp(query) }).click()
    await expect(reply.getByRole('link', { name: new RegExp(resultTitle) })).toHaveAttribute('href', resultUrl)
    expect((await messages.allTextContents()).join('\n')).not.toMatch(/unavailable tool/i)
    await expect(page.locator('body')).not.toContainText(/unavailable tool/i)
    expect(modelRequests).toHaveLength(2)
    const screenshot = testInfo.outputPath('dashscope-responses-web-search.png')
    await page.screenshot({ path: screenshot })
    await testInfo.attach('dashscope-responses-web-search', { path: screenshot, contentType: 'image/png' })
  } finally {
    try {
      const evidence = testInfo.outputPath('dashscope-responses-web-search.json')
      await writeFile(
        evidence,
        JSON.stringify({ modelRequests, searchRequests }, null, 2).replaceAll(apiKey, '[REDACTED]')
      )
      await testInfo.attach('dashscope-responses-web-search-requests', {
        path: evidence,
        contentType: 'application/json'
      })
    } finally {
      await Promise.all(
        servers.map(
          (server) =>
            new Promise<void>((resolve, reject) => {
              server.close((error) => (error ? reject(error) : resolve()))
              server.closeAllConnections()
            })
        )
      )
    }
  }
})
