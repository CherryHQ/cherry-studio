import { randomUUID } from 'node:crypto'

import { AgentEntitySchema } from '../../../src/shared/data/api/schemas/agents'
import { AgentSessionMessageEntitySchema } from '../../../src/shared/data/api/schemas/agentSessionMessages'
import { AgentSessionEntitySchema } from '../../../src/shared/data/api/schemas/agentSessions'
import { createUniqueModelId } from '../../../src/shared/data/types/model'
import { startMockChatServer } from '../../helpers/http/mockChatServer'
import { selectSidebarApp } from '../regression/helpers/navigation'
import { expect, test } from './fixtures/electron.fixture'
import { uiLocator } from './utils/uiLocator'

test('replayed session_create names the target Agent and preserves same-Agent context', async ({
  mainWindow: page
}, testInfo) => {
  test.setTimeout(120_000)
  expect(process.env.CS_DEV_PROFILE_ROOT, 'Run with an isolated CS_DEV_PROFILE_ROOT').toBeTruthy()
  const server = await startMockChatServer()
  const suffix = randomUUID()
  const providerId = `session-create-smoke-${suffix}`
  const providerName = `Session create provider ${suffix}`
  const parentAgentName = `Delegating agent ${suffix}`
  const targetAgentName = `Scripts agent ${suffix}`
  const parentSessionName = `DNS review ${suffix}`
  const sessionTitle = `DNS sub-agent audit ${suffix}`
  let parentAgentId: string | undefined
  let targetAgentId: string | undefined
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
    const parentCreated = await page.evaluate(
      ({ name, model }) =>
        window.api.ipcApi.request('ai.agent.create', {
          type: 'pi',
          name,
          model,
          instructions: 'Answer briefly without using tools.'
        }),
      { name: parentAgentName, model: createUniqueModelId(providerId, server.modelId) }
    )
    expect(parentCreated).toMatchObject({ ok: true })
    const parentAgent = AgentEntitySchema.parse((parentCreated as { data: unknown }).data)
    parentAgentId = parentAgent.id
    const targetCreated = await page.evaluate(
      ({ name, model }) =>
        window.api.ipcApi.request('ai.agent.create', {
          type: 'pi',
          name,
          model,
          instructions: 'Answer briefly without using tools.'
        }),
      { name: targetAgentName, model: createUniqueModelId(providerId, server.modelId) }
    )
    expect(targetCreated).toMatchObject({ ok: true })
    const targetAgent = AgentEntitySchema.parse((targetCreated as { data: unknown }).data)
    targetAgentId = targetAgent.id
    const parentSessionResponse = await page.evaluate(
      ({ agentId, name }) =>
        window.api.dataApi.request({
          id: `session-create-session-${name}`,
          method: 'POST',
          path: '/agent-sessions',
          body: { agentId, name, workspace: { type: 'system' } }
        }),
      { agentId: parentAgent.id, name: parentSessionName }
    )
    expect(parentSessionResponse.status).toBe(201)
    const parentSession = AgentSessionEntitySchema.parse(parentSessionResponse.data)
    const targetSessionResponse = await page.evaluate(
      ({ agentId, name }) =>
        window.api.dataApi.request({
          id: `session-create-session-${name}`,
          method: 'POST',
          path: '/agent-sessions',
          body: { agentId, name, workspace: { type: 'system' } }
        }),
      { agentId: targetAgent.id, name: sessionTitle }
    )
    expect(targetSessionResponse.status).toBe(201)
    const targetSession = AgentSessionEntitySchema.parse(targetSessionResponse.data)

    const openSession = async () => {
      await page.reload()
      await selectSidebarApp(page, 'Chat')
      await expect(uiLocator(page, 'chat.composer').filter({ visible: true }).first()).toBeVisible()
      await selectSidebarApp(page, 'Work')
      const view = uiLocator(page, 'agent.view').filter({ visible: true }).first()
      await expect(view).toBeVisible()
      const agentHeader = view.getByText(parentAgentName, { exact: true }).first()
      await agentHeader.click()
      const conversation = view.getByText(parentSessionName, { exact: true }).first()
      if (!(await conversation.isVisible())) {
        await agentHeader.hover()
        const groupHeader = view.getByRole('button', { name: parentAgentName, exact: true }).first()
        await groupHeader.locator('..').getByRole('button', { name: 'Expand', exact: true }).click()
      }
      await conversation.click()
      return view
    }
    const view = await openSession()
    const prompt = `Session create replay request ${suffix}`
    const marker = `SESSION_CREATE_REPLAY_READY_${suffix}`
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
                id: `session-create-messages-${sessionId}`,
                method: 'GET',
                path: `/agent-sessions/${sessionId}/messages`
              }),
            parentSession.id
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

    for (const receiver of [
      { agentId: targetAgent.id, sessionId: targetSession.id, agentName: targetAgentName },
      { agentId: parentAgent.id, sessionId: parentSession.id, agentName: parentAgentName }
    ]) {
      const replay = await page.evaluate(
        async ({
          sessionId,
          messageId,
          parentAgentId,
          parentAgentName,
          parentSessionName,
          sessionTitle,
          receiver,
          marker
        }) => {
          const path = `/agent-sessions/${sessionId}/messages/${messageId}`
          const original = await window.api.dataApi.request({ id: `${messageId}-read`, method: 'GET', path })
          if (original.status !== 200) throw new Error(`Message read failed: ${original.status}`)
          const message = original.data as { role: string; data: Record<string, unknown> }
          if (message.role !== 'assistant') throw new Error('Replay requires an assistant message')
          const metadata = { type: 'mcp', name: 'session_create', serverId: 'cherry-tools', serverName: 'cherry-tools' }
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
                    toolCallId: 'session-create-1',
                    toolName: 'mcp__cherry-tools__session_create',
                    providerExecuted: true,
                    state: 'output-available',
                    input: { title: sessionTitle, message: 'Audit the UDP listener and DNS resolver path.' },
                    callProviderMetadata: { cherry: { transport: 'agent', tool: metadata } },
                    output: {
                      content: JSON.stringify({
                        ok: true,
                        agentId: receiver.agentId,
                        sessionId: receiver.sessionId,
                        requestId: 'request-1',
                        delivery: {
                          version: 1,
                          sender: { agentId: parentAgentId, sessionId },
                          receiver: { agentId: receiver.agentId, sessionId: receiver.sessionId },
                          senderSnapshot: { agentName: parentAgentName, sessionName: parentSessionName },
                          receiverSnapshot: { agentName: receiver.agentName, sessionName: sessionTitle },
                          replyPolicy: 'completion',
                          sourceMessageId: null,
                          outcome: null,
                          error: null,
                          statusAt: new Date().toISOString(),
                          status: 'accepted'
                        }
                      })
                    }
                  },
                  { type: 'text', text: `${marker}: Review the session creation card above.` }
                ]
              }
            }
          })
        },
        {
          sessionId: parentSession.id,
          messageId: messageId!,
          parentAgentId: parentAgent.id,
          parentAgentName,
          parentSessionName,
          sessionTitle,
          receiver,
          marker
        }
      )
      expect(replay.status).toBe(200)
      const reopened = await openSession()
      const card = uiLocator(reopened, 'chat.message').filter({ hasText: marker })
      await expect(card).toBeVisible()
      const crossAgent = receiver.agentId !== parentAgent.id
      const targetLabel = crossAgent ? `${targetAgentName} / ${sessionTitle}` : sessionTitle
      await expect(card.getByText(targetLabel, { exact: true }).first()).toBeVisible()
      await expect(card.getByRole('button', { name: `Open session: ${targetLabel}`, exact: true })).toBeVisible()
      await expect(card.getByText(`${marker}: Review the session creation card above.`)).toBeVisible()
      if (crossAgent) {
        await expect(card.getByText('Using this agent and workspace')).toHaveCount(0)
        const path = testInfo.outputPath('session-create-cross-agent.png')
        await card.scrollIntoViewIfNeeded()
        await page.bringToFront()
        await page.waitForTimeout(300)
        await page.screenshot({ path })
        await testInfo.attach('session-create-cross-agent', { path, contentType: 'image/png' })
      } else {
        await expect(card.getByText(targetAgentName)).toHaveCount(0)
        await expect(card.getByRole('button', { name: `Open session: ${targetAgentName}`, exact: false })).toHaveCount(
          0
        )
        const path = testInfo.outputPath('session-create-same-agent.png')
        await card.scrollIntoViewIfNeeded()
        await page.bringToFront()
        await page.waitForTimeout(300)
        await page.screenshot({ path })
        await testInfo.attach('session-create-same-agent', { path, contentType: 'image/png' })
      }
    }
  } finally {
    try {
      try {
        if (parentAgentId) {
          const deleted = await page.evaluate(
            (agentId) =>
              window.api.ipcApi.request('ai.agent.delete_permanently', {
                agentId,
                deleteSessions: true
              }),
            parentAgentId
          )
          expect(deleted).toMatchObject({ ok: true, data: { deleted: true } })
        }
      } finally {
        if (targetAgentId) {
          const deleted = await page.evaluate(
            (agentId) =>
              window.api.ipcApi.request('ai.agent.delete_permanently', {
                agentId,
                deleteSessions: true
              }),
            targetAgentId
          )
          expect(deleted).toMatchObject({ ok: true, data: { deleted: true } })
        }
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
