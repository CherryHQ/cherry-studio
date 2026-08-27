import { agentTable } from '@data/db/schemas/agent'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { agentSessionMessageService } from '@data/services/AgentSessionMessageService'
import { AgentSessionWorkspaceError } from '@main/ai/runtime/agentSessionWorkspace'
import { BaseService } from '@main/core/lifecycle/BaseService'
import {
  AgentSessionDeliveryOutcome,
  AgentSessionDeliveryReplyPolicy,
  AgentSessionDeliveryStatus
} from '@shared/ai/agentSessionDelivery'
import {
  ConversationKind,
  ConversationOutcomeKind,
  type ConversationRef,
  ConversationTerminalDurability,
  toConversationTurnId
} from '@shared/ai/conversation'
import { DataApiErrorFactory } from '@shared/data/api/errors'
import type { AgentSessionMessageEntity } from '@shared/data/api/schemas/agentSessionMessages'
import { setupTestDatabase } from '@test-helpers/db'
import { MockMainDbServiceExport } from '@test-mocks/main/DbService'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  dispatchAgentDelivery: vi.fn(),
  stop: vi.fn(),
  closeSession: vi.fn(),
  terminalListeners: new Set<(event: any) => void>(),
  crashRecoveryListeners: new Set<() => void>(),
  runtimeWriteQuiesced: false
}))

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  const module = mockApplicationFactory()
  const defaultGet = module.application.get.getMockImplementation()!
  module.application.get.mockImplementation((name: string) => {
    if (name === 'ConversationRuntimeService') {
      return {
        get isWriteQuiesced() {
          return mocks.runtimeWriteQuiesced
        },
        isCrashRecoveryComplete: true,
        dispatchAgentDelivery: mocks.dispatchAgentDelivery,
        stop: mocks.stop,
        onTurnTerminal: (listener: (event: any) => void) => {
          mocks.terminalListeners.add(listener)
          return { dispose: () => mocks.terminalListeners.delete(listener) }
        },
        onCrashRecoveryCompleted: (listener: () => void) => {
          mocks.crashRecoveryListeners.add(listener)
          return { dispose: () => mocks.crashRecoveryListeners.delete(listener) }
        }
      }
    }
    if (name === 'AgentConnectionManager') return { closeSession: mocks.closeSession }
    return defaultGet(name)
  })
  return module
})

const { AgentSessionDeliveryService } = await import('../AgentSessionDeliveryService')

const TARGET: ConversationRef = { kind: ConversationKind.Agent, id: 'target' }
const ASSISTANT_ID = '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d002'

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('AgentSessionDeliveryService', () => {
  const dbh = setupTestDatabase()

  async function seedWorkspace(id: string, type: 'user' | 'system' = 'user'): Promise<void> {
    await dbh.db.insert(agentWorkspaceTable).values({
      id,
      name: id,
      path: `/tmp/${id}`,
      type,
      orderKey: id
    })
  }

  async function seedAgent(id: string): Promise<void> {
    await dbh.db.insert(agentTable).values({
      id,
      type: 'claude-code',
      name: id,
      instructions: 'test',
      orderKey: id
    })
  }

  async function seedSession(id: string, agentId = 'agent-1', workspaceId = `${id}-workspace`): Promise<void> {
    if (
      !dbh.db
        .select()
        .from(agentWorkspaceTable)
        .all()
        .some((row) => row.id === workspaceId)
    ) {
      await seedWorkspace(workspaceId)
    }
    await dbh.db.insert(agentSessionTable).values({ id, agentId, workspaceId, name: id, orderKey: id })
  }

  function accept(
    replyPolicy: AgentSessionDeliveryReplyPolicy = AgentSessionDeliveryReplyPolicy.None
  ): AgentSessionMessageEntity {
    return agentSessionMessageService.acceptSessionDelivery({
      senderAgentId: 'agent-1',
      senderSessionId: 'sender',
      receiverSessionId: 'target',
      content: 'work',
      replyPolicy
    })
  }

  function saveAssistant(
    status: 'pending' | 'success' | 'paused' | 'error' = 'pending',
    id = ASSISTANT_ID
  ): AgentSessionMessageEntity {
    return agentSessionMessageService.saveMessage({
      sessionId: 'target',
      message: {
        id,
        role: 'assistant',
        status,
        data: { parts: status === 'success' ? [{ type: 'text', text: 'done' }] : [] }
      }
    })
  }

  function claim(request: AgentSessionMessageEntity, assistantId = ASSISTANT_ID): AgentSessionMessageEntity {
    return MockMainDbServiceExport.dbService.withWriteTx((tx) => {
      const claimed = agentSessionMessageService.claimSessionDeliveryTx(tx as never, 'target', request.id, assistantId)
      if (!claimed) throw new Error('delivery claim failed')
      return claimed
    }) as AgentSessionMessageEntity
  }

  function startedDispatch(assistantId = ASSISTANT_ID): void {
    mocks.dispatchAgentDelivery.mockImplementation(async (_subscriber, request: AgentSessionMessageEntity) => {
      saveAssistant('pending', assistantId)
      claim(request, assistantId)
      return { mode: 'started', turnId: 'turn-1' }
    })
  }

  function fireTerminal(
    outputNodeIds: readonly string[],
    outcome: ConversationOutcomeKind = ConversationOutcomeKind.Success,
    durability: ConversationTerminalDurability = ConversationTerminalDurability.Durable
  ): void {
    for (const listener of mocks.terminalListeners) {
      listener({
        conversation: TARGET,
        turnId: toConversationTurnId('turn-1'),
        outputNodeIds,
        durability,
        outcome:
          outcome === ConversationOutcomeKind.Error
            ? { kind: outcome, error: { name: 'Error', message: 'failed' } }
            : outcome === ConversationOutcomeKind.Paused
              ? { kind: outcome, reason: 'stopped' }
              : { kind: outcome }
      })
    }
  }

  beforeEach(async () => {
    BaseService.resetInstances()
    vi.clearAllMocks()
    mocks.terminalListeners.clear()
    mocks.runtimeWriteQuiesced = false
    mocks.dispatchAgentDelivery.mockResolvedValue(undefined)
    mocks.closeSession.mockResolvedValue(undefined)
    await seedAgent('agent-1')
    await seedSession('sender')
    await seedSession('target')
  })

  afterEach(() => {
    BaseService.resetInstances()
    vi.useRealTimers()
  })

  it('keeps an accepted row durable while the target is busy, then starts it after a terminal kick', async () => {
    const service = new AgentSessionDeliveryService()
    await service._doInit()
    const request = accept()

    service.kick('target')
    await service.drainInFlight({ timeoutMs: 100 })
    expect(agentSessionMessageService.getSessionMessage('target', request.id).delivery?.status).toBe(
      AgentSessionDeliveryStatus.Accepted
    )

    startedDispatch()
    fireTerminal(['unrelated-output'])
    await service.drainInFlight({ timeoutMs: 100 })
    expect(mocks.dispatchAgentDelivery).toHaveBeenCalledTimes(2)
    expect(agentSessionMessageService.getSessionMessage('target', request.id).delivery?.status).toBe(
      AgentSessionDeliveryStatus.Delivering
    )
  })

  it('reruns a coalesced kick that arrives before the blocked kick releases single-flight ownership', async () => {
    let release!: () => void
    mocks.dispatchAgentDelivery.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve(undefined)
        })
    )
    const service = new AgentSessionDeliveryService()
    await service._doInit()
    accept()
    service.kick('target')
    await vi.waitFor(() => expect(mocks.dispatchAgentDelivery).toHaveBeenCalledOnce())
    service.kick('target')
    startedDispatch()
    release()
    await service.drainInFlight({ timeoutMs: 100 })
    expect(mocks.dispatchAgentDelivery).toHaveBeenCalledTimes(2)
  })

  it('finalizes a terminal turn by durable turnRef instead of runtime queue state', async () => {
    const service = new AgentSessionDeliveryService()
    await service._doInit()
    const request = accept()
    saveAssistant('success')
    claim(request)

    fireTerminal([ASSISTANT_ID])
    await service.drainInFlight({ timeoutMs: 100 })

    expect(agentSessionMessageService.getSessionMessage('target', request.id).delivery).toMatchObject({
      status: AgentSessionDeliveryStatus.Consumed,
      outcome: AgentSessionDeliveryOutcome.Success
    })
  })

  it('does not finalize or schedule external delivery for a deferred-recovery terminal', async () => {
    const service = new AgentSessionDeliveryService()
    await service._doInit()
    const request = accept()
    saveAssistant()
    claim(request)
    mocks.dispatchAgentDelivery.mockClear()

    fireTerminal([ASSISTANT_ID], ConversationOutcomeKind.Paused, ConversationTerminalDurability.DeferredRecovery)
    await flush()

    expect(agentSessionMessageService.getSessionMessage('target', request.id).delivery?.status).toBe(
      AgentSessionDeliveryStatus.Delivering
    )
    expect(mocks.dispatchAgentDelivery).not.toHaveBeenCalled()
  })

  it('reconciles a persisted terminal delivery when runtime closes before the terminal event', async () => {
    const service = new AgentSessionDeliveryService()
    await service._doInit()
    const request = accept()
    saveAssistant('success')
    claim(request)

    service.kick('target')
    await service.drainInFlight({ timeoutMs: 100 })

    expect(agentSessionMessageService.getSessionMessage('target', request.id).delivery?.status).toBe(
      AgentSessionDeliveryStatus.Consumed
    )
  })

  it('waits for authoritative boot recovery before failing a pending delivery', async () => {
    const service = new AgentSessionDeliveryService()
    await service._doInit()
    const request = accept()
    saveAssistant()
    claim(request)

    service.kick('target')
    await service.drainInFlight({ timeoutMs: 100 })
    expect(agentSessionMessageService.getSessionMessage('target', request.id).delivery?.status).toBe(
      AgentSessionDeliveryStatus.Delivering
    )

    for (const listener of mocks.crashRecoveryListeners) listener()
    await service.drainInFlight({ timeoutMs: 100 })
    expect(agentSessionMessageService.getSessionMessage('target', request.id).delivery?.status).toBe(
      AgentSessionDeliveryStatus.Delivering
    )

    agentSessionMessageService.settlePendingAssistantMessage({
      sessionId: 'target',
      messageId: ASSISTANT_ID,
      status: 'error',
      data: { parts: [] }
    })
    for (const listener of mocks.crashRecoveryListeners) listener()
    await service.drainInFlight({ timeoutMs: 100 })
    expect(agentSessionMessageService.getSessionMessage('target', request.id).delivery).toMatchObject({
      status: AgentSessionDeliveryStatus.Consumed,
      outcome: AgentSessionDeliveryOutcome.Failed
    })
  })

  it('keeps a pending placeholder owned until its terminal row becomes authoritative', async () => {
    const service = new AgentSessionDeliveryService()
    await service._doInit()
    const request = accept()
    saveAssistant()
    claim(request)
    service.kick('target')
    await service.drainInFlight({ timeoutMs: 100 })
    expect(agentSessionMessageService.getSessionMessage('target', request.id).delivery?.status).toBe(
      AgentSessionDeliveryStatus.Delivering
    )

    agentSessionMessageService.settlePendingAssistantMessage({
      sessionId: 'target',
      messageId: ASSISTANT_ID,
      status: 'success',
      data: { parts: [{ type: 'text', text: 'done' }] }
    })
    service.kick('target')
    await service.drainInFlight({ timeoutMs: 100 })
    expect(agentSessionMessageService.getSessionMessage('target', request.id).delivery?.status).toBe(
      AgentSessionDeliveryStatus.Consumed
    )
  })

  it('ignores a terminal fact whose output does not own a delivery', async () => {
    const service = new AgentSessionDeliveryService()
    await service._doInit()
    const request = accept()
    saveAssistant()
    claim(request)
    fireTerminal(['row-roll-output'])
    await service.drainInFlight({ timeoutMs: 100 })
    expect(agentSessionMessageService.getSessionMessage('target', request.id).delivery?.status).toBe(
      AgentSessionDeliveryStatus.Delivering
    )
  })

  it('keeps a delivery owned when an execution fails after the actor committed its turn', async () => {
    const service = new AgentSessionDeliveryService()
    await service._doInit()
    const request = accept()
    startedDispatch()
    service.kick('target')
    await service.drainInFlight({ timeoutMs: 100 })

    agentSessionMessageService.settlePendingAssistantMessage({
      sessionId: 'target',
      messageId: ASSISTANT_ID,
      status: 'error',
      data: { parts: [] }
    })
    fireTerminal([ASSISTANT_ID], ConversationOutcomeKind.Error)
    await service.drainInFlight({ timeoutMs: 100 })
    expect(agentSessionMessageService.getSessionMessage('target', request.id).delivery).toMatchObject({
      status: AgentSessionDeliveryStatus.Consumed,
      outcome: AgentSessionDeliveryOutcome.Failed
    })
  })

  it('fails a recovered delivery whose assistant placeholder was deleted without replaying it', async () => {
    const service = new AgentSessionDeliveryService()
    await service._doInit()
    const request = accept()
    claim(request, 'missing-assistant')

    service.kick('target')
    await service.drainInFlight({ timeoutMs: 100 })

    expect(agentSessionMessageService.getSessionMessage('target', request.id).delivery).toMatchObject({
      status: AgentSessionDeliveryStatus.Failed,
      error: { code: 'DELIVERY_TURN_DELETED' }
    })
    expect(mocks.dispatchAgentDelivery).not.toHaveBeenCalled()
  })

  it('suppresses kicks while paused and compensates after the final hold releases', async () => {
    const service = new AgentSessionDeliveryService()
    await service._doInit()
    const hold = service.pause('backup')
    accept()
    service.kick('target')
    await flush()
    expect(mocks.dispatchAgentDelivery).not.toHaveBeenCalled()

    startedDispatch()
    hold.dispose()
    await service.drainInFlight({ timeoutMs: 100 })
    expect(mocks.dispatchAgentDelivery).toHaveBeenCalledOnce()
  })

  it('keeps pre-barrier dispatch work drain-visible while pause rejects new kicks', async () => {
    let release!: () => void
    mocks.dispatchAgentDelivery.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => resolve(undefined)
        })
    )
    const service = new AgentSessionDeliveryService()
    await service._doInit()
    accept()
    service.kick('target')
    await vi.waitFor(() => expect(mocks.dispatchAgentDelivery).toHaveBeenCalledOnce())
    const hold = service.pause('backup')

    const earlyDrain = await service.drainInFlight({ timeoutMs: 1 })
    expect(earlyDrain.stragglerIds).toEqual(['kick:target'])
    release()
    await service.drainInFlight({ timeoutMs: 100 })
    hold.dispose()
  })

  it('leaves ownership accepted when the Conversation owner rejects a stale target', async () => {
    const service = new AgentSessionDeliveryService()
    await service._doInit()
    const request = accept()
    mocks.dispatchAgentDelivery.mockResolvedValue(undefined)

    service.kick('target')
    await service.drainInFlight({ timeoutMs: 100 })

    expect(agentSessionMessageService.getSessionMessage('target', request.id).delivery?.status).toBe(
      AgentSessionDeliveryStatus.Accepted
    )
  })

  it('fails permanently when the Session loses its validated Agent before the commit', async () => {
    const service = new AgentSessionDeliveryService()
    await service._doInit()
    const request = accept()
    mocks.dispatchAgentDelivery.mockRejectedValue(DataApiErrorFactory.notFound('Session', 'target'))

    service.kick('target')
    await service.drainInFlight({ timeoutMs: 100 })

    expect(agentSessionMessageService.getSessionMessage('target', request.id).delivery).toMatchObject({
      status: AgentSessionDeliveryStatus.Failed,
      error: { code: 'TARGET_UNAVAILABLE' }
    })
  })

  it('revalidates instead of dispatching an Agent snapshot changed before the claim transaction', async () => {
    const service = new AgentSessionDeliveryService()
    await service._doInit()
    const request = accept()
    mocks.dispatchAgentDelivery.mockRejectedValueOnce(DataApiErrorFactory.concurrentModification('Agent', 'agent-1'))
    startedDispatch()

    service.kick('target')
    await service.drainInFlight({ timeoutMs: 100 })

    expect(mocks.dispatchAgentDelivery).toHaveBeenCalledTimes(2)
    expect(agentSessionMessageService.getSessionMessage('target', request.id).delivery?.status).toBe(
      AgentSessionDeliveryStatus.Delivering
    )
  })

  it('bounds repeated concurrent-modification revalidation instead of spinning on one durable row', async () => {
    const service = new AgentSessionDeliveryService()
    await service._doInit()
    accept()
    mocks.dispatchAgentDelivery.mockRejectedValue(DataApiErrorFactory.concurrentModification('Agent', 'agent-1'))

    service.kick('target')
    await service.drainInFlight({ timeoutMs: 100 })

    expect(mocks.dispatchAgentDelivery).toHaveBeenCalledTimes(2)
    expect(service.listActiveWork()).toEqual([])
  })

  it('retries an accepted delivery after its workspace becomes available without another event', async () => {
    vi.useFakeTimers()
    const service = new AgentSessionDeliveryService()
    await service._doInit()
    await service._doAllReady()
    accept()
    mocks.dispatchAgentDelivery.mockRejectedValue(new AgentSessionWorkspaceError('workspace unavailable', true))

    service.kick('target')
    vi.runAllTicks()
    await service.drainInFlight({ timeoutMs: 100 })
    expect(agentSessionMessageService.listAcceptedSessionDeliveries('target')).toHaveLength(1)

    startedDispatch()
    await vi.advanceTimersByTimeAsync(60_001)
    await service.drainInFlight({ timeoutMs: 100 })
    expect(mocks.dispatchAgentDelivery).toHaveBeenCalledTimes(2)
  })

  it('reinstalls its retry sweep when the service restarts', async () => {
    vi.useFakeTimers()
    const service = new AgentSessionDeliveryService()
    await service._doInit()
    await service._doAllReady()
    expect(vi.getTimerCount()).toBe(1)

    await service._doStop()
    expect(vi.getTimerCount()).toBe(0)

    await service._doInit()
    expect(vi.getTimerCount()).toBe(1)
  })

  it('commits deletion, closes target runtimes, then schedules the exact durable results', async () => {
    const service = new AgentSessionDeliveryService()
    await service._doInit()
    accept(AgentSessionDeliveryReplyPolicy.Completion)
    const order: string[] = []
    mocks.closeSession.mockImplementation(async (sessionId: string) => {
      order.push(`close:${sessionId}`)
    })
    mocks.dispatchAgentDelivery.mockImplementation(async (_subscriber, message: AgentSessionMessageEntity) => {
      order.push(`dispatch:${message.sessionId}`)
      return undefined
    })

    await service.deleteSessions(['target'])
    await service.drainInFlight({ timeoutMs: 100 })

    expect(order[0]).toBe('close:target')
    expect(order).toContain('dispatch:sender')
  })

  it('closes duplicate placeholder runtimes through the delivery owner', async () => {
    await seedWorkspace('system-workspace-newer', 'system')
    await seedWorkspace('system-workspace-duplicate', 'system')
    await dbh.db.insert(agentSessionTable).values([
      {
        id: 'placeholder-newer',
        agentId: 'agent-1',
        workspaceId: 'system-workspace-newer',
        name: '',
        orderKey: 'z2',
        updatedAt: 2
      },
      {
        id: 'placeholder-duplicate',
        agentId: 'agent-1',
        workspaceId: 'system-workspace-duplicate',
        name: '',
        orderKey: 'z1',
        updatedAt: 1
      }
    ])
    const service = new AgentSessionDeliveryService()
    await service._doInit()

    const result = await service.reuseOrCreateSession({ agentId: 'agent-1', workspace: { type: 'system' } })

    expect(result).toMatchObject({
      session: { id: 'placeholder-newer' },
      deletedDuplicateSessionIds: ['placeholder-duplicate']
    })
    expect(mocks.closeSession).toHaveBeenCalledWith('placeholder-duplicate')
  })

  it('keeps overlapping same-key deletions drain-visible until both settle', async () => {
    let release!: () => void
    mocks.closeSession.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve
        })
    )
    const service = new AgentSessionDeliveryService()
    await service._doInit()

    const first = service.deleteSessions(['target'])
    await vi.waitFor(() => expect(mocks.closeSession).toHaveBeenCalledWith('target'))
    await service.deleteSessions(['target'])
    const earlyDrain = await service.drainInFlight({ timeoutMs: 1 })
    expect(earlyDrain.stragglerIds).toEqual(expect.arrayContaining(['delete:target']))
    release()
    await first
    await expect(service.drainInFlight({ timeoutMs: 100 })).resolves.toEqual({ stragglerIds: [] })
  })

  it('closes every affected runtime when deleting an Agent', async () => {
    const service = new AgentSessionDeliveryService()
    await service._doInit()

    const result = await service.deleteAgent('agent-1', true)

    expect(result.deleted).toBe(true)
    expect(mocks.closeSession).toHaveBeenCalledWith('target')
    expect(mocks.closeSession).toHaveBeenCalledWith('sender')
  })

  it('stops an active retained Session before closing it after Agent deletion', async () => {
    const order: string[] = []
    mocks.stop.mockImplementation(() => order.push('stop'))
    mocks.closeSession.mockImplementation(async () => {
      order.push('close')
    })
    const service = new AgentSessionDeliveryService()
    await service._doInit()

    await service.deleteAgent('agent-1', false)

    expect(mocks.stop).toHaveBeenCalledWith(TARGET, 'target-agent-deleted')
    expect(order.indexOf('stop')).toBeLessThan(order.indexOf('close'))
  })

  it('deletes every Session owned by a protected Agent through the delivery owner', async () => {
    const service = new AgentSessionDeliveryService()
    await service._doInit()

    await expect(service.deleteAgentSessions('agent-1')).resolves.toEqual({
      deletedIds: expect.arrayContaining(['sender', 'target'])
    })
    expect(mocks.closeSession).toHaveBeenCalledWith('sender')
    expect(mocks.closeSession).toHaveBeenCalledWith('target')
  })

  it('closes deleted workspace runtimes through the delivery owner', async () => {
    const service = new AgentSessionDeliveryService()
    await service._doInit()

    await expect(service.deleteWorkspace('target-workspace')).resolves.toEqual({ deletedIds: ['target'] })
    expect(mocks.closeSession).toHaveBeenCalledWith('target')
  })
})
