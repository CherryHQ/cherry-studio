import { once } from 'node:events'
import { rm, writeFile } from 'node:fs/promises'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'

import { _electron as electron } from '@playwright/test'

import { createUniqueModelId } from '../../../src/shared/data/types/model'
import { LATEST_PRIVACY_POLICY_VERSION } from '../../../src/shared/utils/constants'
import { selectSidebarApp } from '../regression/navigation'
import { expect, test as base } from './fixtures/electron.fixture'

const test = base.extend({
  electronApp: async ({}, use, testInfo) => {
    const profileRoot = testInfo.outputPath('profile')
    const electronApp = await electron.launch({
      args: ['.'],
      env: { ...process.env, NODE_ENV: 'development', CS_DEV_PROFILE_ROOT: profileRoot },
      timeout: 60000
    })
    try {
      await use(electronApp)
    } finally {
      try {
        await electronApp.close()
      } finally {
        await rm(profileRoot, { recursive: true, force: true, maxRetries: 3 })
      }
    }
  }
})

test('shows the provider fallback notice after a real search dispatch', async ({ mainWindow: page }, testInfo) => {
  test.setTimeout(180_000)
  const query = 'Cherry Studio deterministic fallback query'
  const chatRequests: Array<{ messages: Array<{ role?: string }> }> = []
  const deepSeekRequests: Array<{ query?: string }> = []
  const exaRequests: Array<{ method?: string; params?: { name?: string } }> = []
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
    const chatUrl = await startServer(async (request, response) => {
      if (request.method === 'GET' && request.url === '/v1/models') {
        json(response, 200, { object: 'list', data: [{ id: 'mock-chat', object: 'model' }] })
        return
      }
      if (request.method !== 'POST' || request.url !== '/v1/chat/completions') {
        json(response, 404, {})
        return
      }
      const body = await readBody(request)
      chatRequests.push(body)
      const hasToolResult = body.messages.some((message: { role?: string }) => message.role === 'tool')
      response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' })
      const chunk = (delta: object, finishReason: string | null) => {
        response.write(
          `data: ${JSON.stringify({ id: 'chatcmpl-fallback', object: 'chat.completion.chunk', created: 1, model: 'mock-chat', choices: [{ index: 0, delta, finish_reason: finishReason }] })}\n\n`
        )
      }
      chunk({ role: 'assistant', content: '' }, null)
      if (hasToolResult) {
        chunk({ content: 'The fallback search completed.' }, null)
        chunk({}, 'stop')
      } else {
        chunk(
          {
            tool_calls: [
              {
                index: 0,
                id: 'call-fallback',
                type: 'function',
                function: { name: 'web_search', arguments: JSON.stringify({ query }) }
              }
            ]
          },
          null
        )
        chunk({}, 'tool_calls')
      }
      response.end('data: [DONE]\n\n')
    })
    const deepSeekUrl = await startServer(async (request, response) => {
      if (request.method !== 'POST' || request.url !== '/v1/tools/search') {
        json(response, 404, {})
        return
      }
      deepSeekRequests.push(await readBody(request))
      json(response, 401, { error: { message: 'Your api key: ****invalid is invalid', type: 'invalid_request_error' } })
    })
    const exaUrl = await startServer(async (request, response) => {
      if (request.method !== 'POST') {
        json(response, 404, {})
        return
      }
      exaRequests.push(await readBody(request))
      json(response, 200, {
        jsonrpc: '2.0',
        id: 1,
        result: {
          content: [
            {
              type: 'text',
              text: 'Title: Cherry Studio fallback result\nURL: https://example.com/issue-23341\nText: Deterministic result served by the local ExaMCP fixture.'
            }
          ]
        }
      })
    })

    await page.evaluate(async (policyVersion) => {
      await window.api.preference.set('app.language', 'en-US')
      await window.api.preference.set('app.onboarding.provider_setup.status', 'skipped')
      await window.api.preference.set('app.privacy.policy_version', policyVersion)
      await window.api.preference.set('topic.naming.enabled', false)
    }, LATEST_PRIVACY_POLICY_VERSION)
    await page.reload()
    await expect(page.locator('[data-ui~="app.content"]').first()).toBeVisible({ timeout: 60_000 })

    const providerId = `fallback-smoke-${Date.now()}`
    const assistantName = `Fallback smoke ${providerId}`
    const provider = await page.evaluate(
      ({ providerId, baseUrl }) =>
        window.api.dataApi.request({
          id: `${providerId}-create`,
          method: 'POST',
          path: '/providers',
          body: {
            providerId,
            name: 'Fallback smoke mock',
            defaultChatEndpoint: 'openai-chat-completions',
            endpointConfigs: { 'openai-chat-completions': { baseUrl } },
            apiKeys: [{ id: 'mock-key', key: 'mock-key', isEnabled: true }]
          }
        }),
      { providerId, baseUrl: `${chatUrl}/v1` }
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
              modelId: 'mock-chat',
              endpointTypes: ['openai-chat-completions'],
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
      { providerId, name: assistantName, modelId: createUniqueModelId(providerId, 'mock-chat') }
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
    await page.evaluate(
      async ({ deepSeekUrl, exaUrl }) => {
        await window.api.preference.set('chat.web_search.default_search_keywords_provider', 'deepseek')
        await window.api.preference.set('chat.web_search.model_tools_preferred', false)
        await window.api.preference.set('chat.web_search.provider_overrides', {
          deepseek: {
            apiKeys: ['issue-23341-invalid-key'],
            capabilities: { searchKeywords: { apiHost: deepSeekUrl } }
          },
          'exa-mcp': { capabilities: { searchKeywords: { apiHost: `${exaUrl}/mcp` } } }
        })
      },
      { deepSeekUrl, exaUrl }
    )

    await page.reload()
    await selectSidebarApp(page, 'Chat')
    const chatView = page.locator('[data-ui~="chat.view"]:visible')
    await expect(chatView).toBeVisible({ timeout: 60_000 })
    const assistantRow = chatView.locator('[data-ui~="chat.group-header"]').filter({ hasText: assistantName }).first()
    await assistantRow.hover()
    await assistantRow.getByRole('button', { name: 'New Chat', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Selected models', exact: true })).toContainText('mock-chat')
    const composer = page.locator('[data-ui~="chat.composer"]:visible').first()
    await composer.locator('[contenteditable="true"]').first().fill('Search the web for Cherry Studio.')
    await page.getByRole('button', { name: 'Send', exact: true }).click()
    const notifications = page.locator('[aria-label="notifications"]')
    const noticeText = 'Web lookup: DeepSeek could not complete a request. Trying ExaMCP instead.'
    const notice = page.getByRole('alert').filter({ hasText: noticeText })
    await expect(notice).toHaveCount(1, { timeout: 60_000 })
    await expect(notice).toBeVisible()
    await expect(notice).toHaveText(noticeText)
    await notifications.hover()
    const processed = page.getByText('Processed', { exact: true })
    await processed.first().click()
    await processed.last().click()
    const card = page.getByText(query)
    await expect(card).toBeVisible()
    await expect(page.getByText('1 search result(s)')).toBeVisible()
    await notifications.hover()
    const screenshot = testInfo.outputPath('web-search-fallback.png')
    await page.screenshot({ path: screenshot })
    await testInfo.attach('web-search-fallback', { path: screenshot, contentType: 'image/png' })
    const noticeScreenshot = testInfo.outputPath('web-search-fallback-notice.png')
    await page.screenshot({ path: noticeScreenshot })
    await testInfo.attach('web-search-fallback-notice', { path: noticeScreenshot, contentType: 'image/png' })
    const evidence = testInfo.outputPath('evidence.json')
    await writeFile(
      evidence,
      JSON.stringify(
        {
          chatRequestCount: chatRequests.length,
          chatRequests,
          deepSeekRequests,
          exaRequests,
          notificationText: await notifications.innerText(),
          alertText: await notice.innerText(),
          toolCardText: await card.locator('..').innerText()
        },
        null,
        2
      )
    )
    await testInfo.attach('evidence', { path: evidence, contentType: 'application/json' })
    expect(deepSeekRequests.some((body) => body.query === query)).toBe(true)
    expect(exaRequests.some((body) => body.method === 'tools/call' && body.params?.name === 'web_search_exa')).toBe(
      true
    )
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
})
