import { AgentEntitySchema } from '../../../src/shared/data/api/schemas/agents'
import { AgentSessionMessageEntitySchema } from '../../../src/shared/data/api/schemas/agentSessionMessages'
import { AgentSessionEntitySchema } from '../../../src/shared/data/api/schemas/agentSessions'
import { createUniqueModelId } from '../../../src/shared/data/types/model'
import { startMockChatServer } from '../../helpers/http/mockChatServer'
import { selectAgent } from '../regression/helpers/agents'
import { selectSidebarApp } from '../regression/helpers/navigation'
import { revealVirtualized } from '../regression/helpers/virtualList'
import { expect, test } from './fixtures/electron.fixture'
import { uiLocator } from './utils/uiLocator'

test('a branch reassigned to another runtime shows actionable localized guidance', async ({
  mainWindow: page
}, testInfo) => {
  test.setTimeout(180_000)
  const server = await startMockChatServer()
  const suffix = Date.now()
  const providerId = `branch-mismatch-${suffix}`
  const piName = `Branch mismatch pi ${suffix}`
  const claudeName = `Branch mismatch claude ${suffix}`
  const sessionName = `Branch conversation ${suffix}`

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
            name: 'Branch mismatch mock',
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
    const agents = await page.evaluate(
      async ({ piName, claudeName, model }) => {
        const pi = await window.api.ipcApi.request('ai.agent.create', {
          type: 'pi',
          name: piName,
          model,
          instructions: 'Answer briefly without using tools.'
        })
        const claude = await window.api.ipcApi.request('ai.agent.create', {
          type: 'claude-code',
          name: claudeName,
          model,
          instructions: 'Answer briefly without using tools.'
        })
        return { pi, claude }
      },
      { piName, claudeName, model: createUniqueModelId(providerId, server.modelId) }
    )
    expect(agents.pi).toMatchObject({ ok: true })
    expect(agents.claude).toMatchObject({ ok: true })
    const piAgent = AgentEntitySchema.parse((agents.pi as { data: unknown }).data)
    const claudeAgent = AgentEntitySchema.parse((agents.claude as { data: unknown }).data)
    const created = await page.evaluate(
      ({ agentId, name }) =>
        window.api.dataApi.request({
          id: `branch-session-${name}`,
          method: 'POST',
          path: '/agent-sessions',
          body: { agentId, name, workspace: { type: 'system' } }
        }),
      { agentId: piAgent.id, name: sessionName }
    )
    expect(created.status).toBe(201)
    const session = AgentSessionEntitySchema.parse(created.data)

    const openSession = async (agentName: string) => {
      await page.reload()
      await selectSidebarApp(page, 'Chat')
      await expect(uiLocator(page, 'chat.composer').filter({ visible: true }).first()).toBeVisible()
      await selectAgent(page, agentName)
      const view = uiLocator(page, 'agent.view').filter({ visible: true }).first()
      await expect(view).toBeVisible()
      const group = view.locator('div[class~="group/resource-list-group"]').filter({
        has: page.getByRole('button', { name: agentName, exact: true })
      })
      const expand = group.getByRole('button', { name: 'Expand', exact: true })
      if (await expand.isVisible()) await expand.click()
      const conversation = view.getByTestId('agent-session-row').filter({ hasText: sessionName })
      await revealVirtualized(page, view.locator('[data-virtual-scrolling]').first(), conversation)
      await conversation.click()
      return view
    }
    let view = await openSession(piName)
    const send = async (text: string) => {
      const composer = uiLocator(view, 'chat.composer').filter({ visible: true }).first()
      await composer.locator('[data-ui~="part:composer-input"]').click()
      await composer.locator('[contenteditable="true"]').first().fill(text)
      await view.getByRole('button', { name: 'Send', exact: true }).click()
    }
    const prompt = `Branch runtime first message ${suffix}`
    const marker = `BRANCH_RUNTIME_OK_${suffix}`
    await send(prompt)
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
    expect(matched).toBe(true)
    await expect
      .poll(
        async () => {
          const result = await page.evaluate(
            (sessionId) =>
              window.api.dataApi.request({
                id: `branch-messages-${sessionId}`,
                method: 'GET',
                path: `/agent-sessions/${sessionId}/messages`
              }),
            session.id
          )
          expect(result.status).toBe(200)
          return (result.data as { items: unknown[] }).items
            .map((item) => AgentSessionMessageEntitySchema.parse(item))
            .some(
              (message) =>
                message.role === 'assistant' && message.status === 'success' && JSON.stringify(message).includes(marker)
            )
        },
        { timeout: 30_000 }
      )
      .toBe(true)

    const reassigned = await page.evaluate(
      ({ sessionId, agentId }) =>
        window.api.dataApi.request({
          id: `branch-reassign-${sessionId}`,
          method: 'PATCH',
          path: `/agent-sessions/${sessionId}`,
          body: { agentId }
        }),
      { sessionId: session.id, agentId: claudeAgent.id }
    )
    expect(reassigned.status).toBe(200)
    const reread = await page.evaluate(
      (sessionId) =>
        window.api.dataApi.request({
          id: `branch-read-${sessionId}`,
          method: 'GET',
          path: `/agent-sessions/${sessionId}`
        }),
      session.id
    )
    expect(reread.status).toBe(200)
    expect(AgentSessionEntitySchema.parse(reread.data).agentId).toBe(claudeAgent.id)

    // Reloading the renderer may retain a warm Pi connection; reaching Claude still needs runtime verification.
    view = await openSession(claudeName)
    await send(`Continue branch ${suffix}`)
    await expect(
      page
        .getByText('This conversation branch cannot continue with the current agent settings.', { exact: true })
        .first()
    ).toBeVisible({ timeout: 10_000 })
    await expect(page.getByText('This is not a network problem.').first()).toBeVisible({ timeout: 10_000 })
    await expect(page.getByText('Response interrupted, check network stability or retry')).not.toBeVisible()
    await expect(page.getByText('The selected branch belongs to another runtime backend')).not.toBeVisible()
    const screenshot = testInfo.outputPath('after-error-block.png')
    await page.screenshot({ path: screenshot, fullPage: true })
    await testInfo.attach('after-error-block', { path: screenshot, contentType: 'image/png' })
    const detail = view.getByText('Detail', { exact: true }).first()
    if (await detail.isVisible()) {
      await detail.click()
      const dialog = page.getByRole('dialog').filter({ visible: true }).first()
      await expect(dialog).toBeVisible()
      const detailsScreenshot = testInfo.outputPath('after-error-details.png')
      await page.screenshot({ path: detailsScreenshot, fullPage: true })
      await testInfo.attach('after-error-details', { path: detailsScreenshot, contentType: 'image/png' })
    } else {
      testInfo.annotations.push({
        type: 'details screenshot skipped',
        description: 'No visible Detail control on the error block.'
      })
    }
  } finally {
    await server.close()
  }
})
