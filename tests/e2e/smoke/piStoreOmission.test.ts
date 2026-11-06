import { randomUUID } from 'node:crypto'
import { writeFile } from 'node:fs/promises'

import { _electron as electron } from '@playwright/test'

import { AgentEntitySchema } from '../../../src/shared/data/api/schemas/agents'
import { AgentSessionMessageEntitySchema } from '../../../src/shared/data/api/schemas/agentSessionMessages'
import { AgentSessionEntitySchema } from '../../../src/shared/data/api/schemas/agentSessions'
import { createUniqueModelId } from '../../../src/shared/data/types/model'
import { LATEST_PRIVACY_POLICY_VERSION } from '../../../src/shared/utils/constants'
import { startMockChatServer } from '../../helpers/http/mockChatServer'
import { selectSidebarApp } from '../regression/navigation'
import { expect, test as base } from './fixtures/electron.fixture'
import { uiLocator } from './utils/uiLocator'

const test = base.extend({
  electronApp: async ({}, use, testInfo) => {
    const electronApp = await electron.launch({
      args: ['.'],
      env: { ...process.env, NODE_ENV: 'development', CS_DEV_PROFILE_ROOT: testInfo.outputPath('profile') },
      timeout: 60000
    })
    await use(electronApp)
    await electronApp.close()
  }
})

test('Work sends custom Pi chat without store to a strict endpoint', async ({ mainWindow: page }, testInfo) => {
  test.setTimeout(120_000)
  const server = await startMockChatServer({ rejectOwnStore: true })
  const providerId = randomUUID()
  const agentName = `Store agent ${providerId}`
  const sessionName = `Store session ${providerId}`
  const prompt = `Store omission prompt ${providerId}`
  const marker = `STORE_OMISSION_OK_${providerId}`
  try {
    await page.evaluate(async (version) => {
      await window.api.preference.set('app.privacy.policy_version', version)
      await window.api.preference.set('app.onboarding.provider_setup.status', 'skipped')
      await window.api.preference.set('app.language', 'en-US')
    }, LATEST_PRIVACY_POLICY_VERSION)
    await page.reload()
    await selectSidebarApp(page, 'Chat')
    await expect(page.locator('[data-ui~="app.shell"]').first()).toBeVisible()
    await page.evaluate(() => window.api.preference.set('topic.naming.enabled', false))
    const provider = await page.evaluate(
      ({ providerId, baseUrl }) =>
        window.api.dataApi.request({
          id: 'store-provider',
          method: 'POST',
          path: '/providers',
          body: {
            providerId,
            name: 'Strict fixture',
            defaultChatEndpoint: 'openai-chat-completions',
            endpointConfigs: { 'openai-chat-completions': { baseUrl } },
            apiKeys: [{ id: 'mock-key', key: 'mock-key', isEnabled: true }]
          }
        }),
      { providerId, baseUrl: server.baseUrl }
    )
    expect(provider.status).toBe(201)
    const enabled = await page.evaluate(
      (id) =>
        window.api.dataApi.request({
          id: 'store-enable',
          method: 'PATCH',
          path: `/providers/${id}`,
          body: { isEnabled: true }
        }),
      providerId
    )
    expect(enabled.status).toBe(200)
    const models = await page.evaluate(
      (providerId) =>
        window.api.dataApi.request({
          id: 'store-model',
          method: 'POST',
          path: '/models',
          body: [{ providerId, modelId: 'glm', endpointTypes: ['openai-chat-completions'] }]
        }),
      providerId
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
      { name: agentName, model: createUniqueModelId(providerId, 'glm') }
    )
    expect(created).toMatchObject({ ok: true })
    const agent = AgentEntitySchema.parse((created as { data: unknown }).data)
    expect(agent.type).toBe('pi')
    const response = await page.evaluate(
      ({ agentId, name }) =>
        window.api.dataApi.request({
          id: 'store-session',
          method: 'POST',
          path: '/agent-sessions',
          body: { agentId, name, workspace: { type: 'system' } }
        }),
      { agentId: agent.id, name: sessionName }
    )
    expect(response.status).toBe(201)
    const session = AgentSessionEntitySchema.parse(response.data)
    await page.reload()
    await selectSidebarApp(page, 'Chat')
    await selectSidebarApp(page, 'Work')
    const view = uiLocator(page, 'agent.view').filter({ visible: true }).first()
    await expect(view).toBeVisible()
    const header = view.getByText(agentName, { exact: true }).first()
    await header.click()
    const conversation = view.getByText(sessionName, { exact: true }).first()
    if (!(await conversation.isVisible())) {
      await header.hover()
      await view
        .getByRole('button', { name: agentName, exact: true })
        .first()
        .locator('..')
        .getByRole('button', { name: 'Expand', exact: true })
        .click()
    }
    await conversation.click()
    const composer = uiLocator(view, 'chat.composer').filter({ visible: true }).first()
    await composer.locator('[contenteditable="true"]').first().fill(prompt)
    await view.getByRole('button', { name: 'Send', exact: true }).click()
    const request = await server.nextRequest(30_000)
    expect(request.url.endsWith('/v1/chat/completions')).toBe(true)
    expect(request.method).toBe('POST')
    expect(Object.hasOwn(request.body, 'store'), 'custom Pi chat must not send an own store key').toBe(false)
    expect(String(request.body.model)).toContain('glm')
    expect(JSON.stringify(request.body.messages)).toContain(prompt)
    request.complete(marker)
    await expect(uiLocator(view, 'chat.message').filter({ hasText: marker })).toBeVisible({ timeout: 30_000 })
    await expect(view.getByRole('button', { name: 'Send', exact: true })).toBeVisible()
    await expect
      .poll(
        async () => {
          const result = await page.evaluate(
            (id) =>
              window.api.dataApi.request({
                id: 'store-messages',
                method: 'GET',
                path: `/agent-sessions/${id}/messages`
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
        { timeout: 15_000 }
      )
      .toBe(true)
    await page.bringToFront()
    await page.waitForTimeout(250)
    const shot = testInfo.outputPath('pi-store-omission.png')
    await page.screenshot({ path: shot })
    await testInfo.attach('pi-store-omission', { path: shot, contentType: 'image/png' })
    const capture = testInfo.outputPath('captured-request.json')
    await writeFile(
      capture,
      JSON.stringify(
        {
          url: request.url,
          method: request.method,
          keys: Object.keys(request.body),
          storePresent: Object.hasOwn(request.body, 'store'),
          model: request.body.model
        },
        null,
        2
      )
    )
    await testInfo.attach('captured-request', { path: capture, contentType: 'application/json' })
  } finally {
    await server.close()
  }
})
