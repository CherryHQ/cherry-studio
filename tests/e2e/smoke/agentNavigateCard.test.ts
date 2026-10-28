import { randomUUID } from 'node:crypto'

import { AgentEntitySchema } from '../../../src/shared/data/api/schemas/agents'
import { AgentSessionMessageEntitySchema } from '../../../src/shared/data/api/schemas/agentSessionMessages'
import { AgentSessionEntitySchema } from '../../../src/shared/data/api/schemas/agentSessions'
import { createUniqueModelId } from '../../../src/shared/data/types/model'
import { startMockChatServer } from '../../helpers/http/mockChatServer'
import { selectSidebarApp } from '../regression/navigation'
import { expect, test } from './fixtures/electron.fixture'
import { uiLocator } from './utils/uiLocator'

test('replayed Claude Agent navigate result stays visible and opens the selected provider', async ({
  mainWindow: page
}, testInfo) => {
  test.setTimeout(120_000)
  expect(process.env.CS_DEV_PROFILE_ROOT, 'Run with an isolated CS_DEV_PROFILE_ROOT').toBeTruthy()
  const server = await startMockChatServer()
  const suffix = randomUUID()
  const providerId = `navigate-smoke-${suffix}`
  const providerName = `Navigate provider ${suffix}`
  const agentName = `Navigate agent ${suffix}`
  const sessionName = `Navigate session ${suffix}`
  let agentId: string | undefined
  let previousNaming: boolean | undefined

  try {
    const languageSelect = page.locator('[data-onboarding-language-select]')
    await expect(uiLocator(page, 'chat.composer').or(languageSelect).filter({ visible: true }).first()).toBeVisible()
    if (await languageSelect.isVisible()) {
      await languageSelect.getByRole('combobox').click()
      await page.getByRole('option', { name: 'English', exact: false }).click()
      await page.getByRole('button', { name: 'Set up later', exact: true }).click()
    }
    await selectSidebarApp(page, 'Chat')
    previousNaming = await page.evaluate(() => window.api.preference.get('topic.naming.enabled'))
    await page.evaluate(() => window.api.preference.set('topic.naming.enabled', false))
    const provider = await page.evaluate(
      ({ providerId, name, baseUrl }) =>
        window.api.dataApi.request({
          id: `${providerId}-create`,
          method: 'POST',
          path: '/providers',
          body: {
            providerId,
            name,
            defaultChatEndpoint: 'openai-chat-completions',
            endpointConfigs: { 'openai-chat-completions': { baseUrl } },
            apiKeys: [{ id: 'mock-key', key: 'mock-key', isEnabled: true }]
          }
        }),
      { providerId, name: providerName, baseUrl: server.baseUrl }
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
      ({ providerId, modelId }) =>
        window.api.dataApi.request({
          id: `${providerId}-model`,
          method: 'POST',
          path: '/models',
          body: [{ providerId, modelId, endpointTypes: ['openai-chat-completions'] }]
        }),
      { providerId, modelId: server.modelId }
    )
    expect(models.status).toBe(201)
    const created = await page.evaluate(
      ({ name, model }) =>
        window.api.ipcApi.request('ai.agent.create', {
          type: 'pi',
          name,
          model,
          instructions: 'Answer briefly without using tools.'
        }),
      { name: agentName, model: createUniqueModelId(providerId, server.modelId) }
    )
    expect(created).toMatchObject({ ok: true })
    const agent = AgentEntitySchema.parse((created as { data: unknown }).data)
    agentId = agent.id
    const sessionResponse = await page.evaluate(
      ({ agentId, name }) =>
        window.api.dataApi.request({
          id: `navigate-session-${name}`,
          method: 'POST',
          path: '/agent-sessions',
          body: { agentId, name, workspace: { type: 'system' } }
        }),
      { agentId, name: sessionName }
    )
    expect(sessionResponse.status).toBe(201)
    const session = AgentSessionEntitySchema.parse(sessionResponse.data)

    const openSession = async () => {
      await page.reload()
      await selectSidebarApp(page, 'Chat')
      await expect(uiLocator(page, 'chat.composer').filter({ visible: true }).first()).toBeVisible()
      await selectSidebarApp(page, 'Work')
      const view = uiLocator(page, 'agent.view').filter({ visible: true }).first()
      await expect(view).toBeVisible()
      const agentHeader = view.getByText(agentName, { exact: true }).first()
      await agentHeader.click()
      const conversation = view.getByText(sessionName, { exact: true }).first()
      if (!(await conversation.isVisible())) {
        await agentHeader.hover()
        const groupHeader = view.getByRole('button', { name: agentName, exact: true }).first()
        await groupHeader.locator('..').getByRole('button', { name: 'Expand', exact: true }).click()
      }
      await conversation.click()
      return view
    }
    const view = await openSession()
    const prompt = `Navigate replay request ${suffix}`
    const marker = `NAVIGATE_REPLAY_READY_${suffix}`
    const composer = uiLocator(view, 'chat.composer').filter({ visible: true }).first()
    await composer.locator('[data-ui~="part:composer-input"]').click()
    await composer.locator('[contenteditable="true"]').first().fill(prompt)
    await view.getByRole('button', { name: 'Send', exact: true }).click()
    let matched = false
    const deadline = Date.now() + 30_000
    while (!matched && Date.now() < deadline) {
      const request = await server.nextRequest(Math.max(1, deadline - Date.now()))
      matched =
        request.body.model === server.modelId &&
        request.body.messages.some((message) => {
          const value = message as { role?: string; content?: unknown }
          return value.role === 'user' && JSON.stringify(value.content).includes(prompt)
        })
      request.complete(matched ? marker : 'Background request complete')
    }
    expect(matched, 'The intended conversation must reach the local mock provider').toBe(true)
    await expect(uiLocator(view, 'chat.message').filter({ hasText: marker })).toBeVisible({ timeout: 30_000 })
    await expect(view.getByRole('button', { name: 'Send', exact: true })).toBeVisible()
    let messageId: string | undefined
    await expect
      .poll(
        async () => {
          const response = await page.evaluate(
            (sessionId) =>
              window.api.dataApi.request({
                id: `navigate-messages-${sessionId}`,
                method: 'GET',
                path: `/agent-sessions/${sessionId}/messages`
              }),
            session.id
          )
          expect(response.status).toBe(200)
          const messages = (response.data as { items: unknown[] }).items.map((item) =>
            AgentSessionMessageEntitySchema.parse(item)
          )
          messageId = messages.find(
            (message) =>
              message.role === 'assistant' &&
              message.status === 'success' &&
              JSON.stringify(message.data).includes(marker)
          )?.id
          return messageId
        },
        { timeout: 15_000 }
      )
      .toBeTruthy()

    const replay = await page.evaluate(
      async ({ sessionId, messageId, providerId, marker }) => {
        const path = `/agent-sessions/${sessionId}/messages/${messageId}`
        const original = await window.api.dataApi.request({ id: `${messageId}-read`, method: 'GET', path })
        if (original.status !== 200) throw new Error(`Message read failed: ${original.status}`)
        const message = original.data as { role: string; data: Record<string, unknown> }
        if (message.role !== 'assistant') throw new Error('Replay requires an assistant message')
        const metadata = { type: 'mcp', name: 'navigate', serverId: 'assistant', serverName: 'assistant' }
        return window.api.dataApi.request({
          id: `${messageId}-replay`,
          method: 'PATCH',
          path,
          body: {
            data: {
              ...message.data,
              parts: [
                {
                  type: 'dynamic-tool',
                  toolCallId: 'navigate-1',
                  toolName: 'mcp__assistant__navigate',
                  providerExecuted: true,
                  state: 'output-available',
                  input: { path: '/settings/provider', query: { id: providerId } },
                  callProviderMetadata: { cherry: { transport: 'claude-agent', tool: metadata } },
                  output: { content: `Navigate link created: /settings/provider?id=${providerId}`, metadata }
                },
                { type: 'text', text: `${marker}: Click the navigation button above.` }
              ]
            }
          }
        })
      },
      { sessionId: session.id, messageId: messageId!, providerId, marker }
    )
    expect(replay.status).toBe(200)
    const reopened = await openSession()
    const assistant = uiLocator(reopened, 'chat.message').filter({ hasText: marker })
    const button = assistant.getByRole('button', { name: '🔑 Model Provider ✓', exact: true })
    await expect(button).toBeVisible()
    await expect(button).toHaveCount(1)
    // A direct result can omit the empty history altogether; any history must stay collapsed.
    await expect(assistant.locator('[data-testid="completed-process-trigger"][aria-expanded="true"]')).toHaveCount(0)
    const before = testInfo.outputPath('agent-navigate-card.png')
    await page.screenshot({ path: before })
    await testInfo.attach('agent-navigate-card', { path: before, contentType: 'image/png' })
    await button.click()
    await expect(page.getByRole('heading', { name: providerName, exact: true })).toBeVisible()
    await expect
      .poll(() =>
        page.evaluate(() => {
          const raw = localStorage.getItem('cs_cache_persist')
          return raw ? (JSON.parse(raw)['settings.provider.last_selected_provider_id'] ?? null) : null
        })
      )
      .toBe(providerId)
    const after = testInfo.outputPath('agent-navigate-provider-settings.png')
    await page.screenshot({ path: after })
    await testInfo.attach('agent-navigate-provider-settings', { path: after, contentType: 'image/png' })
  } finally {
    try {
      if (agentId) {
        const deleted = await page.evaluate(
          (agentId) =>
            window.api.ipcApi.request('ai.agent.delete_permanently', {
              agentId,
              deleteSessions: true
            }),
          agentId
        )
        expect(deleted).toMatchObject({ ok: true, data: { deleted: true } })
      }
    } finally {
      try {
        const deleted = await page.evaluate(
          (providerId) =>
            window.api.dataApi.request({
              id: `${providerId}-cleanup`,
              method: 'DELETE',
              path: `/providers/${providerId}`
            }),
          providerId
        )
        expect([200, 204, 404]).toContain(deleted.status)
        if (previousNaming !== undefined)
          await page.evaluate((value) => window.api.preference.set('topic.naming.enabled', value), previousNaming)
      } finally {
        await server.close()
      }
    }
  }
})
