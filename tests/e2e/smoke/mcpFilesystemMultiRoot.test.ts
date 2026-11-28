import { once } from 'node:events'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { join } from 'node:path'

import { _electron as electron, errors } from '@playwright/test'

import { AssistantSchema } from '../../../src/shared/data/types/assistant'
import { McpServerSchema } from '../../../src/shared/data/types/mcpServer'
import { MessageSchema } from '../../../src/shared/data/types/message'
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

interface ChatRequest {
  model: string
  messages: Array<{ role: string; content?: unknown }>
  tools?: Array<{ function: { name: string } }>
}

test('built-in filesystem serves every configured root while denying outside paths', async ({
  mainWindow: page
}, testInfo) => {
  test.setTimeout(240_000)
  const [rootA, rootB, outsideDir] = ['rootA', 'rootB', 'outsideDir'].map((name) =>
    join(testInfo.outputPath('roots'), name)
  )
  const [fileA, fileB, outsideFile] = [rootA, rootB, outsideDir].map((root) => join(root, 'marker.txt'))
  await Promise.all([rootA, rootB, outsideDir].map((root) => mkdir(root, { recursive: true })))
  await Promise.all([
    writeFile(fileA, 'multiroot-marker-a\n'),
    writeFile(fileB, 'multiroot-marker-b\n'),
    writeFile(outsideFile, 'outside-marker\n')
  ])
  const deniedText = 'Access denied: Path is outside the configured workspace root'
  const turns = [
    { id: 'A1', filePath: fileA, marker: 'multiroot-marker-a', bug: 'D: first configured root stops working' },
    {
      id: 'A2',
      filePath: fileB,
      marker: 'multiroot-marker-b',
      bug: 'A: only the first configured root is allowed',
      screenshot: 'second-root'
    },
    {
      id: 'C',
      filePath: outsideFile,
      marker: deniedText,
      bug: 'C: allowed paths widen to everything',
      screenshot: 'outside-denied'
    },
    {
      id: 'B',
      filePath: fileA,
      marker: 'multiroot-marker-a',
      bug: 'B: only the first line works after reordering',
      screenshot: 'reordered-roots'
    }
  ]
  let activeTurn = turns[0]
  const requests: ChatRequest[] = []
  const toolCalls: Array<{ turn: string; name: string; arguments: string }> = []
  const toolResults: Array<{ turn: string; text: string }> = []
  const finalAnswers: Array<{ turn: string; text: string }> = []
  const approvals: string[] = []
  const persistedResults: Array<{ turn: string; messageId: string; parts: unknown }> = []
  const serverErrors: string[] = []
  const server = createServer((request, response) => {
    void (async () => {
      if (request.method === 'GET' && request.url === '/v1/models') {
        response.writeHead(200, { 'Content-Type': 'application/json' })
        response.end(JSON.stringify({ object: 'list', data: [{ id: 'mock-chat', object: 'model' }] }))
        return
      }
      if (request.method !== 'POST' || request.url !== '/v1/chat/completions') {
        response.writeHead(404).end()
        return
      }
      const buffers: Buffer[] = []
      for await (const buffer of request) buffers.push(Buffer.from(buffer))
      const body: ChatRequest = JSON.parse(Buffer.concat(buffers).toString('utf8'))
      requests.push(body)
      const last = body.messages.at(-1)
      const id = `multiroot-${activeTurn.id}-${requests.length}`
      response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' })
      const chunk = (delta: object, finishReason: string | null = null) =>
        response.write(
          `data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created: 1, model: body.model, choices: [{ index: 0, delta, finish_reason: finishReason }] })}\n\n`
        )
      chunk({ role: 'assistant', content: '' })
      if (last?.role === 'tool') {
        const text = typeof last.content === 'string' ? last.content : JSON.stringify(last.content)
        toolResults.push({ turn: activeTurn.id, text })
        const answer = `Filesystem ${activeTurn.id} result: ${text.includes(activeTurn.marker) ? activeTurn.marker : text}`
        finalAnswers.push({ turn: activeTurn.id, text: answer })
        chunk({ content: answer })
        chunk({}, 'stop')
      } else {
        const tool = body.tools?.find(({ function: fn }) => /^mcp__.*__read(?:_|$)/.test(fn.name))
        if (!tool) throw new Error(`${activeTurn.bug}: no filesystem read tool offered`)
        const args = JSON.stringify({ file_path: activeTurn.filePath })
        toolCalls.push({ turn: activeTurn.id, name: tool.function.name, arguments: args })
        chunk({
          tool_calls: [{ index: 0, id, type: 'function', function: { name: tool.function.name, arguments: args } }]
        })
        chunk({}, 'tool_calls')
      }
      response.end('data: [DONE]\n\n')
    })().catch((error: Error) => {
      serverErrors.push(error.message)
      if (!response.headersSent) response.writeHead(500)
      response.end(error.message)
    })
  })
  const dataRequest = (method: 'GET' | 'POST' | 'PATCH', path: string, body?: unknown) =>
    page.evaluate(
      ({ method, path, body }) => window.api.dataApi.request({ id: crypto.randomUUID(), method, path, body }),
      { method, path, body }
    )
  const setupBug = 'A/B/D: configured roots become inaccessible; C: outside paths escape the configured roots'
  try {
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Mock model failed to bind a TCP port')
    await page.route(/^https?:\/\//, (route) => {
      const hostname = new URL(route.request().url()).hostname
      return hostname === '127.0.0.1' || hostname === 'localhost' ? route.continue() : route.abort()
    })
    await page.evaluate(async (policyVersion) => {
      await window.api.preference.set('app.language', 'en-US')
      await window.api.preference.set('app.onboarding.provider_setup.status', 'skipped')
      await window.api.preference.set('app.privacy.policy_version', policyVersion)
      await window.api.preference.set('topic.naming.enabled', false)
      await window.api.preference.set('chat.input.toolbar.pinned_tools', ['composer:new-conversation', 'mcp-status'])
    }, LATEST_PRIVACY_POLICY_VERSION)
    await page.reload()
    await expect(page.locator('[data-ui~="app.shell"]').first(), setupBug).toBeVisible({ timeout: 60_000 })

    const mcp = await dataRequest('POST', '/mcp-servers', {
      name: '@cherry/filesystem',
      type: 'inMemory',
      args: [rootA, rootB],
      isActive: true,
      isTrusted: true
    })
    expect(mcp.status, setupBug).toBe(201)
    const serverId = McpServerSchema.parse(mcp.data).id
    const providerId = `multiroot-smoke-${Date.now()}`
    const assistantName = `Filesystem multi-root ${providerId}`
    const provider = await dataRequest('POST', '/providers', {
      providerId,
      name: 'Multi-root smoke mock',
      defaultChatEndpoint: 'openai-chat-completions',
      endpointConfigs: { 'openai-chat-completions': { baseUrl: `http://127.0.0.1:${address.port}/v1` } },
      apiKeys: [{ id: 'mock-key', key: 'mock-key', isEnabled: true }]
    })
    expect(provider.status, setupBug).toBe(201)
    expect((await dataRequest('PATCH', `/providers/${providerId}`, { isEnabled: true })).status, setupBug).toBe(200)
    const models = await dataRequest('POST', '/models', [
      {
        providerId,
        modelId: 'mock-chat',
        endpointTypes: ['openai-chat-completions'],
        capabilities: ['function-call']
      }
    ])
    expect(models.status, setupBug).toBe(201)
    const assistant = await dataRequest('POST', '/assistants', {
      name: assistantName,
      modelId: createUniqueModelId(providerId, 'mock-chat'),
      mcpServerIds: [serverId]
    })
    expect(assistant.status, setupBug).toBe(201)
    AssistantSchema.parse(assistant.data)

    await page.reload()
    await selectSidebarApp(page, 'Chat')
    await page.setViewportSize({ width: 1280, height: 900 })
    const chatView = page.locator('[data-ui~="chat.view"]:visible')
    await expect(chatView, setupBug).toBeVisible({ timeout: 60_000 })
    const assistantRow = chatView.locator('[data-ui~="chat.group-header"]').filter({ hasText: assistantName }).first()
    await assistantRow.hover()
    await assistantRow.getByRole('button', { name: 'New Chat', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Selected models', exact: true }), setupBug).toContainText(
      'mock-chat'
    )

    for (const turn of turns) {
      await test.step(turn.bug, async () => {
        activeTurn = turn
        if (turn.id === 'B') {
          const reordered = await dataRequest('PATCH', `/mcp-servers/${serverId}`, { args: [rootB, rootA] })
          expect(reordered.status, turn.bug).toBe(200)
        }
        const requestOffset = requests.length
        const composer = page.locator('[data-ui~="chat.composer"]:visible').first()
        await composer.locator('[contenteditable="true"]').first().fill(`Read this file using MCP: ${turn.filePath}`)
        await page.getByRole('button', { name: 'Send', exact: true }).click()
        const allow = page.getByRole('button', { name: 'Allow', exact: true })
        let approvalAppeared = false
        try {
          await allow.waitFor({ state: 'visible', timeout: 5_000 })
          approvalAppeared = true
        } catch (error) {
          if (!(error instanceof errors.TimeoutError)) throw error
        }
        if (approvalAppeared) {
          await allow.click()
          approvals.push(turn.id)
        }
        const messageView = page
          .locator('[data-ui~="chat.message"][data-message-id]:visible')
          .filter({ hasText: `Filesystem ${turn.id} result:` })
          .last()
        await expect(messageView, turn.bug).toBeVisible({ timeout: 60_000 })
        const messageId = await messageView.getAttribute('data-message-id')
        expect(messageId, turn.bug).toBeTruthy()
        await expect
          .poll(
            async () => {
              const response = await dataRequest('GET', `/messages/${messageId}`)
              return MessageSchema.parse(response.data).status
            },
            { message: turn.bug, timeout: 60_000 }
          )
          .toBe('success')
        const response = await dataRequest('GET', `/messages/${messageId}`)
        expect(response.status, turn.bug).toBe(200)
        const message = MessageSchema.parse(response.data)
        persistedResults.push({ turn: turn.id, messageId: message.id, parts: message.data.parts })
        expect(message.data.parts, turn.bug).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              input: { file_path: turn.filePath },
              ...(turn.id === 'C'
                ? { state: 'output-error', errorText: expect.stringContaining(deniedText) }
                : {
                    state: 'output-available',
                    output: expect.objectContaining({
                      content: expect.arrayContaining([
                        expect.objectContaining({ type: 'text', text: expect.stringContaining(turn.marker) })
                      ])
                    })
                  })
            })
          ])
        )
        expect(
          requests
            .slice(requestOffset)
            .some(
              ({ messages }) =>
                messages.at(-1)?.role === 'tool' && JSON.stringify(messages.at(-1)?.content).includes(turn.marker)
            ),
          turn.bug
        ).toBe(true)
        await expect(messageView, turn.bug).toContainText(turn.marker)

        if (turn.screenshot) {
          const process = messageView.getByTestId('completed-process-trigger')
          if ((await process.getAttribute('aria-expanded')) !== 'true') await process.click()
          const group = messageView.getByTestId('child-tool-group').getByRole('button').first()
          if ((await group.getAttribute('aria-expanded')) !== 'true') await group.click()
          const tool = messageView.getByRole('button').filter({ hasText: '@cherry/filesystem : read' }).last()
          if ((await tool.getAttribute('aria-expanded')) !== 'true') await tool.click()
          const toolContent = messageView.getByTestId(/^collapse-content-/)
          await expect(toolContent, turn.bug).toContainText(turn.marker)
          const markerText = toolContent.getByText(turn.marker, { exact: false }).first()
          await expect(markerText, turn.bug).toBeVisible()
          await composer.getByRole('button', { name: 'MCP', exact: true }).click()
          const entry = page.getByTestId('quick-panel').getByRole('button').filter({ hasText: '@cherry/filesystem' })
          await expect(entry, turn.bug).toHaveAttribute('aria-pressed', 'true')
          await expect(entry, turn.bug).toContainText('Connected')
          await entry.scrollIntoViewIfNeeded()
          await page.bringToFront()
          await page.waitForTimeout(250)
          const panelScreenshot = testInfo.outputPath(`${turn.screenshot}-panel.png`)
          await page.screenshot({ path: panelScreenshot })
          await page.keyboard.press('Escape')
          await expect(page.getByTestId('quick-panel'), turn.bug).toBeHidden()
          const box = await page.locator('[data-ui~="chat.composer"]:visible').first().boundingBox()
          await page.mouse.move(box!.x, 300)
          await page.mouse.wheel(0, 900)
          await page.waitForTimeout(400)
          await expect(markerText, turn.bug).toBeInViewport()
          const resultScreenshot = testInfo.outputPath(`${turn.screenshot}-result.png`)
          await page.screenshot({ path: resultScreenshot })
          await testInfo.attach(`${turn.screenshot}-panel`, { path: panelScreenshot, contentType: 'image/png' })
          await testInfo.attach(`${turn.screenshot}-result`, { path: resultScreenshot, contentType: 'image/png' })
        }
      })
    }
  } finally {
    try {
      const payload = {
        offeredToolNames: requests[0]?.tools?.map(({ function: fn }) => fn.name),
        toolCalls,
        toolResults,
        finalAnswers,
        approvals,
        persistedResults,
        requests,
        serverErrors
      }
      const path = testInfo.outputPath('evidence.json')
      await writeFile(path, JSON.stringify(payload, null, 2))
      await testInfo.attach('filesystem-multi-root-evidence', {
        path,
        contentType: 'application/json'
      })
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
        server.closeAllConnections()
      })
    }
  }
})
