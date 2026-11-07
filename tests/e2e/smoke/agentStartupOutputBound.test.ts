import { writeFile } from 'node:fs/promises'

import { AgentEntitySchema } from '../../../src/shared/data/api/schemas/agents'
import { AgentSessionEntitySchema } from '../../../src/shared/data/api/schemas/agentSessions'
import { createUniqueModelId } from '../../../src/shared/data/types/model'
import { startMockChatServer } from '../../helpers/http/mockChatServer'
import { selectSidebarApp } from '../regression/helpers/navigation'
import { expect, test } from './fixtures/electron.fixture'
import { uiLocator } from './utils/uiLocator'

test('Agent turns fail visibly when headers arrive without meaningful output', async ({
  mainWindow: page
}, testInfo) => {
  test.setTimeout(240_000)
  expect(process.env.CS_DEV_PROFILE_ROOT, 'Run with an isolated CS_DEV_PROFILE_ROOT').toBeTruthy()
  const server = await startMockChatServer()
  const providerId = `startup-timeout-smoke-${Date.now()}`
  const agentName = `Startup timeout smoke ${Date.now()}`
  let requestCount = 0
  let monitoring: Promise<void> | undefined

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
            name: 'Startup timeout smoke mock',
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

    const name = `Startup timeout session ${providerId}`
    const response = await page.evaluate(
      ({ agentId, name }) =>
        window.api.dataApi.request({
          id: `startup-timeout-session-${name}`,
          method: 'POST',
          path: '/agent-sessions',
          body: { agentId, name, workspace: { type: 'system' } }
        }),
      { agentId: agent.id, name }
    )
    expect(response.status).toBe(201)
    AgentSessionEntitySchema.parse(response.data)

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

    const prompt = `Hold this request without output ${providerId}`
    const composer = uiLocator(view, 'chat.composer').filter({ visible: true }).first()
    await composer.locator('[data-ui~="part:composer-input"]').click()
    await composer.locator('[contenteditable="true"]').first().fill(prompt)
    const startedAt = Date.now()
    await view.getByRole('button', { name: 'Send', exact: true }).click()
    const request = await server.nextRequest(30_000)
    requestCount += 1
    expect(request.body.model).toBe(server.modelId)
    expect(request.body.stream).toBe(true)
    expect(request.body.messages).toEqual(
      expect.arrayContaining([expect.objectContaining({ role: 'user', content: expect.anything() })])
    )
    expect(
      request.body.messages.some((message) => {
        const value = message as { role?: string; content?: unknown }
        return value.role === 'user' && JSON.stringify(value.content).includes(prompt)
      }),
      'The intended prompt must reach the mock provider'
    ).toBe(true)

    // Watch throughout the held request so even a retry that closes early is counted.
    monitoring = server.nextRequest(200_000).then(
      () => {
        requestCount += 1
      },
      () => {}
    )
    const failure = view.getByText('Request timed out', { exact: true })
    await expect(failure).toBeVisible({ timeout: 180_000 })
    const elapsedMs = Date.now() - startedAt
    const errorText = await failure.innerText()
    await expect(view.getByText('Preparing response', { exact: true })).toHaveCount(0)
    await expect(view.getByRole('button', { name: 'Send', exact: true })).toBeVisible()
    // An empty composer disables Send; an unsent draft verifies manual recovery without retrying.
    await composer.locator('[contenteditable="true"]').first().fill('Manual recovery remains available')
    await expect(view.getByRole('button', { name: 'Send', exact: true })).toBeEnabled()

    const settledAt = Date.now()
    await expect
      .poll(
        () => {
          expect(requestCount, 'No automatic inference retry after timeout').toBe(1)
          return Date.now() - settledAt
        },
        { timeout: 10_000, intervals: [250, 500, 1_000] }
      )
      .toBeGreaterThanOrEqual(5_000)
    await expect(server.nextRequest(1_000)).rejects.toThrow('Timed out waiting for a mock chat request')
    expect(requestCount).toBe(1)

    const screenshot = testInfo.outputPath('agent-startup-timeout.png')
    await page.screenshot({ path: screenshot, fullPage: true })
    await writeFile(
      testInfo.outputPath('agent-startup-timeout.json'),
      JSON.stringify({ requestCount, errorText, elapsedMs }, null, 2)
    )
    await testInfo.attach('agent-startup-timeout', { path: screenshot, contentType: 'image/png' })
  } finally {
    await server.close()
    await monitoring
  }
})
