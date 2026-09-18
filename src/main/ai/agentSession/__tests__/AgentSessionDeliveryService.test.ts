import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { agentService } from '@data/services/AgentService'
import type { agentSessionService } from '@data/services/AgentSessionService'
import { KeyedMutex } from '@main/core/concurrency/KeyedMutex'
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
  deleteByIds: vi.fn<typeof agentSessionService.deleteByIdsWithImpact>(),
  listActiveIdsByAgent: vi.fn(),
  restore: vi.fn(),
  isExpiredTrash: vi.fn(),
  listExpiredTrashIds: vi.fn(),
  purgeExpiredByIdsTx: vi.fn(),
  deleteByAgentId: vi.fn(),
  deleteAgent: vi.fn<typeof agentService.deleteAgentStateTx>(),
  deleteWorkspace: vi.fn(),
  validateDispatch: vi.fn(),
  persistDispatchTx: vi.fn(),
  activateDispatch: vi.fn(),
  send: vi.fn(),
  hasLiveStream: vi.fn(),
  pauseRuntimeTurn: vi.fn(),
  abortAndDrain: vi.fn(),
  hasTerminalPersistenceInFlight: vi.fn(),
  whenTerminalDispatchSettled: vi.fn(),
  runtimeBusy: vi.fn(),
  closeSession: vi.fn(),
  getPath: vi.fn(),
  removeAgentStorageSubdirectory: vi.fn(),
  withDispatchLock: vi.fn(),
  hasUnsettledTopicWork: vi.fn(),
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  },
  terminalListeners: new Set<(event: any) => void>(),
  idleListeners: new Set<(event: any) => void>()
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => mocks.logger
  }
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

vi.mock('@main/ai/agents/agentDataDirectory', () => ({
  removeAgentStorageSubdirectory: mocks.removeAgentStorageSubdirectory
}))

vi.mock('@data/services/AgentSessionService', () => ({
  agentSessionService: {
    reuseOrCreatePlaceholderWithImpact: mocks.reuseOrCreate,
    deleteByIdsWithImpact: mocks.deleteByIds,
    listActiveIdsByAgent: mocks.listActiveIdsByAgent,
    listIdsByAgent: mocks.listActiveIdsByAgent,
    listIdsByWorkspace: () => [],
    restore: mocks.restore,
    notifyPurged: vi.fn(),
    isExpiredTrash: mocks.isExpiredTrash,
    listExpiredTrashIds: mocks.listExpiredTrashIds,
    purgeExpiredByIdsTx: mocks.purgeExpiredByIdsTx,
    deleteByAgentIdWithImpact: mocks.deleteByAgentId,
    deleteWorkspaceCascadeWithImpact: mocks.deleteWorkspace
  }
}))

vi.mock('@data/services/AgentService', () => ({
  agentService: { deleteAgentStateTx: mocks.deleteAgent, notifyDeleted: vi.fn(), getLifecycleState: () => 'trashed' }
}))

vi.mock('@main/ai/agents/agentOrphanSweep', () => ({ sweepAgentOrphans: vi.fn() }))
vi.mock('@data/services/AgentTaskService', () => ({
  agentTaskService: { setOwnerStateTx: () => [], notifyReadModelChange: vi.fn() }
}))

vi.mock('../../streamManager/context/AgentChatContextProvider', () => ({
  agentChatContextProvider: {
    validateDispatch: mocks.validateDispatch,
    persistDispatchTx: mocks.persistDispatchTx,
    activateDispatch: mocks.activateDispatch
  }
}))

const runtime = {
  listActiveWork: () => [],
  drainInFlight: async () => ({ stragglerIds: [] }),
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
  withDispatchLock: mocks.withDispatchLock,
  hasUnsettledTopicWork: mocks.hasUnsettledTopicWork,
  hasLiveStream: mocks.hasLiveStream,
  pauseRuntimeTurn: mocks.pauseRuntimeTurn,
  abortAndDrain: mocks.abortAndDrain,
  hasTerminalPersistenceInFlight: mocks.hasTerminalPersistenceInFlight,
  whenTerminalDispatchSettled: mocks.whenTerminalDispatchSettled,
  send: mocks.send
}
const dbService = {
  withWriteTx: (fn: (tx: object) => unknown) => fn({})
}

vi.mock('@application', () => ({
  application: {
    getPath: mocks.getPath,
    get: (name: string) => {
      if (name === 'AgentSessionRuntimeService') return runtime
      if (name === 'AiStreamManager') return manager
      if (name === 'DbService') return dbService
      if (name === 'AgentSessionDeliveryService') return deliveryOwner
      if (name === 'ChannelManager')
        return {
          pause: () => ({ dispose() {} }),
          reconcileAgent() {},
          listActiveWork: () => [],
          drainInFlight: async () => ({ stragglerIds: [] })
        }
      throw new Error(`Unexpected application.get(${name})`)
    }
  }
}))

const { AgentSessionDeliveryService } = await import('../AgentSessionDeliveryService')
const { AgentLifecycleService } = await import('../../agents/AgentLifecycleService')
let deliveryOwner: InstanceType<typeof AgentSessionDeliveryService>

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

const agentDeletionResult: ReturnType<typeof agentService.deleteAgentStateTx> = {
  deleted: true,
  deletedSessionIds: undefined,
  affectedSessionIds: [],
  affectedChannelIds: [],
  taskScheduleIds: [],
  changeKind: 'projection',
  deliveryResults: [],
  purgedSystemWorkspacePaths: []
}

describe('AgentSessionDeliveryService', () => {
  beforeEach(() => {
    BaseService.resetInstances()
    vi.clearAllMocks()
    mocks.terminalListeners.clear()
    mocks.idleListeners.clear()
    mocks.listAccepted.mockReturnValue([])
    mocks.listRecoverable.mockReturnValue([])
    mocks.hasLiveStream.mockReturnValue(false)
    mocks.hasUnsettledTopicWork.mockReturnValue(false)
    mocks.withDispatchLock.mockImplementation((_topicId: string, fn: () => Promise<unknown>) => fn())
    mocks.hasTerminalPersistenceInFlight.mockReturnValue(false)
    mocks.whenTerminalDispatchSettled.mockResolvedValue(undefined)
    mocks.runtimeBusy.mockReturnValue(false)
    mocks.closeSession.mockResolvedValue(undefined)
    mocks.getPath.mockReturnValue('/mock/feature.agents.system_workspaces')
    mocks.removeAgentStorageSubdirectory.mockResolvedValue(undefined)
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
    mocks.deleteByIds.mockReturnValue({
      deletedIds: [],
      taskScheduleIds: [],
      deliveryResults: [],
      purgedSystemWorkspacePaths: []
    })
    mocks.listActiveIdsByAgent.mockReturnValue([])
    mocks.restore.mockReturnValue({ id: 'restored-session' })
    mocks.isExpiredTrash.mockReturnValue(true)
    mocks.listExpiredTrashIds.mockReturnValue([])
    mocks.purgeExpiredByIdsTx.mockReturnValue([])
    mocks.abortAndDrain.mockResolvedValue(undefined)
    mocks.reuseOrCreate.mockReturnValue({
      session: { id: 'target' },
      created: false,
      deletedDuplicateSessionIds: [],
      deliveryResults: []
    })
    mocks.deleteByAgentId.mockReturnValue({ deletedIds: [], taskScheduleIds: [], deliveryResults: [] })
    mocks.deleteAgent.mockReturnValue({
      ...agentDeletionResult,
      deletedSessionIds: []
    })
    mocks.deleteWorkspace.mockReturnValue({ deletedIds: [], taskScheduleIds: [], deliveryResults: [] })
  })

  afterEach(() => BaseService.resetInstances())

  it('waits for the previous terminal dispatch to settle before checking liveness', async () => {
    const service = new AgentSessionDeliveryService()
    await service._doInit()
    let release!: () => void
    mocks.whenTerminalDispatchSettled.mockReturnValue(
      new Promise<void>((resolve) => {
        release = resolve
      })
    )
    mocks.listAccepted.mockReturnValueOnce([accepted]).mockReturnValue([])

    service.kick('target')
    await flush()
    expect(mocks.hasLiveStream).not.toHaveBeenCalled()
    expect(mocks.validateDispatch).not.toHaveBeenCalled()

    release()
    await service.drainInFlight({ timeoutMs: 100 })
    expect(mocks.hasLiveStream).toHaveBeenCalled()
    expect(mocks.send).toHaveBeenCalled()
  })

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

  it('rejects Session archive before the DB write while its turn is unsettled', async () => {
    mocks.hasUnsettledTopicWork.mockReturnValue(true)
    const delivery = new AgentSessionDeliveryService()
    deliveryOwner = delivery
    const service = new AgentLifecycleService()
    await delivery._doInit()

    await expect(service.archiveSessions(['target'])).rejects.toMatchObject({
      name: 'AgentSessionArchiveBusyError',
      sessionIds: ['target']
    })

    expect(mocks.deleteByIds).not.toHaveBeenCalled()
    expect(mocks.closeSession).not.toHaveBeenCalled()
  })

  it('holds Session dispatch admission until archive runtime teardown settles', async () => {
    const dispatchLocks = new KeyedMutex()
    let releaseRuntime!: () => void
    const runtimeClosed = new Promise<void>((resolve) => {
      releaseRuntime = resolve
    })
    mocks.withDispatchLock.mockImplementation((topicId: string, fn: () => Promise<unknown>) =>
      dispatchLocks.runExclusive(topicId, fn)
    )
    mocks.deleteByIds.mockReturnValue({
      deletedIds: ['target'],
      taskScheduleIds: [],
      deliveryResults: [],
      purgedSystemWorkspacePaths: []
    })
    mocks.closeSession.mockReturnValue(runtimeClosed)
    const delivery = new AgentSessionDeliveryService()
    deliveryOwner = delivery
    const service = new AgentLifecycleService()
    await delivery._doInit()

    const deleting = service.archiveSessions(['target'])
    await vi.waitFor(() => expect(mocks.closeSession).toHaveBeenCalledWith('target'))

    let competingAdmissionEntered = false
    const competingAdmission = dispatchLocks.runExclusive('agent-session:target', async () => {
      competingAdmissionEntered = true
    })
    await flush()
    expect(competingAdmissionEntered).toBe(false)

    releaseRuntime()

    await expect(deleting).resolves.toEqual({ deletedIds: ['target'] })
    await competingAdmission
    expect(competingAdmissionEntered).toBe(true)
  })

  it('removes purged system workspaces after closing their runtimes', async () => {
    const order: string[] = []
    const workspacePath = '/mock/feature.agents.system_workspaces/2026-09-16/target'
    mocks.deleteByIds.mockReturnValue({
      deletedIds: ['target'],
      taskScheduleIds: [],
      deliveryResults: [],
      purgedSystemWorkspacePaths: [workspacePath]
    })
    mocks.closeSession.mockImplementation(async () => {
      order.push('runtime-closed')
    })
    mocks.removeAgentStorageSubdirectory.mockImplementation(async () => {
      order.push('workspace-removed')
    })
    const delivery = new AgentSessionDeliveryService()
    deliveryOwner = delivery
    const service = new AgentLifecycleService()
    await delivery._doInit()

    await expect(service.purgeSessions(['target'])).resolves.toEqual({ deletedIds: ['target'] })

    expect(mocks.removeAgentStorageSubdirectory).toHaveBeenCalledWith(
      '/mock/feature.agents.system_workspaces',
      workspacePath
    )
    expect(order).toEqual(['runtime-closed', 'workspace-removed'])
  })

  it('keeps a committed permanent deletion successful when workspace cleanup fails', async () => {
    const workspacePath = '/mock/feature.agents.system_workspaces/2026-09-16/target'
    const cleanupError = new Error('workspace busy')
    mocks.deleteByIds.mockReturnValue({
      deletedIds: ['target'],
      taskScheduleIds: [],
      deliveryResults: [],
      purgedSystemWorkspacePaths: [workspacePath]
    })
    mocks.removeAgentStorageSubdirectory.mockRejectedValue(cleanupError)
    const delivery = new AgentSessionDeliveryService()
    deliveryOwner = delivery
    const service = new AgentLifecycleService()
    await delivery._doInit()

    await expect(service.purgeSessions(['target'])).resolves.toEqual({ deletedIds: ['target'] })

    expect(mocks.logger.warn).toHaveBeenCalledWith('Failed to remove purged Agent Session workspace', {
      workspacePath,
      error: cleanupError
    })
  })

  it.each([true, false])(
    'rejects Agent archive when a Session is unsettled (archiveSessions=%s)',
    async (archiveSessions) => {
      mocks.listActiveIdsByAgent.mockReturnValue(['target'])
      mocks.hasUnsettledTopicWork.mockReturnValue(true)
      const delivery = new AgentSessionDeliveryService()
      deliveryOwner = delivery
      const service = new AgentLifecycleService()
      await delivery._doInit()

      await expect(service.archiveAgent('agent-1', { archiveSessions })).rejects.toMatchObject({
        name: 'AgentSessionArchiveBusyError',
        sessionIds: ['target']
      })

      expect(mocks.deleteAgent).not.toHaveBeenCalled()
    }
  )

  it("rejects clearing an Agent's Sessions when one is unsettled", async () => {
    mocks.listActiveIdsByAgent.mockReturnValue(['target'])
    mocks.hasUnsettledTopicWork.mockReturnValue(true)
    const delivery = new AgentSessionDeliveryService()
    deliveryOwner = delivery
    const service = new AgentLifecycleService()
    await delivery._doInit()

    await expect(service.archiveAgentSessions('agent-1')).rejects.toMatchObject({
      name: 'AgentSessionArchiveBusyError',
      sessionIds: ['target']
    })

    expect(mocks.deleteByAgentId).not.toHaveBeenCalled()
  })

  it('drains expired Session runtimes before hard-deleting their rows', async () => {
    let releaseRuntime!: () => void
    const runtimeDrained = new Promise<void>((resolve) => {
      releaseRuntime = resolve
    })
    mocks.listExpiredTrashIds.mockReturnValue(['expired-session'])
    mocks.abortAndDrain.mockReturnValue(runtimeDrained)
    mocks.purgeExpiredByIdsTx.mockReturnValue(['expired-session'])
    const delivery = new AgentSessionDeliveryService()
    deliveryOwner = delivery
    const service = new AgentLifecycleService()

    const purge = service.purgeExpiredSessions(500, 10)
    await vi.waitFor(() =>
      expect(mocks.abortAndDrain).toHaveBeenCalledWith('agent-session:expired-session', 'agent-session-retention-purge')
    )
    expect(mocks.purgeExpiredByIdsTx).not.toHaveBeenCalled()

    releaseRuntime()

    await expect(purge).resolves.toEqual({ purgedIds: ['expired-session'], hasMore: false })
    expect(mocks.purgeExpiredByIdsTx).toHaveBeenCalledWith({}, ['expired-session'], 500)
    expect(delivery.isWriteQuiesced).toBe(false)
  })

  it('does not drain a Session restored before its retention purge acquires ownership', async () => {
    let markRestored!: () => void
    let restored = false
    const restoreGate = new Promise<{ id: string }>((resolve) => {
      markRestored = () => {
        restored = true
        resolve({ id: 'expired-session' })
      }
    })
    mocks.restore.mockReturnValue(restoreGate)
    mocks.isExpiredTrash.mockImplementation(() => !restored)
    mocks.listExpiredTrashIds.mockReturnValue(['expired-session'])
    const delivery = new AgentSessionDeliveryService()
    deliveryOwner = delivery
    const service = new AgentLifecycleService()

    const restore = service.restoreSession('expired-session')
    await vi.waitFor(() => expect(mocks.restore).toHaveBeenCalledWith('expired-session'))
    const purge = service.purgeExpiredSessions(500, 10)

    await flush()
    expect(mocks.abortAndDrain).not.toHaveBeenCalled()
    markRestored()

    await expect(restore).resolves.toEqual({ id: 'expired-session' })
    await expect(purge).resolves.toEqual({ purgedIds: [], hasMore: false })
    expect(mocks.isExpiredTrash).toHaveBeenCalledWith('expired-session', 500)
    expect(mocks.abortAndDrain).not.toHaveBeenCalled()
  })

  it('keeps restoration behind an in-progress retention purge', async () => {
    let releaseRuntime!: () => void
    const runtimeDrained = new Promise<void>((resolve) => {
      releaseRuntime = resolve
    })
    const order: string[] = []
    mocks.listExpiredTrashIds.mockReturnValue(['expired-session'])
    mocks.abortAndDrain.mockImplementation(async () => {
      order.push('drain')
      await runtimeDrained
    })
    mocks.purgeExpiredByIdsTx.mockImplementation(() => {
      order.push('purge')
      return ['expired-session']
    })
    mocks.restore.mockImplementation(() => {
      order.push('restore')
      throw DataApiErrorFactory.notFound('Session', 'expired-session')
    })
    const delivery = new AgentSessionDeliveryService()
    deliveryOwner = delivery
    const service = new AgentLifecycleService()

    const purge = service.purgeExpiredSessions(500, 10)
    await vi.waitFor(() => expect(mocks.abortAndDrain).toHaveBeenCalledOnce())
    const restore = service.restoreSession('expired-session')
    await flush()
    expect(mocks.restore).not.toHaveBeenCalled()

    releaseRuntime()

    await expect(purge).resolves.toEqual({ purgedIds: ['expired-session'], hasMore: false })
    await expect(restore).rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect(order).toEqual(['drain', 'purge', 'restore'])
  })

  it('waits for in-flight Session delivery admission before hard deletion', async () => {
    let releaseValidation!: () => void
    const validation = new Promise<Awaited<ReturnType<typeof mocks.validateDispatch>>>((resolve) => {
      releaseValidation = () =>
        resolve({
          sessionId: 'expired-session',
          agentId: 'agent-1',
          agentUpdatedAt: now,
          agentType: 'claude-code',
          uniqueModelId: 'provider::model'
        })
    })
    const request = { ...accepted, sessionId: 'expired-session' }
    mocks.listAccepted.mockImplementation((sessionId?: string) => (sessionId === 'expired-session' ? [request] : []))
    mocks.validateDispatch.mockReturnValue(validation)
    mocks.listExpiredTrashIds.mockReturnValue(['expired-session'])
    mocks.purgeExpiredByIdsTx.mockReturnValue(['expired-session'])
    const delivery = new AgentSessionDeliveryService()
    deliveryOwner = delivery
    const service = new AgentLifecycleService()
    await delivery._doInit()
    delivery.kick('expired-session')
    await vi.waitFor(() => expect(mocks.validateDispatch).toHaveBeenCalled())

    const purge = service.purgeExpiredSessions(500, 10)
    await vi.waitFor(() => expect(mocks.abortAndDrain).toHaveBeenCalled())
    expect(mocks.purgeExpiredByIdsTx).not.toHaveBeenCalled()

    releaseValidation()

    await expect(purge).resolves.toEqual({ purgedIds: ['expired-session'], hasMore: false })
    expect(mocks.purgeExpiredByIdsTx).toHaveBeenCalledOnce()
  })

  it('keeps purge paused until every runtime drain settles and commits no partial batch', async () => {
    let releaseSlowDrain!: () => void
    const slowDrain = new Promise<void>((resolve) => {
      releaseSlowDrain = resolve
    })
    mocks.listExpiredTrashIds.mockReturnValue(['failed-session', 'slow-session'])
    mocks.abortAndDrain.mockImplementation((topicId: string) => {
      if (topicId === 'agent-session:failed-session') return Promise.reject(new Error('drain failed'))
      return slowDrain
    })
    const delivery = new AgentSessionDeliveryService()
    deliveryOwner = delivery
    const service = new AgentLifecycleService()

    let settled = false
    const purge = service.purgeExpiredSessions(500, 10)
    void purge.then(
      () => {
        settled = true
      },
      () => {
        settled = true
      }
    )
    await vi.waitFor(() => expect(mocks.abortAndDrain).toHaveBeenCalledTimes(2))
    await flush()

    expect(settled).toBe(false)
    expect(delivery.isWriteQuiesced).toBe(true)
    expect(mocks.purgeExpiredByIdsTx).not.toHaveBeenCalled()

    releaseSlowDrain()

    await expect(purge).rejects.toThrow('drain failed')
    expect(delivery.isWriteQuiesced).toBe(false)
    expect(mocks.purgeExpiredByIdsTx).not.toHaveBeenCalled()
  })

  it('uses the selected candidate count to report another purge page after a restored row is skipped', async () => {
    mocks.listExpiredTrashIds.mockReturnValue(['restored-session', 'expired-session'])
    mocks.isExpiredTrash.mockImplementation((sessionId: string) => sessionId === 'expired-session')
    mocks.purgeExpiredByIdsTx.mockReturnValue(['expired-session'])
    const delivery = new AgentSessionDeliveryService()
    deliveryOwner = delivery
    const service = new AgentLifecycleService()

    await expect(service.purgeExpiredSessions(500, 2)).resolves.toEqual({
      purgedIds: ['expired-session'],
      hasMore: true
    })
    expect(mocks.abortAndDrain).toHaveBeenCalledOnce()
    expect(mocks.purgeExpiredByIdsTx).toHaveBeenCalledWith({}, ['expired-session'], 500)
  })

  it('closes duplicate placeholder runtimes through the delivery owner', async () => {
    mocks.reuseOrCreate.mockReturnValue({
      session: { id: 'retained' },
      created: false,
      deletedDuplicateSessionIds: ['duplicate'],
      deliveryResults: []
    })
    const delivery = new AgentSessionDeliveryService()
    deliveryOwner = delivery
    const service = new AgentLifecycleService()
    await delivery._doInit()

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
      .mockReturnValueOnce({
        deletedIds: ['target'],
        taskScheduleIds: [],
        deliveryResults: [],
        purgedSystemWorkspacePaths: []
      })
      .mockReturnValueOnce({ deletedIds: [], taskScheduleIds: [], deliveryResults: [], purgedSystemWorkspacePaths: [] })
    mocks.closeSession.mockReturnValueOnce(firstClose)
    const delivery = new AgentSessionDeliveryService()
    deliveryOwner = delivery
    const service = new AgentLifecycleService()
    await delivery._doInit()

    const first = service.archiveSessions(['target'])
    await vi.waitFor(() => expect(mocks.closeSession).toHaveBeenCalledWith('target'))
    const second = service.archiveSessions(['target'])

    let drained = false
    const drain = service.drainInFlight({ timeoutMs: 5_000 }).then((result) => {
      drained = true
      return result
    })
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(drained).toBe(false)

    releaseFirstClose()
    await Promise.all([first, second])
    await expect(drain).resolves.toEqual({ stragglerIds: [] })
  })

  it('pauses every affected runtime before closing it when deleting an Agent with Sessions', async () => {
    mocks.deleteAgent.mockReturnValue({
      ...agentDeletionResult,
      deletedSessionIds: ['target'],
      affectedSessionIds: ['target'],
      deliveryResults: []
    })
    const delivery = new AgentSessionDeliveryService()
    deliveryOwner = delivery
    const service = new AgentLifecycleService()
    await delivery._doInit()

    await service.archiveAgent('agent-1', { archiveSessions: true })

    expect(mocks.pauseRuntimeTurn).toHaveBeenCalledWith('agent-session:target', 'target-agent-deleted')
    expect(mocks.closeSession).toHaveBeenCalledWith('target')
    expect(mocks.pauseRuntimeTurn.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.closeSession.mock.invocationCallOrder[0]
    )
  })

  it('pauses an active retained Session before closing it after Agent deletion', async () => {
    mocks.deleteAgent.mockReturnValue({
      ...agentDeletionResult,
      affectedSessionIds: ['target'],
      deliveryResults: [{ ...accepted, delivery: { ...accepted.delivery, status: 'failed' } }]
    })
    const delivery = new AgentSessionDeliveryService()
    deliveryOwner = delivery
    const service = new AgentLifecycleService()
    await delivery._doInit()

    await service.archiveAgent('agent-1', { archiveSessions: false })

    expect(mocks.pauseRuntimeTurn).toHaveBeenCalledWith('agent-session:target', 'target-agent-deleted')
    expect(mocks.pauseRuntimeTurn.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.closeSession.mock.invocationCallOrder[0]
    )
  })

  it('resolves committed Agent deletion and retries deliveries when runtime close fails', async () => {
    const closeError = new Error('close failed')
    mocks.deleteAgent.mockReturnValue({
      ...agentDeletionResult,
      affectedSessionIds: ['target'],
      deliveryResults: [{ ...accepted, sessionId: 'sender', delivery: { ...accepted.delivery, status: 'failed' } }]
    })
    mocks.closeSession.mockRejectedValue(closeError)
    const delivery = new AgentSessionDeliveryService()
    deliveryOwner = delivery
    const service = new AgentLifecycleService()

    await expect(service.archiveAgent('agent-1', { archiveSessions: false })).resolves.toEqual({ deleted: true })
    await service.drainInFlight({ timeoutMs: 100 })

    expect(mocks.listAccepted).toHaveBeenCalledWith('sender')
    expect(mocks.listAccepted).toHaveBeenCalledWith('target')
    expect(mocks.logger.error).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ sessionId: 'target', error: closeError })
    )
  })

  it('retries affected retained Sessions after permanent Agent deletion', async () => {
    mocks.deleteAgent.mockReturnValue({
      ...agentDeletionResult,
      affectedSessionIds: ['target'],
      deliveryResults: []
    })
    const delivery = new AgentSessionDeliveryService()
    deliveryOwner = delivery
    const service = new AgentLifecycleService()

    await service.purgeAgent('agent-1')
    await service.drainInFlight({ timeoutMs: 100 })

    expect(mocks.listAccepted).toHaveBeenCalledWith('target')
  })

  it('deletes every Session owned by a protected Agent through the delivery owner', async () => {
    mocks.deleteByAgentId.mockReturnValue({
      deletedIds: ['session-1', 'session-not-loaded'],
      taskScheduleIds: [],
      deliveryResults: []
    })
    const delivery = new AgentSessionDeliveryService()
    deliveryOwner = delivery
    const service = new AgentLifecycleService()

    await expect(service.archiveAgentSessions('agent-1')).resolves.toEqual({
      deletedIds: ['session-1', 'session-not-loaded']
    })

    expect(mocks.deleteByAgentId).toHaveBeenCalledWith('agent-1', { permanent: false })
    expect(mocks.closeSession).toHaveBeenCalledWith('session-1')
    expect(mocks.closeSession).toHaveBeenCalledWith('session-not-loaded')
  })

  it('closes deleted workspace runtimes through the delivery owner', async () => {
    mocks.deleteWorkspace.mockReturnValue({
      deletedIds: ['target'],
      taskScheduleIds: [],
      deliveryResults: []
    })
    const delivery = new AgentSessionDeliveryService()
    deliveryOwner = delivery
    const service = new AgentLifecycleService()
    await delivery._doInit()

    await service.deleteWorkspace('workspace-1')

    expect(mocks.closeSession).toHaveBeenCalledWith('target')
  })

  it('keeps lifecycle admission paused until every ingress hold is released', async () => {
    const service = new AgentLifecycleService()
    mocks.restore.mockReturnValue({ id: 'target' })
    const backup = service.pauseIngress('backup')
    const other = service.pauseIngress('other')
    await expect(service.restoreSession('target')).rejects.toThrow('paused')
    backup.dispose()
    backup.dispose()
    await expect(service.restoreSession('target')).rejects.toThrow('paused')
    other.dispose()
    await expect(service.restoreSession('target')).resolves.toEqual({ id: 'target' })
  })

  it('drains accepted lifecycle work during backup and shutdown without admitting new commands', async () => {
    let releaseClose!: () => void
    const closing = new Promise<void>((resolve) => {
      releaseClose = resolve
    })
    mocks.closeSession.mockReturnValue(closing)
    mocks.deleteByIds.mockReturnValue({
      deletedIds: ['target'],
      taskScheduleIds: [],
      deliveryResults: [],
      purgedSystemWorkspacePaths: []
    })
    deliveryOwner = new AgentSessionDeliveryService()
    const service = new AgentLifecycleService()
    const archive = service.archiveSessions(['target'])
    await vi.waitFor(() => expect(mocks.closeSession).toHaveBeenCalledWith('target'))
    const hold = service.pauseIngress('backup')
    const verdict = await service.drainIngress({ timeoutMs: 5 })
    expect(verdict.stragglerIds).toEqual(['archive-sessions:target'])
    let stopped = false
    const stop = service._doStop().then(() => {
      stopped = true
    })
    hold.dispose()
    await expect(service.restoreSession('target')).rejects.toThrow('paused')
    expect(stopped).toBe(false)
    releaseClose()
    await Promise.all([archive, stop])
    expect((await service.drainIngress({ timeoutMs: 100 })).stragglerIds).toEqual([])
  })
})
