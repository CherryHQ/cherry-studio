import { randomUUID } from 'node:crypto'
import { once } from 'node:events'

import { type ElectronApplication, type Page, type TestInfo } from '@playwright/test'

import { terminateExactProcess } from '../../../scripts/e2e/regression/process'
import { AgentEntitySchema } from '../../../src/shared/data/api/schemas/agents'
import { AgentSessionMessageEntitySchema } from '../../../src/shared/data/api/schemas/agentSessionMessages'
import { AgentSessionEntitySchema } from '../../../src/shared/data/api/schemas/agentSessions'
import { createUniqueModelId } from '../../../src/shared/data/types/model'
import { LATEST_PRIVACY_POLICY_VERSION } from '../../../src/shared/utils/constants'
import { type MockChatRequest, type MockChatServer, startMockChatServer } from '../../helpers/http/mockChatServer'
import { selectSidebarApp } from '../regression/helpers/navigation'
import { closeElectronApp, expect, launchSmokeElectron, test } from './fixtures/electron.fixture'
import { uiLocator } from './utils/uiLocator'

// AC7 of the Pi Durable turn-authority note: each scenario runs a real `pi-durable` session against a
// local scripted provider and checks the persisted replies, which are what the transcript renders.

type Session = { agentName: string; sessionName: string; sessionId: string }

const lastUserText = (request: MockChatRequest) =>
  JSON.stringify(request.body.messages.findLast((message) => (message as { role?: string }).role === 'user') ?? '')

/** Hands each provider request to the step that waits for its latest user input. */
function routeRequests(server: MockChatServer) {
  const arrived: MockChatRequest[] = []
  let open = true
  void (async () => {
    while (open) {
      try {
        arrived.push(await server.nextRequest(1_000))
      } catch (error) {
        if (!open || !(error instanceof Error) || !error.message.startsWith('Timed out')) return
      }
    }
  })()
  return {
    async next(marker: string, timeout = 45_000) {
      let found: MockChatRequest | undefined
      await expect
        .poll(() => (found = arrived.find((request) => lastUserText(request).includes(marker))) !== undefined, {
          timeout,
          message: `No model request answers ${marker}`
        })
        .toBe(true)
      arrived.splice(arrived.indexOf(found!), 1)
      return found!
    },
    /** Requests nobody claimed: a second submission of an input Durable already holds would land here. */
    unclaimed: () => arrived.map(lastUserText),
    close() {
      open = false
    }
  }
}

async function launch(): Promise<{ app: ElectronApplication; page: Page }> {
  const env = { ...process.env, NODE_ENV: 'development' }
  Reflect.deleteProperty(env, 'ELECTRON_RENDERER_URL')
  const app = await launchSmokeElectron({ args: ['.'], env, timeout: 60_000 })
  try {
    let page: Page | undefined
    await expect
      .poll(
        () => (page = app.windows().find((window) => /\/windows\/main\/index\.html(?:[?#]|$)/.test(window.url()))),
        {
          timeout: 60_000
        }
      )
      .toBeTruthy()
    await page!.waitForSelector('#root', { state: 'attached', timeout: 60_000 })
    return { app, page: page! }
  } catch (error) {
    try {
      await closeElectronApp(app)
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], 'Electron startup and cleanup failed')
    }
    throw error
  }
}

async function createSession(page: Page, server: MockChatServer): Promise<Session> {
  const suffix = randomUUID().slice(0, 8)
  const providerId = `durable-${suffix}`
  const agentName = `Durable agent ${suffix}`
  const sessionName = `Durable session ${suffix}`
  await page.evaluate(async (version) => {
    await window.api.preference.set('app.privacy.policy_version', version)
    await window.api.preference.set('app.onboarding.provider_setup.status', 'skipped')
    await window.api.preference.set('app.language', 'en-US')
    // Only the scenario's turns may reach the scripted provider.
    await window.api.preference.set('topic.naming.enabled', false)
    await window.api.preference.set('agent.input.suggestions.enabled', false)
  }, LATEST_PRIVACY_POLICY_VERSION)
  const statuses = await page.evaluate(
    async ({ providerId, baseUrl, modelId }) => {
      const created = await window.api.dataApi.request({
        id: `${providerId}-create`,
        method: 'POST',
        path: '/providers',
        body: {
          providerId,
          name: 'Durable mock',
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
  expect(statuses).toEqual([201, 200, 201])
  const created = await page.evaluate(
    ({ name, model }) =>
      window.api.ipcApi.request('ai.agent.create', {
        type: 'pi-durable',
        name,
        model,
        instructions: 'Answer briefly.'
      }),
    { name: agentName, model: createUniqueModelId(providerId, server.modelId) }
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
    { agentId: agent.id, name: sessionName }
  )
  expect(response.status).toBe(201)
  return { agentName, sessionName, sessionId: AgentSessionEntitySchema.parse(response.data).id }
}

async function openSession(page: Page, { agentName, sessionName }: Session) {
  await page.reload()
  await selectSidebarApp(page, 'Chat')
  await selectSidebarApp(page, 'Work')
  const view = uiLocator(page, 'agent.view').filter({ visible: true }).first()
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
  const editor = composer.locator('[data-ui~="part:composer-input"] [contenteditable="true"]').first()
  await expect(editor).toBeEditable()
  return {
    view,
    composer,
    message: (text: string) => uiLocator(view, 'chat.message').filter({ hasText: text }),
    async send(text: string) {
      await editor.fill(text)
      await composer.getByRole('button', { name: 'Send', exact: true }).click()
      await expect(editor).toHaveText('')
    },
    async steer(text: string) {
      await editor.fill(text)
      await editor.press('ControlOrMeta+Enter')
      await expect(editor).toHaveText('')
    }
  }
}

/** The persisted active path; the transcript and its error cards render from these rows. */
async function rows(page: Page, sessionId: string) {
  const result = await page.evaluate(
    (id) => window.api.dataApi.request({ id: `rows-${id}`, method: 'GET', path: `/agent-sessions/${id}/messages` }),
    sessionId
  )
  expect(result.status).toBe(200)
  // The endpoint pages newest first.
  return (result.data as { items: unknown[] }).items.toReversed().map((item) => {
    const row = AgentSessionMessageEntitySchema.parse(item)
    return {
      role: row.role,
      status: row.status,
      text: JSON.stringify(row.data.parts ?? []),
      parts: row.data.parts ?? []
    }
  })
}

const has = (text: string) => expect.stringContaining(text)

async function expectNoErrorCard(page: Page, sessionId: string) {
  const failed = (await rows(page, sessionId)).filter(
    (row) => row.status === 'error' || row.text.includes('"data-error"')
  )
  expect(failed, 'No reply may end in an error or carry a synthesized error part').toEqual([])
}

async function capture(page: Page, testInfo: TestInfo, name: string) {
  const path = testInfo.outputPath(`${name}.png`)
  await page.screenshot({ path })
  await testInfo.attach(name, { path, contentType: 'image/png' })
}

test.describe('Pi Durable turn authority in Electron', () => {
  test('queues a message sent during a turn in Durable and answers it in its own reply', async ({
    mainWindow: page
  }, testInfo) => {
    test.setTimeout(180_000)
    const server = await startMockChatServer()
    const route = routeRequests(server)
    try {
      const session = await createSession(page, server)
      const chat = await openSession(page, session)
      await chat.send('FIRST_QUESTION')
      const first = await route.next('FIRST_QUESTION')
      first.sendText('FIRST_PARTIAL ')
      await expect(chat.message('FIRST_PARTIAL')).toBeVisible()

      await chat.send('QUEUED_QUESTION')
      await expect(chat.view.getByRole('button', { name: /^Queued \(/ })).toHaveCount(0)
      await expect(chat.message('QUEUED_QUESTION')).toBeVisible()
      first.complete('FIRST_ANSWER')
      const queued = await route.next('QUEUED_QUESTION')
      queued.complete('QUEUED_ANSWER')

      await expect(chat.message('QUEUED_ANSWER')).toBeVisible()
      await expect
        .poll(async () =>
          (await rows(page, session.sessionId)).map(({ role, status, text }) => ({ role, status, text }))
        )
        .toMatchObject([
          { role: 'user', text: has('FIRST_QUESTION') },
          { role: 'assistant', status: 'success', text: has('FIRST_ANSWER') },
          { role: 'user', text: has('QUEUED_QUESTION') },
          { role: 'assistant', status: 'success', text: has('QUEUED_ANSWER') }
        ])
      expect((await rows(page, session.sessionId))[1].text).not.toContain('QUEUED_ANSWER')
      await expectNoErrorCard(page, session.sessionId)
      expect(route.unclaimed()).toEqual([])
      await capture(page, testInfo, 'queued-follow-up')
    } finally {
      route.close()
      await server.close()
    }
  })

  test('steers a running turn and continues in a new reply', async ({ mainWindow: page }, testInfo) => {
    test.setTimeout(180_000)
    const server = await startMockChatServer()
    const route = routeRequests(server)
    try {
      const session = await createSession(page, server)
      const chat = await openSession(page, session)
      await chat.send('STEER_SOURCE')
      const source = await route.next('STEER_SOURCE')
      source.sendText('SOURCE_PARTIAL ')
      await expect(chat.message('SOURCE_PARTIAL')).toBeVisible()

      await chat.steer('STEER_INPUT')
      await expect(chat.message('STEER_INPUT')).toBeVisible()
      // Durable places a steer before the next model call, so the run needs one more step.
      source.completeToolCall({ id: 'call-read', name: 'read', arguments: { path: 'steer-probe.txt' } })
      // The steer must wait through the approval and land on the call after it.
      await page.getByRole('button', { name: /^Allow/ }).click()
      const steered = await route.next('STEER_INPUT')
      steered.complete('STEER_ANSWER')

      await expect(chat.message('STEER_ANSWER')).toBeVisible()
      await expect
        .poll(async () =>
          (await rows(page, session.sessionId)).map(({ role, status, text }) => ({ role, status, text }))
        )
        .toMatchObject([
          { role: 'user', text: has('STEER_SOURCE') },
          { role: 'assistant', status: 'success', text: has('SOURCE_PARTIAL') },
          { role: 'user', text: has('STEER_INPUT') },
          { role: 'assistant', status: 'success', text: has('STEER_ANSWER') }
        ])
      await expectNoErrorCard(page, session.sessionId)
      expect(route.unclaimed()).toEqual([])
      await capture(page, testInfo, 'steer')
    } finally {
      route.close()
      await server.close()
    }
  })

  test('stops a turn without losing subagent content and answers the next message', async ({
    mainWindow: page
  }, testInfo) => {
    test.setTimeout(180_000)
    const server = await startMockChatServer()
    const route = routeRequests(server)
    try {
      const session = await createSession(page, server)
      const chat = await openSession(page, session)
      await chat.send('DELEGATING_QUESTION')
      const root = await route.next('DELEGATING_QUESTION')
      root.completeToolCall({
        id: 'call-subagent',
        name: 'subagent',
        arguments: { description: 'Scan notes', prompt: 'CHILD_TASK' }
      })
      const child = await route.next('CHILD_TASK')
      child.complete('CHILD_REPORT')
      const resumed = await route.next('DELEGATING_QUESTION')
      resumed.sendText('ROOT_PARTIAL ')
      await expect(chat.message('ROOT_PARTIAL')).toBeVisible()

      await chat.composer.locator('[data-ui~="chat.composer.action.pause"]').click()
      await resumed.closed
      await expect
        .poll(async () => (await rows(page, session.sessionId)).map(({ role, status }) => ({ role, status })))
        .toEqual([
          { role: 'user', status: 'success' },
          { role: 'assistant', status: 'paused' }
        ])
      // The subagent's own transcript must survive Stop, not just its call in the parent reply.
      await chat.view.getByRole('button', { name: /Subtasks/ }).click()
      await chat.view.getByRole('button', { name: /Scan notes/ }).click()
      await expect(page.getByText('CHILD_REPORT').first()).toBeVisible()

      await chat.send('AFTER_STOP')
      const next = await route.next('AFTER_STOP')
      next.complete('AFTER_STOP_ANSWER')
      await expect(chat.message('AFTER_STOP_ANSWER')).toBeVisible()
      await expect
        .poll(async () =>
          (await rows(page, session.sessionId)).map(({ role, status, text }) => ({ role, status, text }))
        )
        .toMatchObject([
          { role: 'user', text: has('DELEGATING_QUESTION') },
          { role: 'assistant', status: 'paused', text: has('CHILD_TASK') },
          { role: 'user', text: has('AFTER_STOP') },
          { role: 'assistant', status: 'success', text: has('AFTER_STOP_ANSWER') }
        ])
      await expectNoErrorCard(page, session.sessionId)
      expect(route.unclaimed()).toEqual([])
      await capture(page, testInfo, 'stop-and-resend')
    } finally {
      route.close()
      await server.close()
    }
  })

  test('finishes a running turn, its subagent content and its queued message after Main is killed', async ({}, testInfo) => {
    test.setTimeout(240_000)
    const server = await startMockChatServer()
    const route = routeRequests(server)
    let running: ElectronApplication | undefined
    let failed = false
    try {
      const first = await launch()
      running = first.app
      const session = await createSession(first.page, server)
      const chat = await openSession(first.page, session)
      await chat.send('CRASH_QUESTION')
      const delegating = await route.next('CRASH_QUESTION')
      delegating.completeToolCall({
        id: 'call-subagent',
        name: 'subagent',
        arguments: { description: 'Gather facts', prompt: 'CRASH_CHILD_TASK' }
      })
      const child = await route.next('CRASH_CHILD_TASK')
      child.complete('CRASH_CHILD_REPORT')
      const held = await route.next('CRASH_QUESTION')
      held.sendText('CRASH_PARTIAL ')
      await expect(chat.message('CRASH_PARTIAL')).toBeVisible()
      await chat.send('CRASH_QUEUED')
      await expect
        .poll(async () => (await rows(first.page, session.sessionId)).some((row) => row.text.includes('CRASH_QUEUED')))
        .toBe(true)
      // Main saves the user row, then submits it; give the native submission time to commit.
      await first.page.waitForTimeout(2_000)

      await test.step('Crash the owned Electron application', async () => {
        const child = first.app.process()
        const pid = child.pid
        if (!pid) throw new Error('Owned Electron process has no PID')
        await Promise.all([
          once(child, 'exit', { signal: AbortSignal.timeout(20_000) }),
          Promise.resolve().then(() => {
            if (process.platform === 'win32') terminateExactProcess(pid, 'windows')
            else if (!child.kill('SIGKILL')) throw new Error('Could not kill the owned Electron process')
          })
        ])
      })
      running = undefined
      let disconnected = false
      void held.closed.then(() => {
        disconnected = true
      })
      await expect
        .poll(() => disconnected, { timeout: 20_000, message: 'Crashed Electron must disconnect its held request' })
        .toBe(true)

      const second = await launch()
      running = second.app
      const reopened = await openSession(second.page, session)
      const resumed = await route.next('CRASH_QUESTION')
      resumed.complete('CRASH_ANSWER')
      const queued = await route.next('CRASH_QUEUED')
      queued.complete('CRASH_QUEUED_ANSWER')

      await expect(reopened.message('CRASH_QUEUED_ANSWER')).toBeVisible()
      await expect
        .poll(async () =>
          (await rows(second.page, session.sessionId)).map(({ role, status, text }) => ({ role, status, text }))
        )
        .toMatchObject([
          { role: 'user', text: has('CRASH_QUESTION') },
          { role: 'assistant', status: 'success', text: has('CRASH_ANSWER') },
          { role: 'user', text: has('CRASH_QUEUED') },
          { role: 'assistant', status: 'success', text: has('CRASH_QUEUED_ANSWER') }
        ])
      await reopened.view.getByRole('button', { name: /Subtasks/ }).click()
      await reopened.view.getByRole('button', { name: /Gather facts/ }).click()
      await expect(second.page.getByText('CRASH_CHILD_REPORT').first()).toBeVisible()
      await expectNoErrorCard(second.page, session.sessionId)
      expect(route.unclaimed()).toEqual([])
      await capture(second.page, testInfo, 'kill-and-reopen')
    } catch (error) {
      failed = true
      throw error
    } finally {
      try {
        route.close()
        // A failed step stays the reported error even if the app then cannot quit.
        if (running) await closeElectronApp(running).catch((error) => (failed ? undefined : Promise.reject(error)))
      } finally {
        await server.close()
      }
    }
  })
})
