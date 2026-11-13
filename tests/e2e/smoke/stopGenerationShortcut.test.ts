import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { copyFile, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'

import type { Page } from '@playwright/test'

import type { TopicStatusSnapshotEntry } from '../../../src/shared/ai/transport'
import { AgentEntitySchema } from '../../../src/shared/data/api/schemas/agents'
import { AgentSessionMessageEntitySchema } from '../../../src/shared/data/api/schemas/agentSessionMessages'
import { AgentSessionEntitySchema } from '../../../src/shared/data/api/schemas/agentSessions'
import type { Assistant } from '../../../src/shared/data/types/assistant'
import { MessageSchema } from '../../../src/shared/data/types/message'
import { createUniqueModelId } from '../../../src/shared/data/types/model'
import { type MockChatRequest, startMockChatServer } from '../../helpers/http/mockChatServer'
import { selectSidebarApp } from '../regression/helpers/navigation'
import { openSettingsSection } from '../regression/helpers/settings'
import { expect, test } from './fixtures/electron.fixture'
import { uiLocator } from './utils/uiLocator'

const defaultPreference = { binding: ['CommandOrControl', 'Shift', 'S'], enabled: true }
const reboundPreference = { binding: ['CommandOrControl', 'Shift', 'Y'], enabled: true }
const defaultChord = process.platform === 'darwin' ? 'Meta+Shift+S' : 'Control+Shift+S'
const reboundChord = process.platform === 'darwin' ? 'Meta+Shift+Y' : 'Control+Shift+Y'

async function readStream(page: Page, topicId: string) {
  return page.evaluate(async (id) => {
    const entries = await window.api.cache.getAllShared()
    return entries[`topic.stream.statuses.${id}`]?.value as TopicStatusSnapshotEntry | undefined
  }, topicId)
}

async function readPreference(page: Page) {
  return page.evaluate(() => window.api.preference.get('shortcut.chat.generation.stop'))
}

async function closesWithin(request: MockChatRequest, timeoutMs: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      request.closed.then(() => true),
      new Promise<false>((resolve) => {
        timer = setTimeout(() => resolve(false), timeoutMs)
      })
    ])
  } finally {
    clearTimeout(timer)
  }
}

test('stops held chat and pi-agent streams with enabled, rebound, persisted shortcuts', async ({
  mainWindow: page
}, testInfo) => {
  test.setTimeout(180_000)
  expect(process.env.CS_DEV_PROFILE_ROOT, 'The smoke fixture must provide an isolated profile').toBeTruthy()
  expect(page.url()).toMatch(/\/windows\/main\/index\.html(?:[?#]|$)/)
  const runId = `${Date.now()}-${randomUUID()}`
  const archive = join(
    '/Volumes/cherrydev/development/cherry-studio/worktrees/.tasks/issue-24344/round-1',
    `e2e-${runId}`
  )
  await mkdir(archive, { recursive: true })
  const evidence: Record<string, unknown> = {
    runId,
    platform: process.platform,
    revision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    turns: []
  }
  const turns = evidence.turns as Record<string, unknown>[]
  const saveEvidence = async () => {
    const path = testInfo.outputPath('stop-generation-evidence.json')
    await writeFile(path, `${JSON.stringify(evidence, null, 2)}\n`)
    await copyFile(path, join(archive, 'stop-generation-evidence.json'))
  }
  const screenshot = async (name: string) => {
    const path = testInfo.outputPath(`${name}.png`)
    await page.screenshot({ path })
    await copyFile(path, join(archive, `${name}.png`))
    await testInfo.attach(name, { path, contentType: 'image/png' })
  }
  await saveEvidence()
  const server = await startMockChatServer()
  let previousNaming: boolean | undefined
  let previousShortcut: Awaited<ReturnType<typeof readPreference>> | undefined

  try {
    const languageSelect = page.locator('[data-onboarding-language-select]')
    await expect(uiLocator(page, 'chat.composer').or(languageSelect).filter({ visible: true }).first()).toBeVisible()
    if (await languageSelect.isVisible()) {
      await languageSelect.getByRole('combobox').click()
      await page.getByRole('option', { name: 'English', exact: false }).click()
      await page.getByRole('button', { name: 'Set up later', exact: true }).click()
    }
    await page.evaluate(() => window.api.preference.set('app.language', 'en-US'))
    await selectSidebarApp(page, 'Chat')
    previousNaming = await page.evaluate(() => window.api.preference.get('topic.naming.enabled'))
    previousShortcut = await readPreference(page)
    evidence.initialPreference = previousShortcut
    expect(previousShortcut).toEqual(defaultPreference)
    await page.evaluate(() => window.api.preference.set('topic.naming.enabled', false))

    const providerId = `stop-shortcut-${runId}`
    const provider = await page.evaluate(
      ({ providerId, baseUrl }) =>
        window.api.dataApi.request({
          id: `${providerId}-create`,
          method: 'POST',
          path: '/providers',
          body: {
            providerId,
            name: 'Stop shortcut mock',
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
          id: `${id}-enable`,
          method: 'PATCH',
          path: `/providers/${id}`,
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
    const modelId = createUniqueModelId(providerId, server.modelId)
    const assistantName = `Stop shortcut ${runId}`
    const createdAssistant = await page.evaluate(
      (name) =>
        window.api.dataApi.request({
          id: 'stop-assistant-create',
          method: 'POST',
          path: '/assistants',
          body: { name, emoji: '🛑' }
        }),
      assistantName
    )
    expect(createdAssistant.status).toBe(201)
    const assistant = createdAssistant.data as Assistant
    const bound = await page.evaluate(
      ({ id, modelId }) =>
        window.api.dataApi.request({
          id: 'stop-assistant-bind',
          method: 'PATCH',
          path: `/assistants/${id}`,
          body: { modelId }
        }),
      { id: assistant.id, modelId }
    )
    expect(bound.status).toBe(200)
    // Reload query consumers after configuring the provider and assistant through real IPC.
    await page.reload()
    await selectSidebarApp(page, 'Chat')
    const assistantRow = uiLocator(uiLocator(page, 'chat.view').filter({ visible: true }), 'chat.group-header')
      .filter({ has: page.getByText(assistantName, { exact: true }) })
      .first()
    await assistantRow.hover()
    await assistantRow.getByRole('button', { name: 'New Chat', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Selected models', exact: true })).toContainText(server.modelId)

    const holdTurn = async (label: string, sessionId?: string) => {
      const prompt = `Stop shortcut ${label} ${randomUUID()}`
      const marker = `STOP_SHORTCUT_PARTIAL_${randomUUID()}`
      const composer = uiLocator(page, 'chat.composer').filter({ visible: true }).first()
      await composer.locator('[contenteditable="true"]').first().fill(prompt)
      await composer.getByRole('button', { name: 'Send', exact: true }).click()
      const request = await server.nextRequest(30_000)
      expect(request.body.model).toBe(server.modelId)
      expect(request.body.stream).toBe(true)
      expect(
        request.body.messages.some((item) => {
          const message = item as { role?: string; content?: unknown }
          return message.role === 'user' && JSON.stringify(message.content).includes(prompt)
        }),
        'Match the intended user turn rather than background traffic'
      ).toBe(true)
      const record: Record<string, unknown> = {
        label,
        prompt,
        marker,
        sessionId,
        // The helper exposes no provider response ID; this is a local correlation ID, not an SSE ID.
        requestCorrelationId: prompt,
        request: { method: request.method, url: request.url, body: request.body }
      }
      turns.push(record)
      request.sendText(marker)
      const message = uiLocator(page, 'chat.message').filter({ hasText: marker })
      await expect(message).toBeVisible({ timeout: 30_000 })
      const pause = uiLocator(composer, 'chat.composer.action.pause')
      await expect(pause).toBeVisible()
      const messageId = await message.getAttribute('data-message-id')
      expect(messageId).toBeTruthy()
      let topicId = sessionId ? `agent-session:${sessionId}` : ''
      if (!sessionId) {
        const response = await page.evaluate(
          (id) =>
            window.api.dataApi.request({
              id: `stop-read-${id}`,
              method: 'GET',
              path: `/messages/${id}`
            }),
          messageId!
        )
        expect(response.status).toBe(200)
        topicId = MessageSchema.parse(response.data).topicId
      }
      record.messageId = messageId
      record.topicId = topicId
      let live: TopicStatusSnapshotEntry | undefined
      await expect
        .poll(
          async () => {
            live = await readStream(page, topicId)
            return live?.status
          },
          { timeout: 15_000 }
        )
        .toMatch(/^(pending|streaming)$/)
      record.liveStream = live
      record.turnId = live?.turnId
      await saveEvidence()
      await screenshot(`${label}-partial`)
      let closedAt: number | undefined
      void request.closed.then(() => {
        closedAt = performance.now()
      })
      const press = async (chord: string) => {
        await composer.locator('[contenteditable="true"]').first().focus()
        await expect(composer.locator('[contenteditable="true"]').first()).toBeFocused()
        expect(closedAt, 'The held response must still be open immediately before the keypress').toBeUndefined()
        const started = performance.now()
        await page.keyboard.press(chord)
        return started
      }
      const assertCancelled = async (started: number) => {
        const closed = await closesWithin(request, 15_000)
        record.closed = closed
        record.closureMs = closedAt === undefined ? null : closedAt - started
        await saveEvidence()
        expect(closed, 'Client must abort the held HTTP response before any cleanup').toBe(true)
        await expect(message).toBeVisible()
        await expect(message).toContainText(marker)
        await expect
          .poll(
            async () => {
              const response = await page.evaluate(
                ({ messageId, sessionId }) =>
                  window.api.dataApi.request({
                    id: `stop-persisted-${messageId}`,
                    method: 'GET',
                    path: sessionId ? `/agent-sessions/${sessionId}/messages` : `/messages/${messageId}`
                  }),
                { messageId: messageId!, sessionId }
              )
              expect(response.status).toBe(200)
              const persisted = sessionId
                ? (response.data as { items: unknown[] }).items
                    .map((item) => AgentSessionMessageEntitySchema.parse(item))
                    .find((item) => item.id === messageId)
                : MessageSchema.parse(response.data)
              record.persistedMessage = persisted
              return persisted?.status
            },
            { timeout: 15_000 }
          )
          .toBe('paused')
        const persisted = record.persistedMessage as { role: string; data: unknown }
        expect(persisted.role).toBe('assistant')
        expect(JSON.stringify(persisted.data)).toContain(marker)
        await expect
          .poll(
            async () => {
              const terminal = await readStream(page, topicId)
              record.terminalStream = terminal
              return {
                status: terminal?.status,
                activeExecutions: terminal?.activeExecutions,
                awaitingApprovalAnchors: terminal?.awaitingApprovalAnchors,
                turnId: terminal?.turnId
              }
            },
            { timeout: 15_000 }
          )
          .toEqual({
            status: expect.stringMatching(/^(aborted|done)$/),
            activeExecutions: [],
            awaitingApprovalAnchors: [],
            turnId: live?.turnId
          })
        await expect(pause).toBeHidden()
        await screenshot(`${label}-cancelled`)
        await saveEvidence()
      }
      const assertStillOpen = async (chord: string) => {
        await press(chord)
        const started = performance.now()
        const closed = await closesWithin(request, 5_000)
        record.negativeControl = { chord, observationMs: performance.now() - started, closed }
        await saveEvidence()
        expect(closed, 'The disabled or replaced chord must leave this response open for 5 seconds').toBe(false)
        await expect(message).toBeVisible()
        await expect(pause).toBeVisible()
        expect((await readStream(page, topicId))?.status).toMatch(/^(pending|streaming)$/)
      }
      return { press, assertCancelled, assertStillOpen, pause }
    }

    await test.step('default chat shortcut aborts transport and persists a paused partial reply', async () => {
      const turn = await holdTurn('chat-default')
      await turn.assertCancelled(await turn.press(defaultChord))
    })
    await test.step('disabled shortcut leaves the stream open; mouse pause is a positive control', async () => {
      await page.evaluate(() =>
        window.api.preference.set('shortcut.chat.generation.stop', {
          binding: ['CommandOrControl', 'Shift', 'S'],
          enabled: false
        })
      )
      expect(await readPreference(page)).toEqual({ ...defaultPreference, enabled: false })
      const turn = await holdTurn('chat-disabled')
      await turn.assertStillOpen(defaultChord)
      const started = performance.now()
      await turn.pause.click()
      await turn.assertCancelled(started)
      await page.evaluate(() =>
        window.api.preference.set('shortcut.chat.generation.stop', {
          binding: ['CommandOrControl', 'Shift', 'S'],
          enabled: true
        })
      )
      expect(await readPreference(page)).toEqual(defaultPreference)
    })
    await test.step('record a new binding through Settings and prove old/new chord behavior', async () => {
      evidence.preferenceBeforeRebind = await readPreference(page)
      await openSettingsSection(page, 'Keyboard Shortcuts')
      const settings = uiLocator(page, 'settings.view').filter({ visible: true })
      await expect(settings.getByRole('heading', { name: 'Keyboard Shortcuts', exact: true })).toBeVisible()
      await settings.getByRole('button', { name: 'Search', exact: true }).click()
      await settings.getByPlaceholder('Search shortcuts...', { exact: true }).fill('Stop Generation')
      const row = settings.locator('#setting-shortcut-chat-generation-stop')
      await expect(row.getByText('Stop Generation', { exact: true })).toBeVisible()
      await row.locator('kbd').first().locator('..').click()
      const recorder = row.getByRole('button', { name: 'Press Shortcut', exact: true })
      await expect(recorder).toBeFocused()
      await page.keyboard.press(reboundChord)
      await expect.poll(() => readPreference(page)).toEqual(reboundPreference)
      await expect(recorder).toBeHidden()
      evidence.preferenceAfterRebind = await readPreference(page)
      await saveEvidence()
      await screenshot('settings-rebound')
      await selectSidebarApp(page, 'Chat')
      const turn = await holdTurn('chat-rebound')
      await turn.assertStillOpen(defaultChord)
      await turn.assertCancelled(await turn.press(reboundChord))
    })
    await test.step('rebound preference survives a renderer reload', async () => {
      // Reload with the same smoke profile substitutes for a process restart in this spec.
      await page.reload()
      await selectSidebarApp(page, 'Chat')
      expect(await readPreference(page)).toEqual(reboundPreference)
      evidence.preferenceAfterReload = await readPreference(page)
      const turn = await holdTurn('chat-reloaded')
      await turn.assertCancelled(await turn.press(reboundChord))
    })
    await test.step('pi agent shortcut aborts transport and persists its paused partial reply', async () => {
      const created = await page.evaluate(
        ({ name, model }) =>
          window.api.ipcApi.request('ai.agent.create', {
            type: 'pi',
            name,
            model,
            instructions: 'Answer briefly without using tools.'
          }),
        { name: `Stop agent ${runId}`, model: modelId }
      )
      expect(created).toMatchObject({ ok: true })
      const agent = AgentEntitySchema.parse((created as { data: unknown }).data)
      const sessionResponse = await page.evaluate(
        ({ agentId, name }) =>
          window.api.dataApi.request({
            id: 'stop-session-create',
            method: 'POST',
            path: '/agent-sessions',
            body: { agentId, name, workspace: { type: 'system' } }
          }),
        { agentId: agent.id, name: `Stop session ${runId}` }
      )
      expect(sessionResponse.status).toBe(201)
      const session = AgentSessionEntitySchema.parse(sessionResponse.data)
      await page.reload()
      await selectSidebarApp(page, 'Chat')
      await expect(uiLocator(page, 'chat.composer').filter({ visible: true }).first()).toBeVisible()
      await selectSidebarApp(page, 'Work')
      const view = uiLocator(page, 'agent.view').filter({ visible: true }).first()
      const header = view.getByText(agent.name, { exact: true }).first()
      await header.click()
      const conversation = view.getByText(session.name, { exact: true }).first()
      if (!(await conversation.isVisible())) {
        await header.hover()
        await view
          .getByRole('button', { name: agent.name, exact: true })
          .first()
          .locator('..')
          .getByRole('button', { name: 'Expand', exact: true })
          .click()
      }
      await conversation.click()
      expect(await readPreference(page)).toEqual(reboundPreference)
      const turn = await holdTurn('agent-rebound', session.id)
      await turn.assertCancelled(await turn.press(reboundChord))
    })
  } catch (error) {
    evidence.failure = error instanceof Error ? error.stack : String(error)
    throw error
  } finally {
    try {
      await saveEvidence()
      await testInfo.attach('stop-generation-evidence', {
        path: testInfo.outputPath('stop-generation-evidence.json'),
        contentType: 'application/json'
      })
    } finally {
      // Cleanup cannot satisfy a cancellation assertion: every such assertion runs above this boundary.
      try {
        await server.close()
      } finally {
        if (previousNaming !== undefined)
          await page.evaluate((value) => window.api.preference.set('topic.naming.enabled', value), previousNaming)
        if (previousShortcut !== undefined)
          await page.evaluate(
            (value) => window.api.preference.set('shortcut.chat.generation.stop', value),
            previousShortcut
          )
      }
    }
  }
})
