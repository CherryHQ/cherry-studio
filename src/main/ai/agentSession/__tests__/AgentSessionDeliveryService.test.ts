import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { BaseService } from '@main/core/lifecycle/BaseService'
import { DataApiErrorFactory } from '@shared/data/api/errors'

const mocks = vi.hoisted(() => ({
  accept: vi.fn(),
  acceptWithNewSession: vi.fn(),
  claim: vi.fn(),
  fail: vi.fn(),
  finalize: vi.fn(),
  findByTurnRef: vi.fn(),
  getMessage: vi.fn(),
  markTerminalError: vi.fn(),
  publishDispatchChanges: vi.fn(),
  listAccepted: vi.fn(),
  listRecoverable: vi.fn(),
  resolveCrash: vi.fn(),
  reuseOrCreate: vi.fn(),
  deleteByIds: vi.fn(),
  deleteByAgentId: vi.fn(),
  deleteAgent: vi.fn(),
  deleteWorkspace: vi.fn(),
  validateDispatch: vi.fn(),
  persistDispatchTx: vi.fn(),
  activateDispatch: vi.fn(),
  send: vi.fn(),
  hasLiveStream: vi.fn(),
  pauseRuntimeTurn: vi.fn(),
  hasTerminalPersistenceInFlight: vi.fn(),
  runtimeBusy: vi.fn(),
  closeSession: vi.fn(),
  terminalListeners: new Set<(event: any) => void>(),
  idleListeners: new Set<(event: any) => void>()
}))

vi.mock('@data/services/AgentSessionMessageService', () => ({
  AgentSessionDeliveryRoutingError: class extends Error {
    constructor(
      readonly code: string,
      message: string
    ) {
      super(message)
    }
  },
  agentSessionMessageService: {
    acceptSessionDelivery: mocks.accept,
    createSessionWithDelivery: mocks.acceptWithNewSession,
    claimSessionDeliveryTx: mocks.claim,
    failSessionDelivery: mocks.fail,
    finalizeSessionDelivery: mocks.finalize,
    findDeliveringSessionDeliveryByTurnRef: mocks.findByTurnRef,
    getSessionMessage: mocks.getMessage,
    markAssistantMessageTerminalError: mocks.markTerminalError,
    publishDispatchChanges: mocks.publishDispatchChanges,
    listAcceptedSessionDeliveries: mocks.listAccepted,
    listRecoverableSessionDeliveries: mocks.listRecoverable,
    resolveCrashOrphanedMessages: mocks.resolveCrash
  }
}))

vi.mock('@main/ai/runtime/agentSessionWorkspace', () => ({
  isAgentSessionWorkspaceError: (error: unknown) =>
    error instanceof Error && error.name === 'AgentSessionWorkspaceError'
}))

vi.mock('@data/services/AgentSessionService', () => ({
  agentSessionService: {
    reuseOrCreatePlaceholderForDelivery: mocks.reuseOrCreate,
    deleteByIdsForDelivery: mocks.deleteByIds,
    deleteByAgentIdForDelivery: mocks.deleteByAgentId,
    deleteWorkspaceCascadeForDelivery: mocks.deleteWorkspace
  }
}))

vi.mock('@data/services/AgentService', () => ({
  agentService: { deleteAgentForDelivery: mocks.deleteAgent }
}))

vi.mock('../../streamManager/context/AgentChatContextProvider', () => ({
  agentChatContextProvider: {
    validateDispatch: mocks.validateDispatch,
    persistDispatchTx: mocks.persistDispatchTx,
    activateDispatch: mocks.activateDispatch
  }
}))

const runtime = {
  isSessionBusy: mocks.runtimeBusy,
  closeSession: mocks.closeSession,
  onTurnTerminal: (listener: (event: any) => void) => {
    mocks.terminalListeners.add(listener)
    return { dispose: () => mocks.terminalListeners.delete(listener) }
  },
  onRuntimeIdle: (listener: (event: any) => void) => {
    mocks.idleListeners.add(listener)
    return { dispose: () => mocks.idleListeners.delete(listener) }
  }
}
const manager = {
  isWriteQuiesced: false,
  withDispatchLock: (_topicId: string, fn: () => Promise<void>) => fn(),
  hasLiveStream: mocks.hasLiveStream,
  pauseRuntimeTurn: mocks.pauseRuntimeTurn,
  hasTerminalPersistenceInFlight: mocks.hasTerminalPersistenceInFlight,
  send: mocks.send
}
const dbService = {
  withWriteTx: (fn: (tx: object) => unknown) => fn({})
}

vi.mock('@application', () => ({
  application: {
    get: (name: string) => {
      if (name === 'AgentSessionRuntimeService') return runtime
      if (name === 'AiStreamManager') return manager
      if (name === 'DbService') return dbService
      throw new Error(`Unexpected application.get(${name})`)
    }
  }
}))

const { AgentSessionDeliveryService } = await import('../AgentSessionDeliveryService')

const now = new Date().toISOString()
const accepted = {
  id: 'delivery-1',
  sessionId: 'target',
  role: 'user',
  data: { parts: [{ type: 'text', text: 'work' }] },
  status: 'success',
  delivery: { status: 'accepted', turnRef: null, replyPolicy: 'none' },
  createdAt: now,
  updatedAt: now
} as any
const assistant = {
  id: 'assistant-1',
  sessionId: 'target',
  role: 'assistant',
  data: { parts: [] },
  status: 'pending',
  delivery: null,
  createdAt: now,
  updatedAt: now
} as any

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('AgentSessionDeliveryService', () => {
  beforeEach(() => {
    BaseService.resetInstances()
    vi.clearAllMocks()
    mocks.terminalListeners.clear()
    mocks.idleListeners.clear()
    mocks.listAccepted.mockReturnValue([])
    mocks.listRecoverable.mockReturnValue([])
    mocks.hasLiveStream.mockReturnValue(false)
    mocks.hasTerminalPersistenceInFlight.mockReturnValue(false)
    mocks.runtimeBusy.mockReturnValue(false)
    mocks.closeSession.mockResolvedValue(undefined)
    mocks.getMessage.mockReturnValue(accepted)
    mocks.markTerminalError.mockReset()
    mocks.validateDispatch.mockResolvedValue({
      sessionId: 'target',
      agentId: 'agent-1',
      agentUpdatedAt: now,
      agentType: 'claude-code',
      uniqueModelId: 'provider::model'
    })
    mocks.persistDispatchTx.mockReturnValue({
      assistantMessageId: assistant.id,
      savedMessages: [accepted, assistant]
    })
    mocks.claim.mockReturnValue({ ...accepted, delivery: { ...accepted.delivery, status: 'delivering' } })
    mocks.activateDispatch.mockReturnValue({
      topicId: 'agent-session:target',
      models: [{ modelId: 'provider::model', request: {} }],
      listeners: [],
      isMultiModel: false
    })
    mocks.send.mockReturnValue({ mode: 'started', executionIds: ['provider::model'] })
    mocks.fail.mockReturnValue(null)
    mocks.finalize.mockReturnValue(null)
    mocks.findByTurnRef.mockReturnValue(null)
    mocks.deleteByIds.mockReturnValue({ deletedIds: [], taskScheduleIds: [], deliveryResults: [] })
    mocks.reuseOrCreate.mockReturnValue({
      session: { id: 'target' },
      created: false,
      deletedDuplicateSessionIds: [],
      deliveryResults: []
    })
    mocks.deleteByAgentId.mockReturnValue({ deletedIds: [], taskScheduleIds: [], deliveryResults: [] })
    mocks.deleteAgent.mockReturnValue({
      deleted: true,
      deletedSessionIds: [],
      affectedSessionIds: [],
      deliveryResults: []
    })
    mocks.deleteWorkspace.mockReturnValue({ deletedIds: [], taskScheduleIds: [], deliveryResults: [] })
  })

  afterEach(() => BaseService.resetInstances())

  it('keeps an accepted row durable while the target is busy, then starts it on idle', async () => {
    const service = new AgentSessionDeliveryService()
    await service._doInit()
    mocks.runtimeBusy.mockReturnValue(true)
    mocks.listAccepted.mockImplementation((sessionId?: string) => (sessionId === 'target' ? [accepted] : []))

    service.kick('target')
    await service.drainInFlight({ timeoutMs: 100 })
    expect(mocks.validateDispatch).not.toHaveBeenCalled()
    expect(mocks.send).not.toHaveBeenCalled()

    mocks.runtimeBusy.mockReturnValue(false)
    mocks.listAccepted.mockReturnValueOnce([accepted]).mockReturnValue([])
    for (const listener of mocks.idleListeners) listener({ sessionId: 'target' })
    await flush()
    await service.drainInFlight({ timeoutMs: 100 })

    expect(mocks.persistDispatchTx).toHaveBeenCalled()
    expect(mocks.persistDispatchTx).toHaveBeenCalledWith({}, expect.anything(), {
      id: 'agent-1',
      updatedAt: now,
      model: 'provider::model',
      type: 'claude-code'
    })
    expect(mocks.claim).toHaveBeenCalledWith({}, 'target', 'delivery-1', 'assistant-1')
    expect(mocks.publishDispatchChanges).toHaveBeenCalledWith('target', [accepted, assistant])
    expect(mocks.send).toHaveBeenCalledOnce()
  })

  it('reruns a coalesced kick that arrives before the blocked kick releases single-flight ownership', async () => {
    let firstBusyCheck = true
    mocks.runtimeBusy.mockImplementation(() => {
      if (!firstBusyCheck) return false
      firstBusyCheck = false
      for (const listener of mocks.idleListeners) listener({ sessionId: 'target' })
      return true
    })
    mocks.listAccepted.mockImplementation((sessionId?: string) => (sessionId === 'target' ? [accepted] : []))
    const service = new AgentSessionDeliveryService()
    await service._doInit()

    service.kick('target')
    await service.drainInFlight({ timeoutMs: 100 })

    expect(mocks.send).toHaveBeenCalledOnce()
  })

  it('finalizes a terminal turn by durable turnRef instead of runtime queue state', async () => {
    const delivering = { ...accepted, delivery: { ...accepted.delivery, status: 'delivering', turnRef: assistant.id } }
    const result = { ...accepted, id: 'result-1', sessionId: 'sender' }
    mocks.findByTurnRef.mockReturnValue(delivering)
    mocks.finalize.mockReturnValue(result)
    mocks.runtimeBusy.mockReturnValue(true)
    const service = new AgentSessionDeliveryService()
    await service._doInit()

    for (const listener of mocks.terminalListeners) {
      listener({ sessionId: 'target', assistantMessageId: assistant.id, status: 'success' })
    }
    await service.drainInFlight({ timeoutMs: 100 })

    expect(mocks.finalize).toHaveBeenCalledWith({
      requestSessionId: 'target',
      requestMessageId: 'delivery-1',
      assistantMessageId: 'assistant-1',
      outcome: 'success'
    })
  })

  it('reconciles a persisted terminal delivery when runtime closes before the terminal event', async () => {
    const delivering = { ...accepted, delivery: { ...accepted.delivery, status: 'delivering', turnRef: assistant.id } }
    const completedAssistant = { ...assistant, status: 'success' }
    mocks.getMessage.mockReturnValue(completedAssistant)
    const service = new AgentSessionDeliveryService()
    await service._doInit()
    mocks.listRecoverable.mockImplementation((sessionId?: string) => (sessionId === 'target' ? [delivering] : []))

    for (const listener of mocks.idleListeners) listener({ sessionId: 'target' })
    await service.drainInFlight({ timeoutMs: 100 })

    expect(mocks.finalize).toHaveBeenCalledWith({
      requestSessionId: 'target',
      requestMessageId: 'delivery-1',
      assistantMessageId: 'assistant-1',
      outcome: 'success'
    })
  })

  it('retries idle placeholder repair after a transient DB failure', async () => {
    const delivering = { ...accepted, delivery: { ...accepted.delivery, status: 'delivering', turnRef: assistant.id } }
    const failedAssistant = { ...assistant, status: 'error' }
    mocks.getMessage.mockReturnValueOnce(assistant).mockReturnValueOnce(assistant).mockReturnValueOnce(failedAssistant)
    mocks.markTerminalError.mockImplementationOnce(() => {
      throw new Error('database busy')
    })
    mocks.runtimeBusy.mockReturnValue(false)
    const service = new AgentSessionDeliveryService()
    await service._doInit()
    mocks.listRecoverable.mockImplementation((sessionId?: string) =>
      sessionId === undefined || sessionId === 'target' ? [delivering] : []
    )

    service.kick('target')
    await service.drainInFlight({ timeoutMs: 100 })
    expect(mocks.finalize).not.toHaveBeenCalled()

    service.kick()
    await service.drainInFlight({ timeoutMs: 100 })

    expect(mocks.markTerminalError).toHaveBeenCalledTimes(2)
    expect(mocks.markTerminalError).toHaveBeenLastCalledWith('target', 'assistant-1')
    expect(mocks.finalize).toHaveBeenCalledWith({
      requestSessionId: 'target',
      requestMessageId: 'delivery-1',
      assistantMessageId: 'assistant-1',
      outcome: 'failed'
    })
  })

  it('does not repair a pending placeholder while terminal persistence is in flight', async () => {
    const delivering = { ...accepted, delivery: { ...accepted.delivery, status: 'delivering', turnRef: assistant.id } }
    mocks.listRecoverable.mockImplementation((sessionId?: string) => (sessionId === 'target' ? [delivering] : []))
    mocks.getMessage.mockReturnValue(assistant)
    mocks.runtimeBusy.mockReturnValue(false)
    mocks.hasLiveStream.mockReturnValue(false)
    mocks.hasTerminalPersistenceInFlight.mockReturnValue(true)
    const service = new AgentSessionDeliveryService()
    await service._doInit()

    for (const listener of mocks.idleListeners) listener({ sessionId: 'target' })
    await service.drainInFlight({ timeoutMs: 100 })

    expect(mocks.markTerminalError).not.toHaveBeenCalled()
    expect(mocks.finalize).not.toHaveBeenCalled()

    mocks.hasTerminalPersistenceInFlight.mockReturnValue(false)
    mocks.getMessage.mockReturnValue({ ...assistant, status: 'success' })
    for (const listener of mocks.idleListeners) listener({ sessionId: 'target' })
    await service.drainInFlight({ timeoutMs: 100 })

    expect(mocks.markTerminalError).not.toHaveBeenCalled()
    expect(mocks.finalize).toHaveBeenCalledWith({
      requestSessionId: 'target',
      requestMessageId: 'delivery-1',
      assistantMessageId: 'assistant-1',
      outcome: 'success'
    })
  })

  it('ignores row-roll terminal events', async () => {
    mocks.findByTurnRef.mockReturnValue(accepted)
    const service = new AgentSessionDeliveryService()
    await service._doInit()

    for (const listener of mocks.terminalListeners) {
      listener({ sessionId: 'target', assistantMessageId: 'assistant-1', status: 'success', boundary: 'row-roll' })
    }
    await flush()

    expect(mocks.findByTurnRef).not.toHaveBeenCalled()
    expect(mocks.finalize).not.toHaveBeenCalled()
  })

  it('keeps a delivery owned when send throws after installing a live stream', async () => {
    mocks.listAccepted.mockReturnValueOnce([accepted]).mockReturnValue([])
    mocks.send.mockImplementation(() => {
      mocks.hasLiveStream.mockReturnValue(true)
      throw new Error('post-handoff lifecycle failure')
    })
    const service = new AgentSessionDeliveryService()
    await service._doInit()

    service.kick('target')
    await service.drainInFlight({ timeoutMs: 100 })

    expect(mocks.fail).not.toHaveBeenCalled()
    expect(mocks.finalize).not.toHaveBeenCalled()
    expect(mocks.closeSession).not.toHaveBeenCalled()
  })

  it('fails a recovered delivery whose assistant placeholder was deleted without replaying it', async () => {
    const delivering = { ...accepted, delivery: { ...accepted.delivery, status: 'delivering', turnRef: 'missing' } }
    mocks.listRecoverable.mockReturnValue([delivering])
    mocks.getMessage.mockImplementation(() => {
      throw DataApiErrorFactory.notFound('Message', 'missing')
    })
    const service = new AgentSessionDeliveryService()

    await service._doInit()

    expect(mocks.fail).toHaveBeenCalledWith(delivering, {
      code: 'DELIVERY_TURN_DELETED',
      message: 'The delivery turn was deleted before it could be recovered'
    })
    expect(mocks.validateDispatch).not.toHaveBeenCalled()
    expect(mocks.send).not.toHaveBeenCalled()
  })

  it('suppresses kicks while paused and compensates after the final hold releases', async () => {
    mocks.listAccepted.mockImplementation((sessionId?: string) => (sessionId === 'target' ? [accepted] : []))
    const service = new AgentSessionDeliveryService()
    await service._doInit()
    const hold = service.pause('backup')

    service.kick('target')
    await flush()
    expect(mocks.validateDispatch).not.toHaveBeenCalled()

    mocks.listAccepted.mockReturnValueOnce([accepted]).mockReturnValue([])
    hold.dispose()
    await flush()
    await service.drainInFlight({ timeoutMs: 100 })
    expect(mocks.send).toHaveBeenCalledOnce()
  })

  it('rechecks write admission after asynchronous target validation', async () => {
    let finishValidation!: (value: {
      sessionId: string
      agentId: string
      agentUpdatedAt: string
      agentType: string
      uniqueModelId: string
    }) => void
    mocks.validateDispatch.mockReturnValue(
      new Promise((resolve) => {
        finishValidation = resolve
      })
    )
    mocks.listAccepted.mockImplementation((sessionId?: string) => (sessionId === 'target' ? [accepted] : []))
    const service = new AgentSessionDeliveryService()
    await service._doInit()

    service.kick('target')
    await flush()
    const hold = service.pause('backup')
    finishValidation({
      sessionId: 'target',
      agentId: 'agent-1',
      agentUpdatedAt: now,
      agentType: 'claude-code',
      uniqueModelId: 'provider::model'
    })
    await service.drainInFlight({ timeoutMs: 100 })

    expect(mocks.persistDispatchTx).not.toHaveBeenCalled()
    expect(mocks.claim).not.toHaveBeenCalled()
    expect(mocks.send).not.toHaveBeenCalled()
    mocks.listAccepted.mockReturnValue([])
    hold.dispose()
  })

  it('rechecks target ownership after asynchronous validation', async () => {
    let finishValidation!: (value: {
      sessionId: string
      agentId: string
      agentUpdatedAt: string
      agentType: string
      uniqueModelId: string
    }) => void
    mocks.validateDispatch.mockReturnValue(
      new Promise((resolve) => {
        finishValidation = resolve
      })
    )
    mocks.listAccepted.mockImplementation((sessionId?: string) => (sessionId === 'target' ? [accepted] : []))
    const service = new AgentSessionDeliveryService()
    await service._doInit()

    service.kick('target')
    await flush()
    mocks.runtimeBusy.mockReturnValue(true)
    finishValidation({
      sessionId: 'target',
      agentId: 'agent-1',
      agentUpdatedAt: now,
      agentType: 'claude-code',
      uniqueModelId: 'provider::model'
    })
    await service.drainInFlight({ timeoutMs: 100 })

    expect(mocks.persistDispatchTx).not.toHaveBeenCalled()
    expect(mocks.claim).not.toHaveBeenCalled()
    expect(mocks.send).not.toHaveBeenCalled()
  })

  it('fails permanently when the Session loses its validated Agent before the claim transaction', async () => {
    mocks.listAccepted.mockReturnValueOnce([accepted]).mockReturnValue([])
    mocks.persistDispatchTx.mockImplementation(() => {
      throw DataApiErrorFactory.notFound('Session', 'target')
    })
    const service = new AgentSessionDeliveryService()
    await service._doInit()

    service.kick('target')
    await service.drainInFlight({ timeoutMs: 100 })

    expect(mocks.fail).toHaveBeenCalledWith(accepted, {
      code: 'TARGET_UNAVAILABLE',
      message: "Session with id 'target' not found"
    })
    expect(mocks.send).not.toHaveBeenCalled()
  })

  it('revalidates instead of dispatching an Agent snapshot changed before the claim transaction', async () => {
    const persisted = {
      assistantMessageId: assistant.id,
      savedMessages: [accepted, assistant]
    }
    mocks.listAccepted.mockReturnValueOnce([accepted]).mockReturnValueOnce([accepted]).mockReturnValue([])
    mocks.persistDispatchTx
      .mockImplementationOnce(() => {
        throw DataApiErrorFactory.concurrentModification('Agent', 'agent-1')
      })
      .mockReturnValue(persisted)
    const service = new AgentSessionDeliveryService()
    await service._doInit()

    service.kick('target')
    await service.drainInFlight({ timeoutMs: 100 })

    expect(mocks.validateDispatch).toHaveBeenCalledTimes(2)
    expect(mocks.claim).toHaveBeenCalledOnce()
    expect(mocks.send).toHaveBeenCalledOnce()
  })

  it('bounds repeated concurrent-modification revalidation instead of spinning on one durable row', async () => {
    mocks.listAccepted.mockImplementation((sessionId?: string) => (sessionId === 'target' ? [accepted] : []))
    mocks.persistDispatchTx.mockImplementation(() => {
      throw DataApiErrorFactory.concurrentModification('Agent', 'agent-1')
    })
    const service = new AgentSessionDeliveryService()
    await service._doInit()

    service.kick('target')
    await service.drainInFlight({ timeoutMs: 100 })

    expect(mocks.validateDispatch).toHaveBeenCalledTimes(2)
    expect(mocks.send).not.toHaveBeenCalled()
    expect(service.listActiveWork()).toEqual([])
  })

  it('retries an accepted delivery after its workspace becomes available without another event', async () => {
    vi.useFakeTimers()
    try {
      const workspaceError = Object.assign(new Error('workspace volume is unavailable'), {
        name: 'AgentSessionWorkspaceError',
        retryable: true
      })
      mocks.listAccepted.mockImplementation((sessionId?: string) =>
        sessionId === undefined || sessionId === 'target' ? [accepted] : []
      )
      mocks.listRecoverable.mockImplementation((sessionId?: string) =>
        sessionId === undefined || sessionId === 'target' ? [accepted] : []
      )
      mocks.validateDispatch.mockRejectedValue(workspaceError)
      const service = new AgentSessionDeliveryService()
      await service._doInit()
      await service._doAllReady()
      await service.drainInFlight({ timeoutMs: 100 })

      expect(mocks.fail).not.toHaveBeenCalled()
      expect(mocks.persistDispatchTx).not.toHaveBeenCalled()
      expect(mocks.send).not.toHaveBeenCalled()

      mocks.validateDispatch.mockResolvedValue({
        sessionId: 'target',
        agentId: 'agent-1',
        agentUpdatedAt: now,
        agentType: 'claude-code',
        uniqueModelId: 'provider::model'
      })
      expect(vi.getTimerCount()).toBeGreaterThan(0)
      await vi.advanceTimersByTimeAsync(60_001)
      vi.runAllTicks()
      await service.drainInFlight({ timeoutMs: 100 })

      expect(mocks.send).toHaveBeenCalledOnce()
    } finally {
      vi.useRealTimers()
    }
  })

  it('reinstalls its retry sweep when the service restarts', async () => {
    vi.useFakeTimers()
    try {
      const service = new AgentSessionDeliveryService()
      await service._doInit()
      await service._doAllReady()
      expect(vi.getTimerCount()).toBe(1)

      await service._doStop()
      expect(vi.getTimerCount()).toBe(0)

      await service._doInit()
      expect(vi.getTimerCount()).toBe(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('commits deletion, closes target runtimes, then schedules the exact durable results', async () => {
    const result = { ...accepted, id: 'result-1', sessionId: 'sender' }
    const order: string[] = []
    mocks.deleteByIds.mockImplementation(() => {
      order.push('commit')
      return { deletedIds: ['target'], taskScheduleIds: [], deliveryResults: [result] }
    })
    mocks.closeSession.mockImplementation(async () => {
      order.push('close')
    })
    mocks.listAccepted.mockImplementation((sessionId?: string) => {
      if (sessionId === 'sender') order.push('kick-result')
      return []
    })
    const service = new AgentSessionDeliveryService()
    await service._doInit()

    await expect(service.deleteSessions(['target'])).resolves.toEqual({ deletedIds: ['target'] })
    await flush()

    expect(order).toEqual(['commit', 'close', 'kick-result'])
  })

  it('closes duplicate placeholder runtimes through the delivery owner', async () => {
    mocks.reuseOrCreate.mockReturnValue({
      session: { id: 'retained' },
      created: false,
      deletedDuplicateSessionIds: ['duplicate'],
      deliveryResults: []
    })
    const service = new AgentSessionDeliveryService()
    await service._doInit()

    await expect(
      service.reuseOrCreateSession({ agentId: 'agent-1', workspace: { type: 'system' } })
    ).resolves.toMatchObject({
      session: { id: 'retained' },
      deletedDuplicateSessionIds: ['duplicate']
    })

    expect(mocks.closeSession).toHaveBeenCalledWith('duplicate')
  })

  it('keeps overlapping same-key deletions drain-visible until both settle', async () => {
    let releaseFirstClose!: () => void
    const firstClose = new Promise<void>((resolve) => {
      releaseFirstClose = resolve
    })
    mocks.deleteByIds
      .mockReturnValueOnce({ deletedIds: ['target'], taskScheduleIds: [], deliveryResults: [] })
      .mockReturnValueOnce({ deletedIds: [], taskScheduleIds: [], deliveryResults: [] })
    mocks.closeSession.mockReturnValueOnce(firstClose)
    const service = new AgentSessionDeliveryService()
    await service._doInit()

    const first = service.deleteSessions(['target'])
    await vi.waitFor(() => expect(mocks.closeSession).toHaveBeenCalledWith('target'))
    await service.deleteSessions(['target'])

    let drained = false
    const drain = service.drainInFlight({ timeoutMs: 5_000 }).then((result) => {
      drained = true
      return result
    })
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(drained).toBe(false)

    releaseFirstClose()
    await first
    await expect(drain).resolves.toEqual({ stragglerIds: [] })
  })

  it('closes every affected runtime when deleting an Agent', async () => {
    mocks.deleteAgent.mockReturnValue({
      deleted: true,
      deletedSessionIds: ['target'],
      affectedSessionIds: ['target'],
      deliveryResults: []
    })
    const service = new AgentSessionDeliveryService()
    await service._doInit()

    await service.deleteAgent('agent-1', true)

    expect(mocks.closeSession).toHaveBeenCalledWith('target')
  })

  it('pauses an active retained Session before closing it after Agent deletion', async () => {
    mocks.deleteAgent.mockReturnValue({
      deleted: true,
      affectedSessionIds: ['target'],
      deliveryResults: [{ ...accepted, delivery: { ...accepted.delivery, status: 'failed' } }]
    })
    const service = new AgentSessionDeliveryService()
    await service._doInit()

    await service.deleteAgent('agent-1', false)

    expect(mocks.pauseRuntimeTurn).toHaveBeenCalledWith('agent-session:target', 'target-agent-deleted')
    expect(mocks.pauseRuntimeTurn.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.closeSession.mock.invocationCallOrder[0]
    )
  })

  it('deletes every Session owned by a protected Agent through the delivery owner', async () => {
    mocks.deleteByAgentId.mockReturnValue({
      deletedIds: ['session-1', 'session-not-loaded'],
      taskScheduleIds: [],
      deliveryResults: []
    })
    const service = new AgentSessionDeliveryService()

    await expect(service.deleteAgentSessions('agent-1')).resolves.toEqual({
      deletedIds: ['session-1', 'session-not-loaded']
    })

    expect(mocks.deleteByAgentId).toHaveBeenCalledWith('agent-1')
    expect(mocks.closeSession).toHaveBeenCalledWith('session-1')
    expect(mocks.closeSession).toHaveBeenCalledWith('session-not-loaded')
  })

  it('closes deleted workspace runtimes through the delivery owner', async () => {
    mocks.deleteWorkspace.mockReturnValue({
      deletedIds: ['target'],
      taskScheduleIds: [],
      deliveryResults: []
    })
    const service = new AgentSessionDeliveryService()
    await service._doInit()

    await service.deleteWorkspace('workspace-1')

    expect(mocks.closeSession).toHaveBeenCalledWith('target')
  })
})
