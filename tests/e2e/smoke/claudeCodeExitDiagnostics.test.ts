import { randomUUID } from 'node:crypto'
import { rm } from 'node:fs/promises'

import { _electron as electron } from '@playwright/test'

import {
  createClaudeCodeProcessDiagnostics,
  recordClaudeCodeProcessExit,
  createClaudeCodeProcessExitError
} from '../../../src/main/ai/runtime/claudeCode/processExitDiagnostics'
import { serializeError } from '../../../src/main/ai/utils/serializeError'
import { AgentEntitySchema } from '../../../src/shared/data/api/schemas/agents'
import { AgentSessionMessageEntitySchema } from '../../../src/shared/data/api/schemas/agentSessionMessages'
import { AgentSessionEntitySchema } from '../../../src/shared/data/api/schemas/agentSessions'
import { createUniqueModelId } from '../../../src/shared/data/types/model'
import { LATEST_PRIVACY_POLICY_VERSION } from '../../../src/shared/utils/constants'
import { startMockChatServer } from '../../helpers/http/mockChatServer'
import { selectSidebarApp } from '../regression/helpers/navigation'
import { expect, test as base } from './fixtures/electron.fixture'
import { uiLocator } from './utils/uiLocator'

const test = base.extend({
  electronApp: async ({}, use, testInfo) => {
    const profileRoot = testInfo.outputPath('profile')
    const app = await electron.launch({
      args: ['.'],
      env: { ...process.env, NODE_ENV: 'development', CS_DEV_PROFILE_ROOT: profileRoot },
      timeout: 60000
    })
    try {
      await use(app)
    } finally {
      await app.close()
      await rm(profileRoot, { recursive: true, force: true })
    }
  }
})

function payload(reference: string, tail: string) {
  const diagnostics = createClaudeCodeProcessDiagnostics(reference)
  recordClaudeCodeProcessExit(diagnostics, 3, null, tail)
  return serializeError(createClaudeCodeProcessExitError(new Error('process exited'), diagnostics))
}

test('renders normalized Claude Code exit diagnostics in Work', async ({ mainWindow: page }, testInfo) => {
  test.setTimeout(120_000)
  const server = await startMockChatServer()
  const suffix = randomUUID()
  const providerId = `navigate-smoke-${suffix}`
  const providerName = `Navigate provider ${suffix}`
  const agentName = `Navigate agent ${suffix}`
  const sessionName = `Navigate session ${suffix}`

  try {
    const languageSelect = page.locator('[data-onboarding-language-select]')
    await expect(uiLocator(page, 'app.shell').or(languageSelect).first()).toBeVisible()
    await page.evaluate(async (version) => {
      await window.api.preference.set('app.language', 'en-US')
      await window.api.preference.set('app.privacy.policy_version', version)
      await window.api.preference.set('app.onboarding.provider_setup.status', 'skipped')
    }, LATEST_PRIVACY_POLICY_VERSION)
    const dismissOnboarding = async () => {
      if (await languageSelect.isVisible()) {
        await languageSelect.getByRole('combobox').click()
        await page.getByRole('option', { name: 'English', exact: false }).click()
        await page.getByRole('button', { name: 'Set up later', exact: true }).click()
      }
    }
    await dismissOnboarding()
    expect(await page.evaluate(() => window.api.preference.get('app.language'))).toBe('en-US')
    await page.reload({ waitUntil: 'domcontentloaded' })
    await dismissOnboarding()
    await selectSidebarApp(page, 'Chat')
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
    const sessionResponse = await page.evaluate(
      ({ agentId, name }) =>
        window.api.dataApi.request({
          id: `navigate-session-${name}`,
          method: 'POST',
          path: '/agent-sessions',
          body: { agentId, name, workspace: { type: 'system' } }
        }),
      { agentId: agent.id, name: sessionName }
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

    const cases = [
      {
        name: 'empty',
        tail: '',
        reference: 'e2e-exit-3-empty',
        heading: 'Claude Code stopped mid-turn.',
        evidence: 'No non-empty error output was captured.'
      },
      {
        name: 'unrecognized',
        tail: 'unexpected failure at C:\\Users\\alice\\private',
        reference: 'e2e-exit-3-unrecognized',
        heading: 'Claude Code stopped mid-turn.',
        evidence: 'The cause could not be identified from captured error output.'
      },
      {
        name: 'auth',
        tail: 'Authentication failed',
        reference: 'e2e-exit-3-auth',
        heading: 'API Key is invalid, please check and reconfigure',
        evidence: ''
      }
    ]
    for (const item of cases) {
      const error = payload(item.reference, item.tail)
      const replay = await page.evaluate(
        async ({ sessionId, messageId, errorJson }) => {
          const error = JSON.parse(errorJson)
          const path = `/agent-sessions/${sessionId}/messages/${messageId}`
          const original = await window.api.dataApi.request({ id: `${messageId}-read`, method: 'GET', path })
          if (original.status !== 200) throw new Error(`Message read failed: ${original.status}`)
          const message = original.data as { data: Record<string, unknown> }
          return window.api.dataApi.request({
            id: `${messageId}-replay`,
            method: 'PATCH',
            path,
            body: { data: { ...message.data, parts: [{ type: 'data-error', data: error }] } }
          })
        },
        { sessionId: session.id, messageId: messageId!, errorJson: JSON.stringify(error) }
      )
      expect(replay.status).toBe(200)
      const reopened = await openSession()
      await expect.poll(() => page.evaluate(() => document.documentElement.clientWidth)).toBeGreaterThan(0)
      const message = uiLocator(reopened, 'chat.message').filter({ hasText: item.reference })
      await expect(message.getByText(item.heading, { exact: true })).toBeVisible()
      const codeSentence = `Claude Code exited unexpectedly (code 3). Diagnostic reference: ${item.reference}`
      const description = message.getByText(codeSentence, { exact: false })
      await expect(description).toBeVisible()
      await expect(description).toContainText(codeSentence)
      if (item.evidence) await expect(message.getByText(item.evidence, { exact: false })).toBeVisible()
      await expect(message).not.toContainText('C:\\Users\\alice\\private')
      const dimensions = await description.evaluate((element) => ({
        scrollHeight: element.scrollHeight,
        clientHeight: element.clientHeight,
        scrollWidth: element.scrollWidth,
        clientWidth: element.clientWidth,
        // Unresolved exits must expose the full description; recognised categories retain the clamp.
        lineClamped: element.classList.contains('line-clamp-3')
      }))
      if (item.evidence) {
        expect(dimensions.lineClamped).toBe(false)
        expect(dimensions.scrollHeight).toBeLessThanOrEqual(dimensions.clientHeight + 1)
        expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth + 1)
        expect(await description.boundingBox()).not.toBeNull()
      } else {
        expect(dimensions.lineClamped).toBe(true)
      }
      await page.bringToFront()
      await page.waitForTimeout(250)
      const screenshot = testInfo.outputPath(`claude-code-exit-${item.name}.png`)
      await page.screenshot({ path: screenshot })
      await testInfo.attach(`claude-code-exit-${item.name}`, { path: screenshot, contentType: 'image/png' })
    }
  } finally {
    await server.close()
  }
})
