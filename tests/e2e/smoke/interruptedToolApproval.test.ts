// Seed a legacy card with no waiter; Allow/Deny exercise production IPC without replaying the call, not a Windows reproduction.
// Unknown dynamic tools may have no settled message row, so assert card removal, persisted terminal state, and another turn.
import { randomUUID } from 'node:crypto'
import { copyFile, mkdir } from 'node:fs/promises'
import path from 'node:path'

import { AgentEntitySchema } from '../../../src/shared/data/api/schemas/agents'
import { AgentSessionMessageEntitySchema } from '../../../src/shared/data/api/schemas/agentSessionMessages'
import { AgentSessionEntitySchema } from '../../../src/shared/data/api/schemas/agentSessions'
import { AgentWorkspaceEntitySchema } from '../../../src/shared/data/api/schemas/agentWorkspaces'
import { createUniqueModelId } from '../../../src/shared/data/types/model'
import { LATEST_PRIVACY_POLICY_VERSION } from '../../../src/shared/utils/constants'
import { startMockChatServer, type MockChatRequest } from '../../helpers/http/mockChatServer'
import { selectSidebarApp } from '../regression/navigation'
import { expect, test } from './fixtures/electron.fixture'
import { uiLocator } from './utils/uiLocator'

for (const approved of [true, false]) {
  test(`interrupted agent approval ${approved ? 'Allow' : 'Deny'} settles history and admits another turn`, async ({
    mainWindow: page
  }, testInfo) => {
    test.setTimeout(120_000)
    const profile = process.env.CS_DEV_PROFILE_ROOT
    expect(profile, 'Use an isolated CS_DEV_PROFILE_ROOT').toBeTruthy()
    expect(path.isAbsolute(profile!)).toBe(true)
    const server = await startMockChatServer()
    const suffix = randomUUID()
    const name = `Interrupted approval ${suffix}`
    const providerId = `approval-${suffix}`
    const workspacePath = path.join(profile!, `approval-workspace-${suffix}`)
    await mkdir(workspacePath, { recursive: true })
    const screenshot = async (filename: string) => {
      const output = testInfo.outputPath(filename)
      await page.screenshot({ path: output })
      const evidence = path.resolve(
        process.env.TASKS ?? path.join(process.cwd(), '../.tasks/issue-22016'),
        'round-1/evidence'
      )
      await mkdir(evidence, { recursive: true })
      await copyFile(output, path.join(evidence, `${suffix}-${filename}`))
      await testInfo.attach(filename, { path: output, contentType: 'image/png' })
    }
    const previous = await page.evaluate(async () => ({
      language: await window.api.preference.get('app.language'),
      onboarding: await window.api.preference.get('app.onboarding.provider_setup.status'),
      naming: await window.api.preference.get('topic.naming.enabled'),
      privacyPolicyVersion: await window.api.preference.get('app.privacy.policy_version')
    }))
    const requests: MockChatRequest['body'][] = []
    const controllers = new Set<MockChatRequest>()
    try {
      await page.evaluate(async (privacyPolicyVersion) => {
        await window.api.preference.set('app.language', 'en-US')
        await window.api.preference.set('app.onboarding.provider_setup.status', 'skipped')
        await window.api.preference.set('topic.naming.enabled', false)
        await window.api.preference.set('app.privacy.policy_version', privacyPolicyVersion)
      }, LATEST_PRIVACY_POLICY_VERSION)
      const statuses = await page.evaluate(
        async ({ providerId, baseUrl, modelId }) => {
          const created = await window.api.dataApi.request({
            id: `${providerId}-create`,
            method: 'POST',
            path: '/providers',
            body: {
              providerId,
              name: 'Interrupted approval mock',
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
          const model = await window.api.dataApi.request({
            id: `${providerId}-model`,
            method: 'POST',
            path: '/models',
            body: [{ providerId, modelId, endpointTypes: ['openai-chat-completions'] }]
          })
          return [created.status, enabled.status, model.status]
        },
        { providerId, baseUrl: server.baseUrl, modelId: server.modelId }
      )
      expect(statuses).toEqual([201, 200, 201])
      const created = await page.evaluate(
        ({ name, model }) =>
          window.api.ipcApi.request('ai.agent.create', {
            type: 'pi',
            name,
            model,
            instructions: 'Answer briefly without using tools.',
            configuration: { permission_mode: 'default' }
          }),
        { name, model: createUniqueModelId(providerId, server.modelId) }
      )
      expect(created).toMatchObject({ ok: true })
      const agent = AgentEntitySchema.parse((created as { data: unknown }).data)
      const registered = await page.evaluate(
        ({ path, name }) => window.api.ipcApi.request('ai.agent.workspace.register', { path, name }),
        { path: workspacePath, name }
      )
      expect(registered).toMatchObject({ ok: true })
      const workspace = AgentWorkspaceEntitySchema.parse((registered as { data: unknown }).data)
      const reused = await page.evaluate(
        ({ agentId, workspaceId }) =>
          window.api.ipcApi.request('ai.agent.session.reuse_or_create', {
            agentId,
            workspace: { type: 'user', workspaceId }
          }),
        { agentId: agent.id, workspaceId: workspace.id }
      )
      expect(reused).toMatchObject({ ok: true })
      const session = AgentSessionEntitySchema.parse((reused as { data: { session: unknown } }).data.session)
      const renamed = await page.evaluate(
        ({ id, name }) =>
          window.api.dataApi.request({ id: name, method: 'PATCH', path: `/agent-sessions/${id}`, body: { name } }),
        { id: session.id, name: `${name} session` }
      )
      expect(renamed.status).toBe(200)
      const openSession = async () => {
        await page.reload()
        await expect(uiLocator(page, 'app.shell').first()).toBeVisible()
        await expect(uiLocator(page, 'app.sidebar').first()).toBeVisible()
        await expect(page.getByRole('button', { name: 'Set up later', exact: true })).toBeHidden()
        const dialogs = page.getByRole('dialog').filter({ visible: true })
        for (let attempt = 0; attempt < 3 && (await dialogs.count()) > 0; attempt++) {
          await page.keyboard.press('Escape')
          await expect(dialogs)
            .toHaveCount(0, { timeout: 500 })
            .catch(() => undefined)
        }
        expect(await dialogs.count(), 'Reload dialogs must close before navigating to Work').toBe(0)
        await selectSidebarApp(page, 'Work')
        const view = uiLocator(page, 'agent.view').filter({ visible: true }).first()
        await expect(view).toBeVisible()
        const header = view.getByText(name, { exact: true }).first()
        await header.click()
        const conversation = view.getByText(`${name} session`, { exact: true }).first()
        if (!(await conversation.isVisible())) {
          await header.hover()
          await uiLocator(view, 'chat.group-header')
            .filter({ hasText: name })
            .first()
            .getByRole('button', { name: 'Expand', exact: true })
            .click()
        }
        await conversation.click()
        return view
      }
      let view = await openSession()
      const sendAndComplete = async (prompt: string, answer: string) => {
        const composer = uiLocator(view, 'chat.composer').filter({ visible: true })
        const editor = composer.locator('[contenteditable="true"]').first()
        await expect(editor).toBeEditable()
        await editor.fill(prompt)
        await composer.getByRole('button', { name: 'Send', exact: true }).click()
        const deadline = Date.now() + 30_000
        while (Date.now() < deadline) {
          const request = await server.nextRequest(Math.max(1, deadline - Date.now()))
          controllers.add(request)
          void request.closed.then(() => controllers.delete(request))
          requests.push(request.body)
          const correlated = request.body.messages.some((message) => JSON.stringify(message).includes(prompt))
          request.complete(correlated ? answer : 'Unrelated background request')
          if (correlated) {
            await expect(uiLocator(view, 'chat.message').filter({ hasText: answer })).toBeVisible()
            await expect(uiLocator(view, 'chat.composer.action.pause')).toHaveCount(0)
            return
          }
        }
        throw new Error('No correlated agent request')
      }
      const initial = `INITIAL_${suffix}`
      const answer = `ANSWER_${suffix}`
      await sendAndComplete(initial, answer)
      const listMessages = async () => {
        const response = await page.evaluate(
          (id) =>
            window.api.dataApi.request({ id: `read-${id}`, method: 'GET', path: `/agent-sessions/${id}/messages` }),
          session.id
        )
        expect(response.status).toBe(200)
        return (response.data as { items: unknown[] }).items.map((item) => AgentSessionMessageEntitySchema.parse(item))
      }
      let assistant = (await listMessages()).find(
        (message) => message.role === 'assistant' && JSON.stringify(message.data).includes(answer)
      )
      expect(assistant).toBeDefined()
      await expect
        .poll(async () => (await listMessages()).find((message) => message.id === assistant!.id)?.status)
        .toBe('success')
      const approvalId = randomUUID()
      const patched = await page.evaluate(
        ({ sessionId, messageId, approvalId }) =>
          window.api.dataApi.request({
            id: approvalId,
            method: 'PATCH',
            path: `/agent-sessions/${sessionId}/messages/${messageId}`,
            body: {
              data: {
                parts: [
                  {
                    type: 'tool-install_skill',
                    toolCallId: `tool-${approvalId}`,
                    state: 'approval-requested',
                    approval: { id: approvalId },
                    input: { install_source: 'legacy-interrupted-fixture' }
                  }
                ]
              }
            }
          }),
        { sessionId: session.id, messageId: assistant!.id, approvalId }
      )
      expect(patched.status).toBe(200)
      view = await openSession()
      const permission = uiLocator(view, 'chat.permission-request-composer')
      await expect(permission).toBeVisible()
      await screenshot('pending.png')
      const reason = `Please skip this interrupted call ${suffix}`
      if (!approved) await permission.getByRole('textbox', { name: 'Reason for rejection (optional)' }).fill(reason)
      await permission.getByRole('button', { name: approved ? 'Allow' : 'Deny', exact: true }).click()
      await expect(permission).toHaveCount(0)
      await expect
        .poll(async () => {
          assistant = (await listMessages()).find((message) => message.id === assistant!.id)
          return assistant?.data.parts?.[0]
        })
        .toMatchObject({
          state: approved ? 'output-error' : 'output-denied',
          approval: { id: approvalId, approved, ...(!approved && { reason }) }
        })
      await expect(uiLocator(view, 'chat.composer').locator('[contenteditable="true"]').first()).toBeEditable()
      await screenshot(approved ? 'allowed-interrupted.png' : 'denied.png')
      await sendAndComplete(`FOLLOWUP_${suffix}`, `CONTINUED_${suffix}`)
      await screenshot('continued.png')
      expect(
        requests.filter((body) => body.messages.some((message) => JSON.stringify(message).includes(initial)))
      ).toHaveLength(2)
    } catch (error) {
      await screenshot('failure.png')
      throw error
    } finally {
      await testInfo.attach('requests', { body: JSON.stringify(requests), contentType: 'application/json' })
      try {
        await page.evaluate(async (values) => {
          await window.api.preference.set('app.language', values.language)
          await window.api.preference.set('app.onboarding.provider_setup.status', values.onboarding)
          await window.api.preference.set('topic.naming.enabled', values.naming)
          await window.api.preference.set('app.privacy.policy_version', values.privacyPolicyVersion)
        }, previous)
      } finally {
        for (const request of controllers) request.disconnect()
        await server.close()
      }
    }
  })
}
