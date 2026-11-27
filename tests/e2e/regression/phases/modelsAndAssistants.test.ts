import type { Page, TestInfo } from '@playwright/test'

import { AssistantSchema } from '@shared/data/types/assistant'
import type { BranchMessagesResponse } from '@shared/data/types/message'
import { MessageSchema } from '@shared/data/types/message'
import { createUniqueModelId } from '@shared/data/types/model'
import { TopicSchema } from '@shared/data/types/topic'
import type { IpcResult } from '@shared/ipc/errors/IpcError'

import { caseDefinition } from '../../../../scripts/e2e/regression/cases'
import { getSensitiveConfigValues } from '../../../../scripts/e2e/regression/config'
import { hasOwnedAppActiveTasks } from '../../../../scripts/e2e/regression/debugBridge'
import { captureMaskedScreenshot } from '../../../../scripts/e2e/regression/screenshotEvidence'
import { startMockChatServer } from '../../../helpers/http/mockChatServer'
import { expect, test } from '../fixture'
import { startClaudeStreamFailureServer } from '../fixtures/claudeStreamFailureServer'
import { customAssistantName, ensureCustomAssistant } from '../helpers/assistants'
import { sendChatMarker } from '../helpers/chat'
import { CUSTOM_CHAT_PROVIDER, ensureCustomChatProvider } from '../helpers/models'
import { dismissOnboarding, selectSidebarApp } from '../helpers/navigation'
import { closeSettings, openSettingsSection } from '../helpers/settings'
import type { RegressionApp } from '../RegressionApp'
import { clearChatMessages } from '../scenarios/clearChatMessages'
import { errorRecovery } from '../scenarios/errorRecovery'
import { prepareScenario } from '../setup'

test(...caseDefinition('M-02'), async ({ app, mainWindow }) => {
  let page = mainWindow
  const providerId = await ensureCustomChatProvider(app, page)
  await expect(page.getByText(CUSTOM_CHAT_PROVIDER, { exact: true }).first()).toBeVisible()
  await expect(
    page.getByTestId('provider-model-list').getByText(app.config.customProvider.chatModel, { exact: true }).last()
  ).toBeVisible()

  await closeSettings(page)
  const assistantName = app.resourceName('Provider conversation')
  const created = await page.evaluate(
    (body) => window.api.dataApi.request({ id: 'm02-assistant', method: 'POST', path: '/assistants', body }),
    { name: assistantName, modelId: createUniqueModelId(providerId, app.config.customProvider.chatModel) }
  )
  expect(created.status).toBe(201)
  const assistantId = AssistantSchema.parse(created.data).id
  try {
    const topic = await page.evaluate(
      (assistantId) =>
        window.api.dataApi.request({
          id: 'm02-topic',
          method: 'POST',
          path: '/topics',
          body: { name: 'Provider conversation setup', assistantId }
        }),
      assistantId
    )
    expect(topic.status).toBe(201)
    await page.reload()
    await prepareScenario(page)
    const row = page.locator('[data-ui~="chat.group-header"]').filter({ hasText: assistantName }).first()
    await row.hover()
    await row.getByRole('button', { name: 'New Chat', exact: true }).press('Enter')
    await sendChatMarker(
      page,
      'Reply with exactly CUSTOM_PROVIDER_CHAT_PASS and nothing else.',
      'CUSTOM_PROVIDER_CHAT_PASS'
    )

    page = await app.restart('authenticated')
    await dismissOnboarding(page)
    await openSettingsSection(page, 'Model Provider')
    await expect(page.getByText(CUSTOM_CHAT_PROVIDER, { exact: true }).first()).toBeVisible()
  } finally {
    const removed = (await page.evaluate(
      (assistantId) =>
        window.api.ipcApi.request('trash.assistant.delete_permanently', { assistantId, deleteTopics: true }),
      assistantId
    )) as IpcResult<{ deleted: boolean }>
    expect(removed.ok && removed.data.deleted).toBe(true)
  }
})

test(...caseDefinition('M-03'), async ({ app, mainWindow: page }) => {
  const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))
  const providerId = `regression-model-scroll-${Date.now()}`
  const providerName = app.resourceName('Model scrolling')
  const groupName = app.resourceName('Scroll group')
  const created = await page.evaluate(
    ({ providerId, providerName }) =>
      window.api.dataApi.request({
        id: `${providerId}-create`,
        method: 'POST',
        path: '/providers',
        body: { providerId, name: providerName }
      }),
    { providerId, providerName }
  )
  expect(created.status).toBe(201)

  try {
    // Seed persisted inputs; scrolling and all assertions go through the real settings UI.
    const seeded = await page.evaluate(
      ({ providerId, groupName }) =>
        window.api.dataApi.request({
          id: `${providerId}-models`,
          method: 'POST',
          path: '/models',
          body: Array.from({ length: 160 }, (_, index) => ({
            providerId,
            modelId: `scroll-${String(index).padStart(3, '0')}`,
            name: `Scroll model ${String(index).padStart(3, '0')}`,
            group: groupName
          }))
        }),
      { providerId, groupName }
    )
    expect(seeded.status).toBe(201)
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.reload()

    await openSettingsSection(page, 'Model Provider')
    await page.getByPlaceholder('Search Providers...', { exact: true }).fill(providerName)
    await page.getByTestId(`provider-list-item-${providerId}`).click()
    const detail = page.getByTestId('provider-detail-shell')
    const list = detail.getByTestId('provider-model-list').getByRole('list')
    const firstModel = list.getByText('Scroll model 000', { exact: true })
    const laterModel = list.getByText('Scroll model 060', { exact: true })
    const group = list.getByRole('button', { name: new RegExp(`^${groupName}`) })
    await expect(firstModel).toBeInViewport()
    await expect(group).toBeInViewport()
    await expect(laterModel).not.toBeInViewport()

    const listBox = await list.boundingBox()
    const detailBox = await detail.boundingBox()
    if (!listBox || !detailBox) throw new Error('Provider model list has no visible layout')
    const wheelStep = Math.floor(detailBox.height / 2)
    const pointerY = detailBox.y + detailBox.height / 2
    const outsideX = listBox.x - 12
    expect(outsideX).toBeGreaterThan(detailBox.x)
    await page.mouse.move(outsideX, pointerY)
    await expect(async () => {
      await page.mouse.wheel(0, wheelStep)
      await expect(laterModel).toBeInViewport({ timeout: 500 })
    }).toPass({ timeout: 15_000 })

    await expect(group).not.toBeInViewport()
    await expect(firstModel).not.toBeAttached()

    await page.mouse.move(listBox.x + listBox.width / 2, pointerY)
    await expect(async () => {
      await page.mouse.wheel(0, -wheelStep)
      await expect(firstModel).toBeInViewport({ timeout: 500 })
      await expect(group).toBeInViewport({ timeout: 500 })
    }).toPass({ timeout: 15_000 })
  } finally {
    const removed = await page.evaluate(
      (providerId) =>
        window.api.dataApi.request({ id: `${providerId}-delete`, method: 'DELETE', path: `/providers/${providerId}` }),
      providerId
    )
    expect(removed.status).toBe(204)
    const providerSearch = page.getByPlaceholder('Search Providers...', { exact: true })
    if (await providerSearch.isVisible()) await providerSearch.fill('')
    await page.setViewportSize(viewport)
  }
})

test(...caseDefinition('C-01'), async ({ app, mainWindow: page }) => {
  await ensureCustomAssistant(app, page)
  await sendChatMarker(page, 'In one sentence, what is two plus two?', 'ASSISTANT_PROMPT_PASS', false)

  const restarted = await app.restart('authenticated')
  await dismissOnboarding(restarted)
  await selectSidebarApp(restarted, 'Chat')
  const assistantList = restarted.locator('[data-ui~="chat.view"]:visible').getByRole('listbox').first()
  await expect(assistantList).toBeVisible()
  await assistantList.getByText(customAssistantName(app), { exact: true }).first().click({ noWaitAfter: true })
  await expect(restarted.getByText('ASSISTANT_PROMPT_PASS').last()).toBeVisible()
})

for (const [caseId, endpoint] of [
  ['C-03', 'openai-chat-completions'],
  ['C-04', 'anthropic-messages']
] as const) {
  test(...caseDefinition(caseId), async ({ app, mainWindow }, testInfo) => {
    await verifyStreamFailure(app, mainWindow, testInfo, caseId, endpoint)
  })
}

async function verifyStreamFailure(
  app: RegressionApp,
  mainWindow: Page,
  testInfo: TestInfo,
  caseId: 'C-03' | 'C-04',
  endpoint: 'openai-chat-completions' | 'anthropic-messages'
) {
  const providerId = `regression-stream-${Date.now()}`
  const assistantName = app.resourceName('Stream failure')
  const prompt = 'Explain how a rainbow forms.'
  const partialText = 'Sunlight enters a raindrop and separates into colors.'
  const recoveryPrompt = 'What happens next?'
  const recoveryText = 'The light leaves the raindrop.'
  let page = mainWindow
  let assistantId: string | undefined
  const diagnostics: Record<string, unknown> = { observations: [] }
  const observations = diagnostics.observations as unknown[]
  const observe = async (messageId: string, topicId: string) => {
    const renderer = await page.evaluate(() => ({
      cache: Object.fromEntries(
        [
          'ui.tab.normal_tabs',
          'ui.tab.pinned_tabs',
          'ui.tab.active_tab_id',
          'ui.chat.last_used_topic_id',
          'ui.chat.last_used_assistant_id'
        ].map((key) => [key, JSON.parse(localStorage.getItem('cs_cache_persist') ?? '{}')[key] ?? null])
      ),
      options: Array.from(document.querySelectorAll<HTMLElement>('[data-ui~="chat.view"] [role="option"]'))
        .filter((element) => element.checkVisibility())
        .map((element) => ({
          id: element.id,
          selected: element.getAttribute('aria-selected'),
          text: element.innerText
        })),
      visibleMessageIds: Array.from(
        document.querySelectorAll<HTMLElement>('[data-ui~="chat.message"][data-message-id]')
      )
        .filter((element) => element.checkVisibility())
        .map((element) => element.dataset.messageId),
      busyHistory: Array.from(document.querySelectorAll<HTMLElement>('[aria-busy="true"]')).map((element) => ({
        id: element.id,
        ui: element.getAttribute('data-ui'),
        visible: element.checkVisibility()
      }))
    }))
    const row = page.locator(`[data-ui~="chat.message"][data-message-id="${messageId}"]`)
    const rows = await row.evaluateAll((elements) =>
      elements.map((element) => ({
        visible: element.checkVisibility(),
        innerText: (element as HTMLElement).innerText,
        textContent: element.textContent
      }))
    )
    const branch = await page.evaluate(
      (topicId) =>
        window.api.dataApi.request({
          id: 'stream-failure-branch-diagnostic',
          method: 'GET',
          path: `/topics/${topicId}/messages`,
          params: { includeSiblings: true }
        }),
      topicId
    )
    const membership = (branch.data as BranchMessagesResponse | undefined)?.items.map((entry) => ({
      primaryId: entry.message.id,
      isPrimary: entry.message.id === messageId,
      siblingIds: entry.siblingsGroup?.map((message) => message.id) ?? [],
      isSibling: entry.siblingsGroup?.some((message) => message.id === messageId) ?? false
    }))
    return {
      timestamp: new Date().toISOString(),
      ...renderer,
      rows,
      rowCount: rows.length,
      rowExactTextCount: await row.getByText(partialText, { exact: true }).count(),
      exactTextCount: await page.getByText(partialText, { exact: true }).count(),
      branch,
      membership
    }
  }
  const namingEnabled = await page.evaluate(() => window.api.preference.get('topic.naming.enabled'))
  const fixture =
    endpoint === 'anthropic-messages'
      ? { endpoint, server: await startClaudeStreamFailureServer(prompt, partialText, recoveryPrompt, recoveryText) }
      : { endpoint, server: await startMockChatServer() }
  const { server } = fixture
  testInfo.annotations.push({
    type: 'data-source',
    description: `Loopback ${endpoint} fixtures${endpoint === 'anthropic-messages' ? ' served by AIMock' : ''}; real Electron UI, IPC and persisted data.`
  })

  try {
    await page.evaluate(() => window.api.preference.set('topic.naming.enabled', false))
    const provider = await page.evaluate(
      ({ providerId, baseUrl, endpoint }) =>
        window.api.dataApi.request({
          id: `${providerId}-create`,
          method: 'POST',
          path: '/providers',
          body: {
            providerId,
            name: 'Stream failure mock',
            defaultChatEndpoint: endpoint,
            endpointConfigs: { [endpoint]: { baseUrl } },
            apiKeys: [{ id: 'mock-key', key: 'mock-api-key', isEnabled: true }]
          }
        }),
      { providerId, baseUrl: server.baseUrl, endpoint }
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
      ({ providerId, modelId, endpoint }) =>
        window.api.dataApi.request({
          id: `${providerId}-model`,
          method: 'POST',
          path: '/models',
          body: [{ providerId, modelId, endpointTypes: [endpoint] }]
        }),
      { providerId, modelId: server.modelId, endpoint }
    )
    expect(models.status).toBe(201)
    const assistant = await page.evaluate(
      ({ name, modelId }) =>
        window.api.dataApi.request({
          id: 'stream-failure-assistant',
          method: 'POST',
          path: '/assistants',
          body: { name, modelId }
        }),
      { name: assistantName, modelId: createUniqueModelId(providerId, server.modelId) }
    )
    expect(assistant.status).toBe(201)
    assistantId = AssistantSchema.parse(assistant.data).id
    const topic = await page.evaluate(
      ({ assistantId, name }) =>
        window.api.dataApi.request({
          id: 'stream-failure-topic',
          method: 'POST',
          path: '/topics',
          body: { assistantId, name }
        }),
      { assistantId, name: assistantName }
    )
    expect(topic.status).toBe(201)
    const topicId = TopicSchema.parse(topic.data).id
    await page.reload()
    await expect(page.locator('[data-ui~="app.tab-bar"]')).toBeVisible()
    const opened = (await page.evaluate(
      ({ conversationId, title }) =>
        window.api.ipcApi.request('navigation.focus_or_open_conversation', {
          target: { conversationType: 'assistant', conversationId },
          title
        }),
      { conversationId: topicId, title: assistantName }
    )) as IpcResult<void>
    expect(opened.ok).toBe(true)
    await expect(page.getByRole('button', { name: 'Selected models', exact: true })).toContainText(server.modelId)
    await page.locator('[data-ui~="chat.composer"] [contenteditable="true"]').first().fill(prompt)
    await page.getByRole('button', { name: 'Send', exact: true }).click()

    let disconnect: () => void
    if (fixture.endpoint === 'openai-chat-completions') {
      const request = await fixture.server.nextRequest()
      expect(request.body).toMatchObject({
        model: server.modelId,
        stream: true,
        messages: expect.arrayContaining([expect.objectContaining({ role: 'user', content: prompt })])
      })
      request.sendText('Sunlight enters a raindrop ')
      request.sendText('and separates into colors.')
      disconnect = request.disconnect
    } else {
      disconnect = fixture.server.disconnect
    }
    const response = page
      .locator('[data-ui~="chat.message"][data-message-id]:visible')
      .filter({ hasText: partialText })
      .last()
    await expect(response.getByText(partialText, { exact: true })).toBeVisible()
    await expect(page.locator('[data-ui~="chat.composer.action.pause"]')).toBeVisible()
    const messageId = await response.getAttribute('data-message-id')
    if (!messageId) throw new Error('Streaming response has no message ID')

    // Disconnect only after the renderer has consumed the text.
    disconnect()
    await expect
      .poll(async () => {
        const stored = await page.evaluate(
          (id) => window.api.dataApi.request({ id: 'stream-failure-read', method: 'GET', path: `/messages/${id}` }),
          messageId
        )
        expect(stored.status).toBe(200)
        return MessageSchema.parse(stored.data)
      })
      .toMatchObject({
        id: messageId,
        topicId,
        status: 'error',
        data: {
          parts: expect.arrayContaining([
            expect.objectContaining({ type: 'text', text: partialText, state: 'done' }),
            expect.objectContaining({ type: 'data-error' })
          ])
        }
      })
    await expect(page.locator('[data-ui~="chat.composer.action.pause"]')).toBeHidden()
    await expect(response.getByText(partialText, { exact: true })).toBeVisible()
    await expect(response).toContainText('Connection interrupted while receiving the response.')
    await expect(response).not.toContainText('AI returned an invalid response')
    const errorScreenshot = testInfo.outputPath(`${caseId} connection interrupted.png`)
    await page.screenshot({ path: errorScreenshot })
    await testInfo.attach('Connection interrupted', { path: errorScreenshot, contentType: 'image/png' })

    await expect
      .poll(
        async () => {
          const cache = (await page.evaluate(() => JSON.parse(localStorage.getItem('cs_cache_persist') ?? '{}'))) as {
            'ui.tab.normal_tabs'?: { url: string; isDormant?: boolean }[]
            'ui.chat.last_used_topic_id'?: string | null
          }
          const tabs = cache['ui.tab.normal_tabs'] ?? []
          const lastUsedTopicId = cache['ui.chat.last_used_topic_id'] ?? null
          return lastUsedTopicId === topicId &&
            tabs.some((tab) => !tab.isDormant && tab.url.includes(`topicId=${topicId}`))
            ? 'ready'
            : JSON.stringify({ 'ui.chat.last_used_topic_id': lastUsedTopicId, tabUrls: tabs.map((tab) => tab.url) })
        },
        {
          timeout: 5_000,
          intervals: [100],
          message: `${caseId} serialized conversation selection did not catch up to topic ${topicId} before restart`
        }
      )
      .toBe('ready')

    const beforeRestart = await page
      .evaluate(
        (id) =>
          window.api.dataApi.request({ id: 'stream-failure-before-restart', method: 'GET', path: `/messages/${id}` }),
        messageId
      )
      .catch((error) => ({ status: 0, data: undefined, error: String(error) }))
    diagnostics.beforeRestartMessage = beforeRestart
    diagnostics.identity = { messageId, topicId, assistantId }
    diagnostics.beforeRestart = await observe(messageId, topicId).catch((error) => ({ error: String(error) }))

    await expect
      .poll(() => hasOwnedAppActiveTasks(app.record), {
        timeout: 15_000,
        message: 'Disconnected streams must release main-process activity before the persistence restart'
      })
      .toBe(false)
    page = await app.restart('authenticated')
    let stored: typeof beforeRestart
    try {
      stored = await page.evaluate(
        (id) => window.api.dataApi.request({ id: 'stream-failure-reloaded', method: 'GET', path: `/messages/${id}` }),
        messageId
      )
      diagnostics.afterRestartMessage = stored
    } catch (error) {
      diagnostics.afterRestartMessage = { error: String(error) }
      throw error
    }
    await dismissOnboarding(page)
    await expect(page.locator('[data-ui~="chat.view"]:visible')).toBeVisible()
    const restored = page.locator(`[data-ui~="chat.message"][data-message-id="${messageId}"]:visible`)
    let stopObserving!: () => void
    const stopped = new Promise<void>((resolve) => {
      stopObserving = resolve
    })
    const observationDeadline = Date.now() + 30_000
    const observationLoop = (async () => {
      while (Date.now() < observationDeadline) {
        const observation = await Promise.race([
          observe(messageId, topicId).catch((error) => ({ timestamp: new Date().toISOString(), error: String(error) })),
          stopped
        ])
        if (!observation) break
        observations.push(observation)
        let timer: ReturnType<typeof setTimeout> | undefined
        await Promise.race([
          new Promise<void>((resolve) => {
            timer = setTimeout(resolve, 250)
          }),
          stopped
        ])
        clearTimeout(timer)
        if (Date.now() >= observationDeadline) break
      }
    })()
    try {
      await expect(restored.getByText(partialText, { exact: true })).toBeVisible({
        timeout: Math.max(1, observationDeadline - Date.now())
      })
    } finally {
      stopObserving()
      await observationLoop
    }
    expect(stored.status).toBe(200)
    expect(MessageSchema.parse(stored.data)).toMatchObject({
      id: messageId,
      status: 'error',
      data: {
        parts: expect.arrayContaining([
          expect.objectContaining({ type: 'text', text: partialText, state: 'done' }),
          expect.objectContaining({ type: 'data-error' })
        ])
      }
    })

    await page.locator('[data-ui~="chat.composer"] [contenteditable="true"]').first().fill(recoveryPrompt)
    await page.getByRole('button', { name: 'Send', exact: true }).click()
    if (fixture.endpoint === 'openai-chat-completions') {
      const recoveryRequest = await fixture.server.nextRequest()
      recoveryRequest.complete(recoveryText)
    }
    const recovery = page.locator('[data-ui~="chat.message"][data-message-id]:visible').last()
    await expect(recovery.getByText(recoveryText, { exact: true })).toBeVisible()
    const recoveryId = await recovery.getAttribute('data-message-id')
    if (!recoveryId) throw new Error('Recovery response has no message ID')
    await expect
      .poll(async () => {
        const saved = await page.evaluate(
          (id) => window.api.dataApi.request({ id: 'stream-recovery-read', method: 'GET', path: `/messages/${id}` }),
          recoveryId
        )
        return MessageSchema.parse(saved.data).status
      })
      .toBe('success')
    if (fixture.endpoint === 'anthropic-messages') {
      const requests = fixture.server.getRequests()
      expect(requests).toMatchObject([
        { path: '/v1/messages', response: { status: 200, interrupted: true } },
        { path: '/v1/messages', response: { status: 200 } }
      ])
      expect(requests.every(({ response }) => response.fixture !== null)).toBe(true)
    }
    await testInfo.attach('Restart persistence and recovery', {
      body: await page.screenshot(),
      contentType: 'image/png'
    })
  } catch (error) {
    diagnostics.failure = String(error)
    try {
      await testInfo.attach(`${caseId} restart diagnostics`, {
        body: JSON.stringify(diagnostics, null, 2),
        contentType: 'application/json'
      })
    } catch {
      // Evidence failures must preserve the original assertion failure.
    }
    try {
      await testInfo.attach(`${caseId} before cleanup`, {
        body: await captureMaskedScreenshot(page, getSensitiveConfigValues()),
        contentType: 'image/png'
      })
    } catch {
      // Evidence failures must preserve the original assertion failure.
    }
    throw error
  } finally {
    await server.close()
    page = await app.mainWindow()
    await page.evaluate(
      async ({ assistantId, providerId, namingEnabled }) => {
        await window.api.preference.set('topic.naming.enabled', namingEnabled)
        if (assistantId) {
          const permanentlyDeletedAssistant = (await window.api.ipcApi.request('trash.assistant.delete_permanently', {
            assistantId,
            deleteTopics: true
          })) as IpcResult<{ deleted: boolean }>
          if (!permanentlyDeletedAssistant.ok || !permanentlyDeletedAssistant.data.deleted)
            throw new Error('cleanup left the case assistant in the trash')
        }
        await window.api.dataApi.request({
          id: `${providerId}-delete`,
          method: 'DELETE',
          path: `/providers/${providerId}`
        })
      },
      { assistantId, providerId, namingEnabled }
    )
  }
}

test(...caseDefinition('MP-42'), async ({ app, mainWindow }, testInfo) => {
  await clearChatMessages(app, mainWindow, testInfo)
})

test(...caseDefinition('MP-17'), async ({ app, mainWindow }, testInfo) => {
  await errorRecovery(app, mainWindow, testInfo)
})
