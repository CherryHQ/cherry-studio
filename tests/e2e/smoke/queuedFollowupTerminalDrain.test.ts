import { copyFile, mkdir, stat } from 'node:fs/promises'
import path from 'node:path'

import type { Locator } from '@playwright/test'

import type { TopicStatusSnapshotEntry } from '../../../src/shared/ai/transport'
import { AgentEntitySchema } from '../../../src/shared/data/api/schemas/agents'
import { AgentSessionEntitySchema } from '../../../src/shared/data/api/schemas/agentSessions'
import type { UnifiedPreferenceType } from '../../../src/shared/data/preference/preferenceTypes'
import { createUniqueModelId } from '../../../src/shared/data/types/model'
import { LATEST_PRIVACY_POLICY_VERSION } from '../../../src/shared/utils/constants'
import { type MockChatRequest, startMockChatServer } from '../../helpers/http/mockChatServer'
import { selectSidebarApp } from '../regression/navigation'
import { expect, test } from './fixtures/electron.fixture'
import { uiLocator } from './utils/uiLocator'

type TimelineEntry = { key: string; at: number; value: TopicStatusSnapshotEntry }
type ObservationWindow = Window & { terminalTimeline: TimelineEntry[]; stopTerminalObservation: () => void }

for (const variant of ['Chat', 'Work Agent'] as const) {
  for (const terminal of ['done', 'error', 'aborted'] as const) {
    test(`${variant} drains one queued follow-up after ${terminal}`, async ({
      mainWindow: page,
      electronApp
    }, testInfo) => {
      test.setTimeout(240_000)
      const evidenceDir = process.env.ISSUE_22093_EVIDENCE_DIR
      if (evidenceDir && !path.isAbsolute(evidenceDir)) {
        throw new Error('ISSUE_22093_EVIDENCE_DIR must be an absolute path')
      }
      const profile = process.env.CS_DEV_PROFILE_ROOT
      expect(profile, 'Run with an isolated CS_DEV_PROFILE_ROOT').toBeTruthy()
      expect(path.isAbsolute(profile!), 'The isolated profile root must be absolute').toBe(true)
      const server = await startMockChatServer()
      const suffix = `${variant.replaceAll(' ', '-')}-${terminal}-${Date.now()}`
      const providerId = `queued-terminal-${suffix}`
      const name = `Queued terminal drain ${suffix}`
      const initial = `HOLD_INITIAL_${suffix}`
      const b = `QUEUED_BRAVO_${suffix}`
      const c = `QUEUED_CHARLIE_${suffix}`
      const d = `UNSENT_DELTA_${suffix}`
      const heldMarker = `HELD_RESPONSE_${suffix}`
      const bMarker = `HELD_BRAVO_RESPONSE_${suffix}`
      let topicId: string | undefined
      let sessionId: string | undefined
      let timeline: TimelineEntry[] = []
      let persistedUsers: Array<{ id: string; text: string }> = []
      const finalMarker = `DRAINED_RESPONSE_${suffix}`
      const requests: MockChatRequest['body'][] = []
      const retryRequests = new Set<MockChatRequest['body']>()
      const controllers = new Set<MockChatRequest>()
      const errors: string[] = []
      const onError = (error: Error) => errors.push(error.stack ?? error.message)
      page.on('pageerror', onError)
      let previous:
        | {
            language: UnifiedPreferenceType['app.language']
            onboarding: UnifiedPreferenceType['app.onboarding.provider_setup.status']
            naming: boolean
            privacy: string
          }
        | undefined
      let captured = false
      let tracing = false
      const screenshot = async (filename: string) => {
        const output = testInfo.outputPath(filename)
        await page.screenshot({ path: output })
        if (evidenceDir) {
          try {
            await mkdir(evidenceDir, { recursive: true })
            await copyFile(output, path.join(evidenceDir, `${suffix}-${filename}`))
          } catch (error) {
            console.warn('Failed to copy screenshot evidence', error)
          }
        }
        await testInfo.attach(filename, { path: output, contentType: 'image/png' })
        captured = true
      }
      const nextCorrelated = async (timeoutMs = 30_000) => {
        const deadline = Date.now() + timeoutMs
        while (Date.now() < deadline) {
          const request = await server.nextRequest(Math.max(1, deadline - Date.now()))
          controllers.add(request)
          void request.closed.then(() => controllers.delete(request))
          requests.push(request.body)
          if (
            request.body.model === server.modelId &&
            request.body.messages.some((message) => JSON.stringify(message).includes(initial))
          )
            return request
          request.complete('Unrelated background request complete')
        }
        throw new Error('No request correlated to the queued-terminal conversation')
      }
      try {
        await page.context().tracing.start({ screenshots: true, snapshots: true, sources: true })
        tracing = true
        previous = await page.evaluate(async () => ({
          language: await window.api.preference.get('app.language'),
          onboarding: await window.api.preference.get('app.onboarding.provider_setup.status'),
          naming: await window.api.preference.get('topic.naming.enabled'),
          privacy: await window.api.preference.get('app.privacy.policy_version')
        }))
        const languageSelect = page.locator('[data-onboarding-language-select]')
        await expect(
          uiLocator(page, 'chat.composer').or(languageSelect).filter({ visible: true }).first()
        ).toBeVisible()
        if (await languageSelect.isVisible()) {
          await languageSelect.getByRole('combobox').click()
          await page.getByRole('option', { name: 'English', exact: false }).click()
          await page.getByRole('button', { name: 'Set up later', exact: true }).click()
        }
        await page.evaluate(async (privacyVersion) => {
          await window.api.preference.set('app.privacy.policy_version', privacyVersion)
          await window.api.preference.set('app.language', 'en-US')
          await window.api.preference.set('app.onboarding.provider_setup.status', 'skipped')
          await window.api.preference.set('topic.naming.enabled', false)
        }, LATEST_PRIVACY_POLICY_VERSION)
        await selectSidebarApp(page, 'Chat')
        const responses = await page.evaluate(
          async ({ providerId, baseUrl, modelId }) => {
            const created = await window.api.dataApi.request({
              id: `${providerId}-create`,
              method: 'POST',
              path: '/providers',
              body: {
                providerId,
                name: 'Queued terminal mock',
                defaultChatEndpoint: 'openai-chat-completions',
                endpointConfigs: { 'openai-chat-completions': { baseUrl } },
                apiKeys: [{ id: 'mock-key', key: 'mock-key', isEnabled: true }]
              }
            })
            const enabled = await window.api.dataApi.request({
              id: `${providerId}-enable`,
              method: 'PATCH',
              path: `/providers/${providerId}`,
              body: { isEnabled: true }
            })
            const models = await window.api.dataApi.request({
              id: `${providerId}-model`,
              method: 'POST',
              path: '/models',
              body: [{ providerId, modelId, endpointTypes: ['openai-chat-completions'] }]
            })
            return [created.status, enabled.status, models.status]
          },
          { providerId, baseUrl: server.baseUrl, modelId: server.modelId }
        )
        expect(responses, 'Provider and model must be available for real HTTP sends').toEqual([201, 200, 201])
        const modelId = createUniqueModelId(providerId, server.modelId)
        let view: Locator
        if (variant === 'Chat') {
          const created = await page.evaluate(
            ({ name, modelId }) =>
              window.api.dataApi.request({ id: name, method: 'POST', path: '/assistants', body: { name, modelId } }),
            { name, modelId }
          )
          expect(created.status).toBe(201)
          await page.reload()
          await selectSidebarApp(page, 'Chat')
          view = page.locator('[data-ui~="chat.view"]:visible')
          const row = view.locator('[data-ui~="chat.group-header"]').filter({ hasText: name }).first()
          await row.hover()
          await row.getByRole('button', { name: 'New Chat', exact: true }).click()
          await expect(page.getByRole('button', { name: 'Selected models', exact: true })).toContainText(server.modelId)
        } else {
          const created = await page.evaluate(
            ({ name, model }) =>
              window.api.ipcApi.request('ai.agent.create', {
                type: 'pi',
                name,
                model,
                instructions: 'Answer briefly without using tools.'
              }),
            { name, model: modelId }
          )
          expect(created).toMatchObject({ ok: true })
          const agent = AgentEntitySchema.parse((created as { data: unknown }).data)
          const response = await page.evaluate(
            ({ agentId, name }) =>
              window.api.dataApi.request({
                id: name,
                method: 'POST',
                path: '/agent-sessions',
                body: { agentId, name, workspace: { type: 'system' } }
              }),
            { agentId: agent.id, name: `${name} session` }
          )
          expect(response.status).toBe(201)
          const session = AgentSessionEntitySchema.parse(response.data)
          sessionId = session.id
          await testInfo.attach('session', { body: JSON.stringify(session), contentType: 'application/json' })
          await page.reload()
          await selectSidebarApp(page, 'Chat')
          await selectSidebarApp(page, 'Work')
          view = uiLocator(page, 'agent.view').filter({ visible: true }).first()
          const header = view.getByText(name, { exact: true }).first()
          await header.click()
          const conversation = view.getByText(`${name} session`, { exact: true }).first()
          if (!(await conversation.isVisible())) {
            await header.hover()
            await view
              .getByRole('button', { name, exact: true })
              .first()
              .locator('..')
              .getByRole('button', { name: 'Expand', exact: true })
              .click()
          }
          await conversation.click()
        }
        const composer = uiLocator(view, 'chat.composer').filter({ visible: true })
        await expect(composer, 'Only the intended conversation composer should be visible').toHaveCount(1)
        const editor = composer.locator('[data-ui~="part:composer-input"] [contenteditable="true"]').first()
        await expect(editor).toBeEditable()
        await expect(editor).toHaveText('')
        await expect(view.getByRole('button', { name: /^Queued \(/ })).toHaveCount(0)
        const send = async (text: string) => {
          await editor.fill(text)
          const button = composer.getByRole('button', { name: 'Send', exact: true })
          await expect(button, 'The Send role is on an i element and uses aria-disabled').toHaveAttribute(
            'aria-disabled',
            'false'
          )
          await button.click()
        }
        await page.evaluate(async () => {
          const observation = window as unknown as ObservationWindow
          observation.terminalTimeline = []
          const record = (key: string, value: TopicStatusSnapshotEntry) => {
            if (key.startsWith('topic.stream.statuses.'))
              observation.terminalTimeline.push({ key, value, at: Date.now() })
          }
          observation.stopTerminalObservation = window.api.cache.onSync((message) => {
            if (message.type === 'shared') record(message.key, message.value)
          })
          const entries = await window.api.cache.getAllShared()
          for (const [key, entry] of Object.entries(entries)) record(key, entry.value)
        })
        await send(initial)
        const held = await nextCorrelated()
        expect(held.body.stream, 'The initial turn must be a real held-open stream').toBe(true)
        held.sendText(heldMarker)
        await expect(uiLocator(view, 'chat.message').filter({ hasText: heldMarker })).toBeVisible()
        await expect(editor).toHaveText('')
        await expect(composer.locator('[data-ui~="chat.composer.action.pause"]')).toBeVisible()
        await send(b)
        await expect(editor).toHaveText('')
        await expect(view.getByRole('button', { name: 'Queued (1)', exact: true })).toBeVisible()
        await send(c)
        await expect(view.getByRole('button', { name: 'Queued (2)', exact: true })).toBeVisible()
        if (terminal !== 'aborted') await editor.fill(d)
        const readTimeline = () => page.evaluate(() => (window as unknown as ObservationWindow).terminalTimeline)
        await expect
          .poll(async () => (await readTimeline()).some((entry) => entry.value.status === 'streaming'))
          .toBe(true)
        const active = (await readTimeline()).filter((entry) => entry.value.status === 'streaming').at(-1)!
        expect(active.value.turnId, 'The initial stream must publish its real lifecycle identity').toBeTruthy()
        topicId = active.key.slice('topic.stream.statuses.'.length)
        const latestUser = (request: MockChatRequest) =>
          JSON.stringify(
            request.body.messages.filter((message) => (message as { role?: string }).role === 'user').at(-1)
          )
        const turnHasStatus = async (statuses: string[]) =>
          (await readTimeline()).some(
            (entry) =>
              entry.key === active.key &&
              entry.value.turnId === active.value.turnId &&
              statuses.includes(entry.value.status)
          )
        const endTurn = async () => {
          let next: MockChatRequest | undefined
          const deadline = Date.now() + 90_000
          if (terminal === 'done') held.complete()
          else if (terminal === 'error') {
            held.fail(`UNIQUE_PROVIDER_ERROR_${suffix}`)
            let retries = 0
            while (retries < 6 && Date.now() < deadline && !(await turnHasStatus(['done', 'error', 'aborted']))) {
              let request: MockChatRequest
              try {
                request = await nextCorrelated(Math.min(5_000, Math.max(1, deadline - Date.now())))
              } catch (error) {
                if (error instanceof Error && error.message === 'Timed out waiting for a mock chat request') continue
                throw error
              }
              if (
                latestUser(request).includes(b) ||
                latestUser(request).includes(c) ||
                (await turnHasStatus(['done', 'error', 'aborted']))
              ) {
                next = request
                break
              }
              expect(latestUser(request), 'Only retries of the initial turn may be failed').toContain(initial)
              request.fail(`UNIQUE_PROVIDER_ERROR_${suffix}`)
              retryRequests.add(request.body)
              retries++
            }
          } else {
            await composer.locator('[data-ui~="chat.composer.action.pause"]').click()
            await held.closed
          }
          await expect
            .poll(() => turnHasStatus([terminal]), {
              timeout: terminal === 'error' ? Math.max(1, deadline - Date.now()) : undefined
            })
            .toBe(true)
          return next
        }
        const next = await endTurn()
        if (terminal === 'aborted') {
          await editor.fill(d)
          await expect(editor).toHaveText(d)
        }
        const drainedB = next ?? (await nextCorrelated())
        expect(
          latestUser(drainedB),
          'The latest user payload must be B, not accumulated history or editor D'
        ).toContain(b)
        expect(latestUser(drainedB)).not.toContain(c)
        expect(latestUser(drainedB)).not.toContain(d)
        drainedB.sendText(bMarker)
        await expect(uiLocator(view, 'chat.message').filter({ hasText: bMarker })).toBeVisible()
        const queued = view.getByRole('button', { name: 'Queued (1)', exact: true })
        await expect(queued).toBeVisible()
        if ((await queued.getAttribute('aria-expanded')) !== 'true') await queued.click()
        await expect(view.getByText(c, { exact: true })).toBeVisible()
        await expect(editor).toHaveText(d)
        expect(
          requests.filter(
            (body) =>
              !retryRequests.has(body) &&
              body.model === server.modelId &&
              body.messages.some((message) => JSON.stringify(message).includes(initial))
          )
        ).toHaveLength(2)
        await screenshot('queued-terminal-bravo-held.png')
        drainedB.complete()
        const drainedC = await nextCorrelated()
        expect(latestUser(drainedC)).toContain(c)
        expect(latestUser(drainedC)).not.toContain(d)
        drainedC.complete(finalMarker)
        await expect(uiLocator(view, 'chat.message').filter({ hasText: finalMarker })).toBeVisible({ timeout: 30_000 })
        await expect(view.getByRole('button', { name: /^Queued \(/ })).toHaveCount(0)
        await expect(editor).toHaveText(d)
        const readUsers = async () => {
          if (variant === 'Chat' && !topicId) throw new Error('Missing topicId for persisted Chat messages')
          if (variant === 'Work Agent' && !sessionId) throw new Error('Missing sessionId for persisted Agent messages')
          const result = await page.evaluate(
            ({ variant, topicId, sessionId }) =>
              window.api.dataApi.request({
                id: crypto.randomUUID(),
                method: 'GET',
                path: variant === 'Chat' ? `/topics/${topicId}/tree` : `/agent-sessions/${sessionId}/messages`,
                params: variant === 'Chat' ? undefined : { limit: 100 }
              }),
            { variant, topicId, sessionId }
          )
          expect(result.status).toBe(200)
          if (variant === 'Chat') {
            const data = result.data as { nodes: Array<{ id: string; role: string; preview?: string }> }
            return data.nodes.map((node) => ({ id: node.id, role: node.role, text: node.preview ?? '' }))
          }
          const data = result.data as { items: Array<{ id: string; role: string; data: unknown }> }
          return data.items.map((item) => ({ id: item.id, role: item.role, text: JSON.stringify(item) }))
        }
        await expect
          .poll(async () => {
            persistedUsers = (await readUsers()).filter((message) => message.role === 'user')
            return [initial, b, c].map((text) => persistedUsers.filter((message) => message.text.includes(text)).length)
          })
          .toEqual([1, 1, 1])
        expect(new Set(persistedUsers.map((message) => message.id)).size).toBe(persistedUsers.length)
        expect(persistedUsers).toHaveLength(3)
        expect((await readUsers()).some((message) => message.text.includes(d))).toBe(false)
        timeline = await readTimeline()
        const extraDeadline = Date.now() + 500
        while (Date.now() < extraDeadline) {
          let extra: MockChatRequest
          try {
            extra = await server.nextRequest(Math.max(1, extraDeadline - Date.now()))
          } catch (error) {
            if (error instanceof Error && error.message === 'Timed out waiting for a mock chat request') break
            throw error
          }
          requests.push(extra.body)
          extra.complete('Unexpected extra request complete')
        }
        expect(
          requests.filter(
            (body) =>
              !retryRequests.has(body) &&
              body.model === server.modelId &&
              body.messages.some((message) => JSON.stringify(message).includes(initial))
          ),
          'Only A, B and C may be submitted'
        ).toHaveLength(3)
      } finally {
        try {
          if (!captured) await screenshot('queued-terminal-failure.png')
        } finally {
          try {
            timeline = await page
              .evaluate(() => {
                const observation = window as unknown as ObservationWindow
                observation.stopTerminalObservation?.()
                return observation.terminalTimeline ?? []
              })
              .catch(() => timeline)
            await testInfo.attach('status-turn-timeline', {
              body: JSON.stringify(timeline, null, 2),
              contentType: 'application/json'
            })
            await testInfo.attach('persisted-user-messages', {
              body: JSON.stringify(
                { topicId, sessionId, count: persistedUsers.length, messages: persistedUsers },
                null,
                2
              ),
              contentType: 'application/json'
            })
            await testInfo.attach('requests-and-errors', {
              body: JSON.stringify(
                {
                  requests,
                  errors,
                  cwd: process.cwd(),
                  profile,
                  pid: electronApp.process().pid,
                  build: await stat(path.join(process.cwd(), 'out/main/main.js'))
                    .then((value) => ({ size: value.size, mtime: value.mtime.toISOString() }))
                    .catch(() => null)
                },
                null,
                2
              ),
              contentType: 'application/json'
            })
            if (tracing) {
              const trace = testInfo.outputPath('queued-terminal-trace.zip')
              await page.context().tracing.stop({ path: trace })
              await testInfo.attach('queued-terminal-trace', { path: trace, contentType: 'application/zip' })
            }
          } finally {
            page.off('pageerror', onError)
            try {
              if (previous)
                await page.evaluate(async (values) => {
                  await window.api.preference.set('app.language', values.language)
                  await window.api.preference.set('app.onboarding.provider_setup.status', values.onboarding)
                  await window.api.preference.set('topic.naming.enabled', values.naming)
                  await window.api.preference.set('app.privacy.policy_version', values.privacy)
                }, previous)
            } finally {
              for (const request of controllers) request.disconnect()
              await server.close()
            }
          }
        }
      }
    })
  }
}
