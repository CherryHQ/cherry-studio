import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'

import { AgentEntitySchema } from '../../../src/shared/data/api/schemas/agents'
import { AgentSessionMessageEntitySchema } from '../../../src/shared/data/api/schemas/agentSessionMessages'
import { AgentSessionEntitySchema } from '../../../src/shared/data/api/schemas/agentSessions'
import { createUniqueModelId } from '../../../src/shared/data/types/model'
import { startMockChatServer } from '../../helpers/http/mockChatServer'
import { selectSidebarApp } from '../regression/navigation'
import { expect, test } from './fixtures/electron.fixture'
import { uiLocator } from './utils/uiLocator'

test('pi prewarm materializes fresh system workspaces before the first message', async ({
  mainWindow: page
}, testInfo) => {
  test.setTimeout(120_000)
  const profile = process.env.CS_DEV_PROFILE_ROOT
  expect(profile, 'Run with an isolated CS_DEV_PROFILE_ROOT').toBeTruthy()
  const systemRoot = path.join(profile!, 'userData', 'Data', 'Agents', 'system')
  const server = await startMockChatServer()
  const providerId = `workspace-smoke-${Date.now()}`
  const agentName = `Workspace smoke ${Date.now()}`
  const sessionIds: string[] = []

  try {
    const languageSelect = page.locator('[data-onboarding-language-select]')
    await expect(uiLocator(page, 'chat.composer').or(languageSelect).filter({ visible: true }).first()).toBeVisible()
    if (await languageSelect.isVisible()) {
      await languageSelect.getByRole('combobox').click()
      await page.getByRole('option', { name: 'English', exact: false }).click()
      await page.getByRole('button', { name: 'Set up later', exact: true }).click()
    }
    await selectSidebarApp(page, 'Chat')
    await page.evaluate(() => window.api.preference.set('topic.naming.enabled', false))
    const provider = await page.evaluate(
      ({ providerId, baseUrl }) =>
        window.api.dataApi.request({
          id: `${providerId}-create`,
          method: 'POST',
          path: '/providers',
          body: {
            providerId,
            name: 'Workspace smoke mock',
            defaultChatEndpoint: 'openai-chat-completions',
            endpointConfigs: { 'openai-chat-completions': { baseUrl } },
            apiKeys: [{ id: 'mock-key', key: 'mock-key', isEnabled: true }]
          }
        }),
      { providerId, baseUrl: server.baseUrl }
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
    // Agent creation owns filesystem effects and therefore lives on IpcApi, not DataApi.
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

    for (const index of [0, 1]) {
      await selectSidebarApp(page, 'Chat')
      const name = `Workspace warmup ${index} ${providerId}`
      const response = await page.evaluate(
        ({ agentId, name }) =>
          window.api.dataApi.request({
            id: `workspace-session-${name}`,
            method: 'POST',
            path: '/agent-sessions',
            body: { agentId, name, workspace: { type: 'system' } }
          }),
        { agentId: agent.id, name }
      )
      expect(response.status).toBe(201)
      const session = AgentSessionEntitySchema.parse(response.data)
      sessionIds.push(session.id)
      const date = path.basename(path.dirname(session.workspace.path))
      expect(date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      const expectedPath = path.join(systemRoot, date, session.id)
      expect(session.workspace.type).toBe('system')
      expect(path.resolve(session.workspace.path)).toBe(expectedPath)
      expect(existsSync(expectedPath), 'Leaf must be absent before opening the conversation').toBe(false)
      expect(existsSync(path.dirname(expectedPath)), 'First date parent absent; second parent already exists').toBe(
        index === 1
      )

      await page.reload()
      await selectSidebarApp(page, 'Chat')
      await expect(uiLocator(page, 'chat.composer').filter({ visible: true }).first()).toBeVisible()
      await selectSidebarApp(page, 'Work')
      const view = uiLocator(page, 'agent.view').filter({ visible: true }).first()
      await expect(view).toBeVisible()
      const agentHeader = view.getByText(agentName, { exact: true }).first()
      await agentHeader.click()
      const conversation = view.getByText(name, { exact: true }).first()
      if (!(await conversation.isVisible())) {
        await agentHeader.hover()
        const groupHeader = view.getByRole('button', { name: agentName, exact: true }).first()
        await groupHeader.locator('..').getByRole('button', { name: 'Expand', exact: true }).click()
      }
      await conversation.click()
      await expect
        .poll(() => existsSync(expectedPath) && statSync(expectedPath).isDirectory(), {
          timeout: 20_000,
          message: 'Prewarm must create the concrete workspace before any message is sent'
        })
        .toBe(true)

      const prompt = `Workspace smoke request ${index} ${providerId}`
      const marker = `WORKSPACE_WARMUP_OK_${index}_${providerId}`
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
      expect(matched, 'The intended conversation must reach the mock provider').toBe(true)
      const assistant = uiLocator(view, 'chat.message').filter({ hasText: marker })
      await expect(assistant).toBeVisible({ timeout: 30_000 })
      await expect(view.getByRole('button', { name: 'Send', exact: true })).toBeVisible()
      await expect
        .poll(
          async () => {
            const result = await page.evaluate(
              (sessionId) =>
                window.api.dataApi.request({
                  id: `workspace-messages-${sessionId}`,
                  method: 'GET',
                  path: `/agent-sessions/${sessionId}/messages`
                }),
              session.id
            )
            expect(result.status).toBe(200)
            const messages = result.data as { items: unknown[] }
            return messages.items
              .map((item) => AgentSessionMessageEntitySchema.parse(item))
              .some(
                (message) =>
                  message.role === 'assistant' &&
                  message.status === 'success' &&
                  JSON.stringify(message).includes(marker)
              )
          },
          { timeout: 15_000 }
        )
        .toBe(true)
    }

    // Supplementary: fixture teardown happens later, so this only excludes failures flushed so far.
    // The directory assertion before sending is the decisive prewarm check.
    const logRoot = path.join(profile!, 'logs')
    const logFiles = readdirSync(logRoot).filter((name) => /^app\..*\.log$/.test(name))
    expect(logFiles.length).toBeGreaterThan(0)
    for (const file of logFiles) {
      const log = readFileSync(path.join(logRoot, file), 'utf8')
      for (const warning of log.split('\n')) {
        if (sessionIds.some((id) => warning.includes(id))) {
          expect(warning).not.toContain('Failed to prime agent session connection')
          expect(warning).not.toContain('Failed to re-prime agent session connection')
        }
      }
    }
    const screenshot = testInfo.outputPath('agent-workspace-warmup.png')
    await page.screenshot({ path: screenshot })
    await testInfo.attach('agent-workspace-warmup', { path: screenshot, contentType: 'image/png' })
  } finally {
    await server.close()
  }
})
