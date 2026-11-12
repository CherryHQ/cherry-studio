import { writeFile } from 'node:fs/promises'

import { expect, type Page, type TestInfo } from '@playwright/test'

import type { AgentSessionMessageEntity } from '@shared/data/api/schemas/agentSessionMessages'
import type { AgentSessionEntity } from '@shared/data/api/schemas/agentSessions'
import type { RendererPersistCacheSchema } from '@shared/data/cache/cacheSchemas'
import type { AgentEntity } from '@shared/data/types/agent'
import type { CherryMessagePart } from '@shared/data/types/message'
import type { IpcResult } from '@shared/ipc/errors/IpcError'

import { getSensitiveConfigValues } from '../../../../scripts/e2e/regression/config'
import { captureMaskedScreenshot } from '../../../../scripts/e2e/regression/screenshotEvidence'
import { createAgent, openAgentPane, selectAgentWorkspace } from '../helpers/agents'
import { ensureCustomChatProvider } from '../helpers/models'
import { closeSettings } from '../helpers/settings'
import type { RegressionApp } from '../RegressionApp'

export async function agentTaskPlanProjection(app: RegressionApp, page: Page, testInfo: TestInfo): Promise<void> {
  const name = app.resourceName(`MP-152 Task Plan ${Date.now()}`)
  const view = page.locator('[data-ui~="agent.view"]:visible').first()
  const capsule = view.getByTestId('agent-task-progress-capsule')
  const progress = capsule.getByRole('progressbar')
  const observations: Record<string, unknown>[] = []
  testInfo.annotations.push({
    type: 'data-source',
    description: 'Real Pi reply persisted first; task tool parts seeded through DataApi to reproduce #24170.'
  })
  try {
    await page.evaluate(({ path, name }) => window.api.ipcApi.request('ai.agent.workspace.register', { path, name }), {
      path: app.paths.workspace,
      name: app.workspaceName
    })
    const providerId = await ensureCustomChatProvider(app, page)
    await closeSettings(page)
    await createAgent(page, {
      name,
      runtime: 'Pi',
      providerId,
      model: app.config.customProvider.chatModel,
      permission: 'Full Access'
    })
    await selectAgentWorkspace(app, page)
    await view
      .locator('[data-ui~="chat.composer"] [contenteditable="true"]')
      .first()
      .fill('Reply with the single word OK.')
    await view.getByRole('button', { name: 'Send', exact: true }).click()

    // Tab routes use MemoryRouter; the document URL does not contain the session query.
    let sessionId: string | null = null
    await expect
      .poll(
        async () => {
          sessionId = await page.evaluate(async (name) => {
            const cache = JSON.parse(localStorage.getItem('cs_cache_persist') ?? '{}') as RendererPersistCacheSchema
            const tabs = [...(cache['ui.tab.normal_tabs'] ?? []), ...(cache['ui.tab.pinned_tabs'] ?? [])]
            const tab = tabs.find((item) => item.id === cache['ui.tab.active_tab_id'])
            const id = tab ? new URL(tab.url, 'https://cherry.invalid').searchParams.get('sessionId') : null
            if (!id) return null
            const session = await window.api.dataApi.request({
              id: 'mp152-route-session',
              method: 'GET',
              path: `/agent-sessions/${id}`
            })
            if (session.status !== 200) return null
            const agentId = (session.data as AgentSessionEntity).agentId
            const agent = await window.api.dataApi.request({
              id: 'mp152-route-agent',
              method: 'GET',
              path: `/agents/${agentId}`
            })
            return agent.status === 200 && (agent.data as AgentEntity).name === name ? id : null
          }, name)
          return sessionId
        },
        { timeout: 30_000 }
      )
      .toBeTruthy()

    let assistant: AgentSessionMessageEntity | undefined
    await expect
      .poll(
        async () => {
          const result = await page.evaluate(
            (id) =>
              window.api.dataApi.request({
                id: 'mp152-history',
                method: 'GET',
                path: `/agent-sessions/${id}/messages`,
                params: { limit: 200 }
              }),
            sessionId
          )
          expect(result.status).toBe(200)
          assistant = (result.data as { items: AgentSessionMessageEntity[] }).items.find(
            (message) => message.role === 'assistant' && (message.data.parts?.length ?? 0) > 0
          )
          return assistant?.status
        },
        { timeout: 120_000 }
      )
      .toBe('success')
    const messageId = assistant!.id
    await expect(view.getByRole('button', { name: 'Pause', exact: true })).toBeHidden()
    await expect(view.getByRole('button', { name: 'Send', exact: true })).toBeVisible()

    const createFirst: CherryMessagePart = {
      type: 'dynamic-tool',
      toolName: 'TaskCreate',
      toolCallId: 'seed-create-1',
      state: 'output-available',
      input: { subject: 'Inspect project setup' },
      output: 'Task #1 created successfully: Inspect project setup'
    }
    const phases: { phase: string; screenshot: string; parts: CherryMessagePart[] }[] = [
      {
        phase: 'A',
        screenshot: 'MP-152 finished turn without stale running step',
        parts: [
          createFirst,
          {
            type: 'dynamic-tool',
            toolName: 'TaskUpdate',
            toolCallId: 'seed-update-1',
            state: 'output-available',
            input: { taskId: '1', status: 'in_progress' },
            output: 'Updated task #1 status'
          },
          {
            type: 'dynamic-tool',
            toolName: 'TaskList',
            toolCallId: 'seed-list-1',
            state: 'output-available',
            input: {},
            output: 'No tasks found'
          }
        ]
      },
      {
        phase: 'B',
        screenshot: 'MP-152 deleted task leaves the step list',
        parts: [
          createFirst,
          {
            type: 'dynamic-tool',
            toolName: 'TaskCreate',
            toolCallId: 'seed-create-2',
            state: 'output-available',
            input: { subject: 'Write handoff notes' },
            output: 'Task #2 created successfully: Write handoff notes'
          },
          {
            type: 'dynamic-tool',
            toolName: 'TaskUpdate',
            toolCallId: 'seed-delete-2',
            state: 'output-available',
            input: { taskId: '2', status: 'deleted' },
            output: { success: true }
          }
        ]
      }
    ]
    phases.push({
      phase: 'C',
      screenshot: 'MP-152 unfinished task after reply ends',
      parts: [
        createFirst,
        {
          type: 'dynamic-tool',
          toolName: 'TaskUpdate',
          toolCallId: 'seed-unfinished',
          state: 'output-available',
          input: { taskId: '1', status: 'in_progress' },
          output: 'Updated task #1 status'
        }
      ]
    })
    for (const phase of phases) {
      const patched = await page.evaluate(
        async ({ sessionId, messageId, serializedParts }) => {
          const path = `/agent-sessions/${sessionId}/messages/${messageId}`
          const existing = await window.api.dataApi.request({ id: 'mp152-read-message', method: 'GET', path })
          if (existing.status !== 200) throw new Error('Cannot read case assistant message before patching')
          const message = existing.data as AgentSessionMessageEntity
          const parts = JSON.parse(serializedParts) as CherryMessagePart[]
          return window.api.dataApi.request({
            id: 'mp152-patch-message',
            method: 'PATCH',
            path,
            body: { data: { ...message.data, parts } }
          })
        },
        { sessionId, messageId, serializedParts: JSON.stringify(phase.parts) }
      )
      expect(patched.status).toBe(200)
      await page.reload()
      const opened = (await page.evaluate(
        (id) =>
          window.api.ipcApi.request('navigation.open_route_in_main', {
            path: `/app/agents?sessionId=${id}`
          }),
        sessionId
      )) as IpcResult<void>
      expect(opened.ok).toBe(true)
      await expect(view).toBeVisible({ timeout: 30_000 })
      await expect(view.locator(`[data-ui~="chat.message"][data-message-id="${messageId}"]`)).toBeVisible()

      await expect(capsule).toBeHidden()
      await expect(progress).toBeHidden()
      await openAgentPane(page, 'Session details')
      const details = page.getByRole('dialog', { name: 'Session details', exact: true })
      const plan = details.getByRole('button', { name: /^Plan/ })
      if (phase.phase === 'A') {
        await expect(plan).toBeHidden()
      } else {
        await expect(plan).toContainText('0 / 1')
        if ((await plan.getAttribute('aria-expanded')) !== 'true') await plan.click()
        await expect(details.getByText('Inspect project setup', { exact: true })).toBeVisible()
        await expect(details.getByText('Write handoff notes', { exact: true })).toBeHidden()
        await expect(details.getByRole('img', { name: 'Running', exact: true })).toBeHidden()
      }
      observations.push({
        phase: phase.phase,
        capsuleVisible: await capsule.isVisible(),
        progressVisible: await progress.isVisible(),
        completed: (await progress.count()) ? await progress.getAttribute('aria-valuenow') : null,
        total: (await progress.count()) ? await progress.getAttribute('aria-valuemax') : null,
        tasks: phase.phase === 'A' ? [] : await details.locator('ol li').allTextContents()
      })
      const path = testInfo.outputPath(`${phase.screenshot}.png`)
      await writeFile(path, await captureMaskedScreenshot(page, getSensitiveConfigValues()))
      await testInfo.attach(phase.screenshot, { path, contentType: 'image/png' })
    }
  } finally {
    await testInfo.attach('MP-152 observed progress', {
      body: JSON.stringify(observations, null, 2),
      contentType: 'application/json'
    })
    const cleanupErrors = await page
      .evaluate(async (name) => {
        const errors: string[] = []
        const agents = await window.api.dataApi.request({
          id: 'mp152-cleanup-agents',
          method: 'GET',
          path: '/agents',
          params: { limit: 500 }
        })
        if (agents.status !== 200) return ['Cannot list case agents for cleanup']
        const ownedAgents = (agents.data as { items: AgentEntity[] }).items.filter((agent) => agent.name === name)
        const sessions = await window.api.dataApi.request({
          id: 'mp152-cleanup-sessions',
          method: 'GET',
          path: '/agent-sessions',
          params: { limit: 200 }
        })
        if (sessions.status !== 200) return ['Cannot list case sessions for cleanup']
        const ownedSessions = (sessions.data as { items: AgentSessionEntity[] }).items.filter((session) =>
          ownedAgents.some((agent) => agent.id === session.agentId)
        )
        for (const session of ownedSessions) {
          const stopped = (await window.api.ipcApi.request('ai.stream.abort', {
            topicId: `agent-session:${session.id}`
          })) as IpcResult<void>
          if (!stopped.ok) errors.push(`Cannot stop case session ${session.id}`)
        }
        for (const agent of ownedAgents) {
          const deleted = (await window.api.ipcApi.request('ai.agent.delete_permanently', {
            agentId: agent.id,
            deleteSessions: true
          })) as IpcResult<{ deleted: boolean }>
          if (!deleted.ok || !deleted.data.deleted) errors.push(`Cannot delete case agent ${agent.id}`)
        }
        const remainingAgents = await window.api.dataApi.request({
          id: 'mp152-verify-agents',
          method: 'GET',
          path: '/agents',
          params: { limit: 500 }
        })
        if (
          remainingAgents.status !== 200 ||
          (remainingAgents.data as { items: AgentEntity[] }).items.some((agent) => agent.name === name)
        )
          errors.push('Cleanup left the case agent active')
        const remainingSessions = await window.api.dataApi.request({
          id: 'mp152-verify-sessions',
          method: 'GET',
          path: '/agent-sessions',
          params: { limit: 200 }
        })
        if (
          remainingSessions.status !== 200 ||
          (remainingSessions.data as { items: AgentSessionEntity[] }).items.some((session) =>
            ownedAgents.some((agent) => agent.id === session.agentId)
          )
        )
          errors.push('Cleanup left case sessions active')
        return errors
      }, name)
      .catch((error) => [String(error)])
    expect.soft(cleanupErrors, 'Case cleanup must not leave resources or mask the original failure').toEqual([])
  }
}
