import { expect } from '@playwright/test'

import { prepareAuthenticatedProfile } from '../../../../scripts/e2e/ondemand/profile'
import type { ScenarioContext } from '../../../../scripts/e2e/ondemand/steps'
import { FollowupQueueScopeQuerySchema } from '../../../../src/shared/data/api/schemas/followupQueues'
import { startMockChatServer } from '../../../helpers/http/mockChatServer'
import { createAgent } from '../../regression/agents'
import { selectSidebarApp } from '../../regression/navigation'

/**
 * Catches a normal Send bypassing the persistent follow-up queue during a live
 * agent stream. Only the provider HTTP boundary is simulated. The Electron UI,
 * preload, main-process queue and completion-driven delivery remain real.
 * Does not claim vendor-model integration, multi-window or restart coverage.
 */
export default async function queueLoopback(context: ScenarioContext): Promise<void> {
  const { page } = context
  const server = await startMockChatServer()
  try {
    await prepareAuthenticatedProfile(page, {
      baseUrl: server.baseUrl,
      apiKey: 'local-fixture-not-a-secret',
      model: server.modelId
    })
    await page.evaluate(() =>
      window.api.preference.setMultiple({
        'app.language': 'en-US',
        'topic.naming.enabled': false,
        'feature.quick_assistant.enabled': false,
        'feature.selection.enabled': false
      })
    )
    await page.reload()
    await createAgent(page, { name: 'Loopback Queue Probe', runtime: 'Pi', model: server.modelId })
    await selectSidebarApp(page, 'Work')
    const view = page.locator('[data-ui~="agent.view"]:visible').first()
    await view.getByText('Loopback Queue Probe', { exact: true }).first().click()
    const input = view.locator('[data-ui~="chat.composer"] [contenteditable="true"]').first()
    await expect(input).toBeVisible({ timeout: 30_000 })
    await input.fill('QUEUE_FIRST_SYNTHETIC')
    await view.getByRole('button', { name: 'Send', exact: true }).click()
    const first = await server.nextRequest(60_000)
    expect(JSON.stringify(first.body.messages)).toContain('QUEUE_FIRST_SYNTHETIC')
    expect(first.body.stream).toBe(true)
    first.sendText('LOOPBACK_STREAM_OPEN')
    await expect(view.getByText('LOOPBACK_STREAM_OPEN', { exact: false }).last()).toBeVisible()

    // Click ordinary Send, never the steer shortcut. The provider stream stays
    // open until the queued state and its screenshot have been observed.
    await input.fill('QUEUE_SECOND_SYNTHETIC')
    await view.getByRole('button', { name: 'Send', exact: true }).click()
    await context.runSteps([
      { verb: 'expectText', text: 'Queued (1)', timeout: 30_000 },
      { verb: 'expectText', text: 'QUEUE_SECOND_SYNTHETIC', timeout: 30_000 },
      { verb: 'screenshot', name: 'queue-during-loopback-stream' }
    ])
    const agentResponse = await page.evaluate(() =>
      window.api.dataApi.request({
        id: 'loopback-agent-proof',
        method: 'GET',
        path: '/agents',
        params: { page: 1, limit: 500 }
      })
    )
    expect(agentResponse.status).toBe(200)
    const agents = (agentResponse.data as { items: Array<{ id: string; name: string }> }).items.filter(
      (agent) => agent.name === 'Loopback Queue Probe'
    )
    expect(agents).toHaveLength(1)
    const sessionResponse = await page.evaluate(
      (agentId) =>
        window.api.dataApi.request({
          id: 'loopback-session-proof',
          method: 'GET',
          path: '/agent-sessions',
          params: { agentId, limit: 200 }
        }),
      agents[0].id
    )
    expect(sessionResponse.status).toBe(200)
    // This fresh synthetic agent has one task. Bind persistence to that exact
    // session, never a globally latest task or a generated display name.
    const sessions = (sessionResponse.data as { items: Array<{ id: string }> }).items
    expect(sessions).toHaveLength(1)
    const scope = FollowupQueueScopeQuerySchema.parse({ scopeKey: `agent-session:${sessions[0].id}` })
    const readQueue = () =>
      page.evaluate(
        (params) =>
          window.api.dataApi.request({ id: 'loopback-queue-proof', method: 'GET', path: '/followup-queues', params }),
        scope
      )
    const queue = await readQueue()
    expect(queue.status).toBe(200)
    expect(queue.data).toEqual([
      expect.objectContaining({
        scopeKey: scope.scopeKey,
        payload: expect.objectContaining({ text: 'QUEUE_SECOND_SYNTHETIC' })
      })
    ])
    first.complete('\nLOOPBACK_FIRST_COMPLETE')
    const second = await server.nextRequest(60_000)
    expect(
      JSON.stringify(second.body.messages.filter((message) => (message as { role?: string }).role === 'user').at(-1))
    ).toContain('QUEUE_SECOND_SYNTHETIC')
    second.complete('LOOPBACK_SECOND_COMPLETE')
    await expect(view.getByText('LOOPBACK_SECOND_COMPLETE', { exact: false }).last()).toBeVisible({ timeout: 60_000 })
    await expect(page.getByText('Queued (1)', { exact: true })).toBeHidden({ timeout: 30_000 })
    await expect
      .poll(
        async () => {
          const settled = await readQueue()
          expect(settled.status).toBe(200)
          return settled.data
        },
        { timeout: 30_000 }
      )
      .toEqual([])
    await context.runSteps([
      { verb: 'expectText', text: 'LOOPBACK_SECOND_COMPLETE', timeout: 30_000 },
      { verb: 'screenshot', name: 'agent-followup-auto-drained' }
    ])
  } finally {
    await server.close()
    await context.ensureChinese()
  }
}
