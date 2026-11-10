import { setupTestDatabase } from '@test-helpers/db'
import { MockApplicationUtils } from '@test-mocks/main/application'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { agentTable } from '@data/db/schemas/agent'
import { agentService } from '@data/services/AgentService'
import { agentSessionMessageService as messages } from '@data/services/AgentSessionMessageService'
import { agentSessionService } from '@data/services/AgentSessionService'
import { agentWorkspaceService } from '@data/services/AgentWorkspaceService'
import { toolApprovalRegistry } from '@main/ai/toolApproval/ToolApprovalRegistry'
import { BaseService } from '@main/core/lifecycle/BaseService'
import { KeyedMutex } from '@shared/utils/async'

import { AgentDelegationService } from '../AgentDelegationService'
import { recoverSessionDeliveries } from '../recoverSessionDeliveries'

describe('delegation ownership and terminal results', () => {
  const dbh = setupTestDatabase()
  let service: AgentDelegationService
  let owner: string
  let other: string
  let workspaceId: string
  let liveTurn: string | undefined
  let running: ReturnType<typeof messages.createSessionWithDelivery> | undefined
  let stopped = false

  function create() {
    return messages.createSessionWithDelivery({
      senderAgentId: 'caller',
      senderSessionId: owner,
      targetAgentId: 'target',
      sessionName: 'Delegated',
      workspace: { type: 'user', workspaceId },
      content: 'Task',
      delegation: true
    })
  }
  function start(task: ReturnType<typeof create>, status: 'pending' | 'success' = 'pending') {
    const assistant = messages.saveMessage({
      sessionId: task.session.id,
      message: { role: 'assistant', status, data: { parts: [{ type: 'text', text: 'Partial work retained' }] } }
    })
    messages.transitionSessionDelivery(task.session.id, task.message.id, 'delivering', {
      expected: ['accepted'],
      turnRef: assistant.id
    })
    liveTurn = assistant.id
    running = task
    return assistant.id
  }
  beforeEach(() => {
    BaseService.resetInstances()
    service = new AgentDelegationService()
    liveTurn = undefined
    running = undefined
    stopped = false
    const lock = new KeyedMutex()
    MockApplicationUtils.setService('AgentSessionDeliveryService', { kick: () => {}, isWriteQuiesced: false })
    MockApplicationUtils.setService('AgentSessionRuntimeService', {
      getLiveAssistantMessageId: () => liveTurn,
      respondToolApproval: (id: string, decision: { approved: boolean }) =>
        !!toolApprovalRegistry.dispatch(id, decision)
    })
    MockApplicationUtils.setService('AiStreamManager', {
      isWriteQuiesced: false,
      abortAndDrain: (topic: string, _reason: string, before: () => void) =>
        lock.runExclusive(topic, async () => {
          before()
          stopped = true
          if (!running || !liveTurn) return
          toolApprovalRegistry.abort(running.session.id)
          messages.saveMessage({
            sessionId: running.session.id,
            message: {
              id: liveTurn,
              role: 'assistant',
              status: 'paused',
              data: { parts: [{ type: 'text', text: 'Partial work retained' }] }
            }
          })
          messages.finalizeSessionDelivery({
            requestSessionId: running.session.id,
            requestMessageId: running.message.id,
            assistantMessageId: liveTurn,
            outcome: 'interrupted'
          })
          liveTurn = undefined
        })
    })
    dbh.db
      .insert(agentTable)
      .values([
        { id: 'caller', type: 'claude-code', name: 'Caller', instructions: '', orderKey: 'a' },
        {
          id: 'target',
          type: 'local',
          name: 'Codex',
          instructions: '',
          orderKey: 'b',
          configuration: { localRuntime: { enabled: true, protocol: 'codex', args: [], env: {} } }
        }
      ])
      .run()
    workspaceId = agentWorkspaceService.findOrCreateByPath('/tmp/delegation-control-test').id
    const workspace = { type: 'user' as const, workspaceId }
    owner = agentSessionService.create({ agentId: 'caller', name: 'Owner', workspace }).id
    other = agentSessionService.create({ agentId: 'caller', name: 'Other', workspace }).id
  })
  afterEach(() => {
    toolApprovalRegistry.clear()
    MockApplicationUtils.resetServices()
    BaseService.resetInstances()
  })

  it('cancels queued work once without stopping another turn in the target session', async () => {
    const task = create()
    liveTurn = 'unrelated-turn'
    await service.cancel(owner, task.message.id)
    await service.cancel(owner, task.message.id)
    expect(stopped).toBe(false)
    expect(liveTurn).toBe('unrelated-turn')
    expect(service.read(owner, task.message.id)).toMatchObject({
      terminal: true,
      delivery: { error: { code: 'CANCELLED' } }
    })
    expect(
      messages
        .listSessionDeliveries({ sessionId: owner, requestId: task.message.id })
        .filter((m) => m.delivery?.inReplyTo)
    ).toHaveLength(1)
  })

  it('stops only the owned running turn, retaining partial output in one result', async () => {
    const task = create()
    start(task)
    await Promise.all([service.cancel(owner, task.message.id), service.cancel(owner, task.message.id)])
    expect(stopped).toBe(true)
    expect(service.read(owner, task.message.id)).toMatchObject({
      terminal: true,
      delivery: { outcome: 'interrupted', error: { code: 'CANCELLED' } }
    })
    const results = messages
      .listSessionDeliveries({ sessionId: owner, requestId: task.message.id })
      .filter((m) => m.delivery?.inReplyTo)
    expect(results).toHaveLength(1)
    expect(JSON.stringify(results[0].data)).toContain('Partial work retained')
    expect(results[0].delivery?.error?.code).toBe('CANCELLED')
  })

  it('does not cancel a newer execution when the recorded turn no longer owns the runtime', async () => {
    const task = create()
    start(task)
    liveTurn = 'later-user-turn'
    await service.cancel(owner, task.message.id)
    expect(stopped).toBe(false)
    expect(liveTurn).toBe('later-user-turn')
  })

  it('rejects another origin and never exposes or answers an unrelated approval', async () => {
    const task = create()
    start(task)
    let resolved: boolean | undefined
    toolApprovalRegistry.register({
      approvalId: 'approval',
      sessionId: task.session.id,
      toolCallId: 'tool',
      toolName: 'Bash',
      originalInput: { command: 'pwd' },
      resolve: (decision) => {
        resolved = decision.approved
      }
    })
    expect(() => service.read(other, task.message.id)).toThrow()
    await expect(service.cancel(other, task.message.id)).rejects.toThrow()
    expect(service.respond(owner, task.message.id, 'different-approval', { approved: true })).toBe(false)
    expect(resolved).toBeUndefined()
    expect(service.read(owner, task.message.id).approvals[0]).toMatchObject({
      approvalId: 'approval',
      input: { command: 'pwd' }
    })
    expect(service.respond(owner, task.message.id, 'approval', { approved: false })).toBe(true)
    expect(resolved).toBe(false)
    expect(service.read(owner, task.message.id).approvals).toEqual([])
  })

  it('reports a timeout as failure rather than successful or empty output', async () => {
    const task = create()
    start(task)
    await service.cancel(owner, task.message.id, 'TIMEOUT')
    expect(service.read(owner, task.message.id).delivery).toMatchObject({
      outcome: 'failed',
      error: { code: 'TIMEOUT' }
    })
    const result = messages
      .listSessionDeliveries({ sessionId: owner, requestId: task.message.id })
      .find((m) => m.delivery?.inReplyTo)
    expect(result?.delivery).toMatchObject({ outcome: 'failed', error: { code: 'TIMEOUT' } })
    expect(JSON.stringify(result?.data)).toContain('Partial work retained')
  })

  it('reconciles interrupted work without replay and without duplicate results after another restart', () => {
    const task = create()
    start(task)
    recoverSessionDeliveries()
    recoverSessionDeliveries()
    expect(service.read(owner, task.message.id).delivery.outcome).toBe('interrupted')
    expect(
      messages
        .listSessionDeliveries({ sessionId: owner, requestId: task.message.id })
        .filter((m) => m.delivery?.inReplyTo)
    ).toHaveLength(1)
  })

  it('cancels outstanding owned tasks before deleting the origin', async () => {
    const task = create()
    start(task)
    await service.cancelOwnedBy([owner])
    expect(stopped).toBe(true)
    expect(service.read(owner, task.message.id).delivery.error?.code).toBe('CALLER_SESSION_DELETED')
  })
  it('cancels work when the configured target is disabled', async () => {
    const task = create()
    start(task)
    await service._doInit()
    try {
      agentService.updateAgent('target', {
        configuration: { localRuntime: { enabled: false, protocol: 'codex', args: [], env: {} } }
      })
      await vi.waitFor(() => expect(service.read(owner, task.message.id).terminal).toBe(true))
      expect(stopped).toBe(true)
      expect(service.read(owner, task.message.id).delivery.error?.code).toBe('TARGET_UNAVAILABLE')
    } finally {
      await service._doStop()
    }
  })
})
