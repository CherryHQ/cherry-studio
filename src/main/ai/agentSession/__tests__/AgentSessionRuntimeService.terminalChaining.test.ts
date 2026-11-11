import type * as FsPromises from 'node:fs/promises'

import { mockMainLoggerService } from '@test-mocks/MainLoggerService'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type * as ForkDataModule from '@data/services/AgentSessionForkService'
import type { AgentSessionForkResources } from '@main/ai/agentSession/fork/resources'
import type * as ForkResourcesModule from '@main/ai/agentSession/fork/resources'
import { BaseService } from '@main/core/lifecycle/BaseService'

vi.mock('@main/ai/agentSession/recoverSessionDeliveries', () => ({ recoverSessionDeliveries: vi.fn(() => new Set()) }))

const mocks = vi.hoisted(() => ({
  saveMessage: vi.fn(),
  replaceMessageParts: vi.fn(),
  getSessionMessage: vi.fn(),
  hasSessionMessage: vi.fn(() => true),
  applyToolApprovalDecision: vi.fn(),
  retireAbandonedApproval: vi.fn(),
  getLastRuntimeResumeToken: vi.fn(),
  relocateSystemWorkspaces: vi.fn<() => Promise<Set<string>>>(),
  sharesBranch: vi.fn(),
  findCrashOrphanedAssistantMessages: vi.fn(),
  resolveCrashOrphanedMessages: vi.fn(),
  updateSessionDeliveryStatus: vi.fn(),
  transitionSessionDelivery: vi.fn(),
  finalizeSessionDelivery: vi.fn(),
  failSessionDelivery: vi.fn(),
  maybeRenameAgentSession: vi.fn(),
  applicationGet: vi.fn(),
  startRuntimeTurn: vi.fn(),
  getInteractionWindow: vi.fn(),
  getWindow: vi.fn(),
  abortStream: vi.fn(),
  suspendUnadmittedRuntimeTurn: vi.fn().mockResolvedValue(undefined),
  pauseRuntimeTurn: vi.fn(),
  broadcastTopicError: vi.fn(),
  resolveToolApproval: vi.fn(),
  terminateHeldTopicStream: vi.fn(),
  cacheSetShared: vi.fn(),
  cacheGetShared: vi.fn(),
  cacheDeleteShared: vi.fn(),
  closeWarmQueries: vi.fn(),
  closeAgentSessionWarm: vi.fn(),
  closeWarmSession: vi.fn().mockResolvedValue(undefined),
  getSessionById: vi.fn(),
  getAgent: vi.fn(),
  ensureTraceId: vi.fn(),
  recordUsage: vi.fn(),
  trackTokenUsage: vi.fn()
}))

const forkRecoveryMocks = vi.hoisted(() => ({
  getPath: vi.fn<(key: string) => string>(),
  journals: vi.fn<() => AgentSessionForkResources[]>(() => []),
  hasPublishedSession: vi.fn(() => false),
  writeJournal: vi.fn<(journal: AgentSessionForkResources) => void>(),
  removeJournal: vi.fn<(operationId: string) => void>(),
  read: vi.fn()
}))

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof FsPromises>()
  return { ...actual, rm: vi.fn(actual.rm) }
})

vi.mock('@data/services/AgentSessionForkService', async (importOriginal) => ({
  ...(await importOriginal<typeof ForkDataModule>()),
  agentSessionForkService: {
    hasPublishedSession: forkRecoveryMocks.hasPublishedSession,
    read: forkRecoveryMocks.read
  }
}))

vi.mock('@main/ai/agentSession/fork/resources', async (importOriginal) => ({
  ...(await importOriginal<typeof ForkResourcesModule>()),
  readForkResources: forkRecoveryMocks.journals,
  writeForkResources: forkRecoveryMocks.writeJournal,
  removeForkResources: forkRecoveryMocks.removeJournal
}))

vi.mock('@main/ai/agentSession/relocateSystemWorkspaces', () => ({
  relocateSystemWorkspaces: mocks.relocateSystemWorkspaces
}))

vi.mock('@data/services/AgentSessionService', () => ({
  agentSessionService: {
    getById: mocks.getSessionById,
    ensureTraceId: mocks.ensureTraceId
  }
}))

vi.mock('@data/services/AgentService', () => ({
  agentService: { getAgent: mocks.getAgent, onAgentUpdated: () => () => {} }
}))

vi.mock('@data/services/AgentSessionMessageService', () => ({
  agentSessionMessageService: {
    saveMessage: mocks.saveMessage,
    replaceMessageParts: mocks.replaceMessageParts,
    markAssistantMessageTerminalError: vi.fn(),
    getSessionMessage: mocks.getSessionMessage,
    hasSessionMessage: mocks.hasSessionMessage,
    applyToolApprovalDecision: mocks.applyToolApprovalDecision,
    retireAbandonedApproval: mocks.retireAbandonedApproval,
    getLastRuntimeResumeToken: mocks.getLastRuntimeResumeToken,
    getNativeSessionId: vi.fn(),
    captureHead: () => 'branch-head',
    branchTip: (_sessionId: string, messageId: string) => messageId,
    sharesBranch: mocks.sharesBranch,
    findCrashOrphanedAssistantMessages: mocks.findCrashOrphanedAssistantMessages,
    resolveCrashOrphanedMessages: mocks.resolveCrashOrphanedMessages,
    updateSessionDeliveryStatus: mocks.updateSessionDeliveryStatus,
    transitionSessionDelivery: mocks.transitionSessionDelivery,
    finalizeSessionDelivery: mocks.finalizeSessionDelivery,
    failSessionDelivery: mocks.failSessionDelivery
  }
}))

vi.mock('@data/services/AiUsageRecordService', () => ({
  aiUsageRecordService: { recordInvocation: mocks.recordUsage }
}))

vi.mock('@main/ai/utils/usageCapture', () => ({
  createAiUsageCaptureContext: (input: unknown) => input
}))

vi.mock('@main/services/TopicNamingService', () => ({
  topicNamingService: { maybeRenameAgentSession: mocks.maybeRenameAgentSession }
}))

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  const result = mockApplicationFactory()
  const get = result.application.getContainer().get.bind(result.application.getContainer())
  result.application.get.mockImplementation((name: string) =>
    name === 'DbService' || name === 'RuntimeActivityService' ? get(name) : mocks.applicationGet(name)
  )
  result.application.getPath.mockImplementation(forkRecoveryMocks.getPath)
  return result
})

const { AgentSessionRuntimeService } = await import('@main/ai/agentSession/AgentSessionRuntimeService')
const { runtimeDriverRegistry } = await import('@main/ai/runtime/registry')
const { toolApprovalRegistry } = await import('@main/ai/toolApproval/ToolApprovalRegistry')
const baseTurnInput = {
  sessionId: 'session-1',
  topicId: 'agent-session:session-1',
  agentId: 'agent-1',
  agentType: 'test-runtime',
  modelId: 'claude-code::claude-sonnet-4-5' as any,
  assistantMessageId: 'assistant-1',
  // Container-level session trace id (cached on the entry, drives the connection traceparent).
  traceId: 'a'.repeat(32)
}

function terminalListener(handle: { listeners: any[] }) {
  const listener = handle.listeners.find((item) => item.id === 'agent-runtime:session-1')
  if (!listener) throw new Error('terminal listener missing')
  return listener
}

function persistenceListener(handle: { listeners: any[] }) {
  const listener = handle.listeners.find((item) => String(item.id).startsWith('persistence:agents-db:'))
  if (!listener) throw new Error('persistence listener missing')
  return listener
}

function getEntry(service: InstanceType<typeof AgentSessionRuntimeService>) {
  const entry = (service as any).entries.get('session-1')
  if (!entry || Object.hasOwn(entry, 'currentTurn')) return entry

  // Keep common turn/queue/connection projections readable while routing white-box access through
  // the converged runtime state. Production entries expose only `runtimeState`.
  Object.defineProperties(entry, {
    currentTurn: {
      configurable: true,
      get: () => {
        const execution = entry.runtimeState.execution
        if (execution.kind === 'turn') return execution.reply.turn
        if (execution.kind === 'steer-transition') return execution.reply.turn
        if (execution.kind === 'autonomous-turn') return execution.reply.turn
        return execution.lastTurn
      },
      set: (turn) => {
        entry.runtimeState.execution = turn
          ? { kind: 'turn', reply: { turn, delivery: { kind: 'attaching' }, admission: 'pending', buffer: [] } }
          : { kind: 'idle' }
      }
    },
    pendingTurns: {
      configurable: true,
      get: () => entry.runtimeState.queue,
      set: (queue) => {
        entry.runtimeState.queue = queue
      }
    },
    connection: {
      configurable: true,
      get: () => {
        const connection = entry.runtimeState.connection
        return connection.kind === 'connected' ? connection.connection : undefined
      },
      set: (connection) => {
        entry.contextUsageModel = entry.modelId
        entry.runtimeState.connection = connection
          ? { kind: 'connected', connection, occupancy: {} }
          : { kind: 'disconnected' }
      }
    }
  })
  return entry
}

describe('agent session terminal chaining', () => {
  beforeEach(() => {
    BaseService.resetInstances()
    runtimeDriverRegistry.clearForTest()
    toolApprovalRegistry.clear('test-reset')
    vi.clearAllMocks()
    mockMainLoggerService.info.mockClear()
    mocks.sharesBranch.mockReturnValue(true)
    mocks.saveMessage.mockImplementation(({ message }) => ({
      ...message,
      id: message.id ?? 'generated-message-id',
      updatedAt: '2026-01-01T00:00:00.000Z'
    }))
    mocks.getSessionById.mockReturnValue({ updatedAt: '2026-01-01T00:00:01.000Z' })
    mocks.getSessionMessage.mockReturnValue({
      id: 'assistant-1',
      role: 'assistant',
      data: {
        parts: [
          {
            type: 'tool-Agent',
            toolCallId: 'task-root',
            state: 'input-available',
            input: { prompt: 'Audit the codebase' }
          }
        ]
      }
    })
    mocks.applyToolApprovalDecision.mockReturnValue(true)
    mocks.getLastRuntimeResumeToken.mockReturnValue(null)
    mocks.relocateSystemWorkspaces.mockReset().mockResolvedValue(new Set())
    mocks.findCrashOrphanedAssistantMessages.mockReturnValue([])
    mocks.resolveCrashOrphanedMessages.mockReturnValue(undefined)
    mocks.ensureTraceId.mockReturnValue('b'.repeat(32))
    mocks.recordUsage.mockReturnValue(undefined)
    mocks.closeWarmQueries.mockResolvedValue(undefined)
    // A live agent with a model — the drain re-reads this to bail on a deleted model. Tests exercising
    // the deleted-model path override it with `{ model: null }`.
    mocks.getAgent.mockReturnValue({ id: 'agent-1', type: 'test-runtime', model: baseTurnInput.modelId })
    mocks.applicationGet.mockImplementation((name: string) => {
      if (name === 'AiStreamManager') {
        return {
          startRuntimeTurn: mocks.startRuntimeTurn,
          getInteractionWindow: mocks.getInteractionWindow,
          abort: mocks.abortStream,
          drainRuntimeReply: async () => {},
          suspendUnadmittedRuntimeTurn: mocks.suspendUnadmittedRuntimeTurn,
          pauseRuntimeTurn: mocks.pauseRuntimeTurn,
          broadcastTopicError: mocks.broadcastTopicError,
          resolveToolApproval: mocks.resolveToolApproval,
          terminateHeldTopicStream: mocks.terminateHeldTopicStream
        }
      }
      if (name === 'CacheService')
        return {
          setShared: mocks.cacheSetShared,
          getShared: mocks.cacheGetShared,
          deleteShared: mocks.cacheDeleteShared
        }
      if (name === 'ClaudeCodeBinaryService') return { getStatus: () => ({ phase: 'ready' }) }
      if (name === 'ClaudeCodeWarmQueryManager')
        return {
          closeAll: mocks.closeWarmQueries,
          closeAgentSessionWarm: mocks.closeAgentSessionWarm,
          close: mocks.closeWarmSession
        }
      if (name === 'AnalyticsService') return { trackTokenUsage: mocks.trackTokenUsage }
      if (name === 'WindowManager') return { getWindow: mocks.getWindow }
      throw new Error(`Unexpected application.get(${name})`)
    })
  })

  it('ignores a stale turn identity without changing the live reply', () => {
    const service = new AgentSessionRuntimeService()
    service.beginTurn(baseTurnInput)
    const entry = getEntry(service)
    const turn = entry.currentTurn
    ;(service as any).applyRuntimeStateEvent(entry, { type: 'turn-stream-opened', turn })
    ;(service as any).applyRuntimeStateEvent(entry, { type: 'turn-admitted', turn })
    const listener = vi.fn()
    service.onTurnTerminal(listener)
    const before = JSON.stringify(entry.runtimeState.execution)
    const busy = service.isSessionBusy('session-1')

    service.markTurnTerminal('session-1', 'success', 'missing-turn')

    expect(mockMainLoggerService.info).toHaveBeenCalledWith(
      'Ignored agent session terminal callback',
      expect.objectContaining({
        reason: 'turn-not-found',
        sessionId: 'session-1',
        expectedTurnId: 'missing-turn',
        replies: expect.arrayContaining([
          expect.objectContaining({
            turnId: turn.turnId,
            assistantMessageId: turn.assistantMessageId,
            deliveryKind: 'open',
            admission: 'admitted',
            pendingResultCount: 0
          })
        ])
      })
    )
    expect(JSON.stringify(entry.runtimeState.execution)).toBe(before)
    expect(listener).not.toHaveBeenCalled()
    expect(service.isSessionBusy('session-1')).toBe(busy)
    ;(service as any).clearIdleTimer(entry)
  })

  it('ignores a duplicate terminal callback for a settled deferred reply', async () => {
    const service = new AgentSessionRuntimeService()
    const handle = service.beginTurn(baseTurnInput)
    const entry = getEntry(service)
    const turn = entry.currentTurn
    const listener = vi.fn()
    service.onTurnTerminal(listener)
    ;(service as any).applyRuntimeStateEvent(entry, { type: 'turn-stream-opened', turn })
    ;(service as any).applyRuntimeStateEvent(entry, { type: 'turn-admitted', turn })
    ;(service as any).handleRuntimeEvent(entry, { type: 'turn-complete' })
    ;(service as any).handleRuntimeEvent(entry, {
      type: 'autonomous-turn-state',
      state: 'started',
      origin: { kind: 'background-work' }
    })
    const result = {
      status: 'success' as const,
      isTopicDone: true,
      modelId: turn.modelId,
      finalMessage: { id: turn.assistantMessageId, role: 'assistant' as const, parts: [] }
    }
    await persistenceListener(handle).onDone(result)
    terminalListener(handle).onDone(result)
    await vi.waitFor(() => expect(mocks.startRuntimeTurn).toHaveBeenCalledTimes(1))
    expect(listener).toHaveBeenCalledOnce()
    expect(entry.runtimeState.execution.deferred.delivery.kind).toBe('settled')
    const before = JSON.stringify(entry.runtimeState.execution)

    service.markTurnTerminal('session-1', 'success', turn.turnId)

    expect(mockMainLoggerService.info).toHaveBeenCalledWith(
      'Ignored agent session terminal callback',
      expect.objectContaining({
        reason: 'settled',
        sessionId: 'session-1',
        expectedTurnId: turn.turnId,
        replies: expect.arrayContaining([
          expect.objectContaining({ turnId: turn.turnId, deliveryKind: 'settled', pendingResultCount: 0 })
        ])
      })
    )
    expect(listener).toHaveBeenCalledOnce()
    expect(JSON.stringify(entry.runtimeState.execution)).toBe(before)
    ;(service as any).clearIdleTimer(entry)
  })

  it('logs an unknown pending result count as null', () => {
    const service = new AgentSessionRuntimeService()
    service.beginTurn(baseTurnInput)
    const entry = getEntry(service)
    const turn = entry.currentTurn
    ;(service as any).applyRuntimeStateEvent(entry, { type: 'reply-results', turn, toolCallIds: undefined })

    service.markTurnTerminal('session-1', 'success', 'missing-turn')

    expect(mockMainLoggerService.info).toHaveBeenCalledWith(
      'Ignored agent session terminal callback',
      expect.objectContaining({
        reason: 'turn-not-found',
        replies: expect.arrayContaining([expect.objectContaining({ turnId: turn.turnId, pendingResultCount: null })])
      })
    )
    ;(service as any).clearIdleTimer(entry)
  })

  it('finishes a topic when its deferred reply has already settled', async () => {
    const { AiStreamManager } = await import('@main/ai/streamManager/AiStreamManager')
    const { MessageRuntimeTimingCollector } = await import('@main/ai/streamManager/MessageRuntimeTimingCollector')
    const service = new AgentSessionRuntimeService()
    const handle = service.beginTurn(baseTurnInput)
    const entry = getEntry(service)
    const original = entry.currentTurn
    ;(service as any).applyRuntimeStateEvent(entry, { type: 'turn-stream-opened', turn: original })
    ;(service as any).applyRuntimeStateEvent(entry, { type: 'turn-admitted', turn: original })
    ;(service as any).handleRuntimeEvent(entry, { type: 'turn-complete' })
    ;(service as any).handleRuntimeEvent(entry, {
      type: 'autonomous-turn-state',
      state: 'started',
      origin: { kind: 'background-work' }
    })
    const originalResult = {
      status: 'success' as const,
      isTopicDone: true,
      modelId: original.modelId,
      finalMessage: {
        id: original.assistantMessageId,
        role: 'assistant' as const,
        parts: [{ type: 'text' as const, text: 'done' }]
      }
    }
    await persistenceListener(handle).onDone(originalResult)
    terminalListener(handle).onDone(originalResult)
    await vi.waitFor(() => expect(mocks.startRuntimeTurn).toHaveBeenCalledTimes(1))
    expect(entry.runtimeState.execution.deferred.delivery.kind).toBe('settled')
    const wake = entry.currentTurn
    expect(wake.turnId).not.toBe(original.turnId)
    const wakeHandle = mocks.startRuntimeTurn.mock.calls[0][0]
    ;(service as any).applyRuntimeStateEvent(entry, { type: 'turn-stream-opened', turn: wake })
    ;(service as any).handleRuntimeEvent(entry, { type: 'autonomous-turn-state', state: 'finished' })
    ;(service as any).handleRuntimeEvent(entry, { type: 'turn-complete' })
    const applicationGet = mocks.applicationGet.getMockImplementation()!
    mocks.applicationGet.mockImplementation((name) =>
      name === 'AgentSessionRuntimeService' ? service : applicationGet(name)
    )
    const manager = new AiStreamManager()
    const persistenceSpy = vi.spyOn(persistenceListener(wakeHandle), 'onDone')
    const terminalSpy = vi.spyOn(terminalListener(wakeHandle), 'onDone')
    const results: any[] = []
    let lifecycleCount = 0
    const listener = {
      id: 'observer',
      terminalPhase: 'cleanup' as const,
      isAlive: () => true,
      onChunk() {},
      onDone(result: any) {
        results.push(result)
      },
      onError() {},
      onPaused() {}
    }
    const cleanupSpy = vi.spyOn(listener, 'onDone')
    const execution: any = {
      status: 'streaming',
      modelId: wake.modelId,
      attemptId: 1,
      anchorMessageId: wake.assistantMessageId,
      abortController: new AbortController(),
      runtimeTiming: new MessageRuntimeTimingCollector(),
      timings: {},
      finalMessage: { ...originalResult.finalMessage, id: wake.assistantMessageId }
    }
    const stream: any = {
      topicId: entry.topicId,
      turnId: 'turn',
      status: 'streaming',
      isPersistentConversation: true,
      executions: new Map([[wake.modelId, execution]]),
      listeners: new Map([...wakeHandle.listeners, listener].map((item) => [item.id, item])),
      lifecycle: {
        onTerminal() {
          lifecycleCount++
        },
        cleanup() {}
      }
    }
    ;(manager as any).activeStreams.set(entry.topicId, stream)
    ;(manager as any).completedBatchTasks.set(entry.topicId, new Set(['previous']))
    ;(manager as any).failedCompletionAttempts.set(entry.topicId, new Set([0]))
    expect(service.willContinueTopic(entry.topicId)).toBe(false)
    await manager.onExecutionDone(entry.topicId, wake.modelId, execution)
    expect(results).toHaveLength(1)
    expect(results[0].isTopicDone).toBe(true)
    expect(results[0].persistence.status).toBe('saved')
    expect(terminalSpy).toHaveBeenCalledOnce()
    expect(terminalSpy.mock.calls[0][0]).toMatchObject({ persistence: { status: 'saved' } })
    expect(persistenceSpy.mock.invocationCallOrder[0]).toBeLessThan(terminalSpy.mock.invocationCallOrder[0])
    expect(terminalSpy.mock.invocationCallOrder[0]).toBeLessThan(cleanupSpy.mock.invocationCallOrder[0])
    expect(entry.runtimeState.execution.kind).toBe('idle')
    expect(service.isSessionBusy('session-1')).toBe(false)
    expect(manager.hasLiveStream(entry.topicId)).toBe(false)
    expect(lifecycleCount).toBe(1)
    expect((manager as any).completedBatchTasks.has(entry.topicId)).toBe(false)
    expect((manager as any).failedCompletionAttempts.has(entry.topicId)).toBe(false)
    expect(mocks.startRuntimeTurn).toHaveBeenCalledTimes(1)
    await manager.onExecutionDone(entry.topicId, wake.modelId, execution)
    expect(results).toHaveLength(1)
    expect(lifecycleCount).toBe(1)
    expect(terminalSpy).toHaveBeenCalledOnce()
    ;(service as any).clearIdleTimer(entry)
  })

  it('keeps an unfinished deferred reply alive and reopens it without resending', async () => {
    const { AiStreamManager } = await import('@main/ai/streamManager/AiStreamManager')
    const { MessageRuntimeTimingCollector } = await import('@main/ai/streamManager/MessageRuntimeTimingCollector')
    const service = new AgentSessionRuntimeService()
    service.beginTurn(baseTurnInput)
    const entry = getEntry(service)
    const original = entry.currentTurn
    ;(service as any).applyRuntimeStateEvent(entry, { type: 'turn-stream-opened', turn: original })
    ;(service as any).applyRuntimeStateEvent(entry, { type: 'turn-admitted', turn: original })
    ;(service as any).handleRuntimeEvent(entry, {
      type: 'autonomous-turn-state',
      state: 'started',
      origin: { kind: 'goal-round', round: 1 }
    })
    await vi.waitFor(() => expect(mocks.startRuntimeTurn).toHaveBeenCalledTimes(1))
    const wake = entry.currentTurn
    const wakeHandle = mocks.startRuntimeTurn.mock.calls[0][0]
    ;(service as any).applyRuntimeStateEvent(entry, { type: 'turn-stream-opened', turn: wake })
    ;(service as any).handleRuntimeEvent(entry, { type: 'turn-complete' })
    ;(service as any).handleRuntimeEvent(entry, { type: 'autonomous-turn-state', state: 'finished' })
    const applicationGet = mocks.applicationGet.getMockImplementation()!
    mocks.applicationGet.mockImplementation((name) =>
      name === 'AgentSessionRuntimeService' ? service : applicationGet(name)
    )
    const manager = new AiStreamManager()
    const results: any[] = []
    let lifecycleCount = 0
    const listener = {
      id: 'observer',
      terminalPhase: 'cleanup' as const,
      isAlive: () => true,
      onChunk() {},
      onDone(result: any) {
        results.push(result)
      },
      onError() {},
      onPaused() {}
    }
    const execution: any = {
      status: 'streaming',
      modelId: wake.modelId,
      attemptId: 1,
      anchorMessageId: wake.assistantMessageId,
      abortController: new AbortController(),
      runtimeTiming: new MessageRuntimeTimingCollector(),
      timings: {},
      finalMessage: { id: wake.assistantMessageId, role: 'assistant', parts: [{ type: 'text', text: 'done' }] }
    }
    const stream: any = {
      topicId: entry.topicId,
      turnId: 'turn',
      status: 'streaming',
      isPersistentConversation: true,
      executions: new Map([[wake.modelId, execution]]),
      listeners: new Map([...wakeHandle.listeners, listener].map((item) => [item.id, item])),
      lifecycle: {
        onTerminal() {
          lifecycleCount++
        },
        cleanup() {}
      }
    }
    ;(manager as any).activeStreams.set(entry.topicId, stream)
    expect(service.willContinueTopic(entry.topicId)).toBe(true)
    await manager.onExecutionDone(entry.topicId, wake.modelId, execution)
    expect(results).toHaveLength(1)
    expect(results[0].isTopicDone).toBe(false)
    expect(lifecycleCount).toBe(0)
    await vi.waitFor(() => expect(mocks.startRuntimeTurn).toHaveBeenCalledTimes(2))
    expect(entry.currentTurn).toBe(original)
    expect(entry.runtimeState.execution.reply.admission).toBe('admitted')
    const resumedHandle = mocks.startRuntimeTurn.mock.calls[1][0]
    ;(service as any).applyRuntimeStateEvent(entry, { type: 'turn-stream-opened', turn: original })
    ;(service as any).applyRuntimeStateEvent(entry, { type: 'flush-transition', turn: original })
    const send = vi.fn()
    entry.connection = { send }
    await (service as any).admitTurn(entry, original)
    expect(send).not.toHaveBeenCalled()
    ;(service as any).handleRuntimeEvent(entry, { type: 'turn-complete' })
    const result = {
      status: 'success' as const,
      isTopicDone: true,
      modelId: original.modelId,
      finalMessage: {
        id: original.assistantMessageId,
        role: 'assistant' as const,
        parts: [{ type: 'text' as const, text: 'done' }]
      }
    }
    await persistenceListener(resumedHandle).onDone(result)
    terminalListener(resumedHandle).onDone(result)
    expect(service.isSessionBusy('session-1')).toBe(false)
    ;(service as any).clearIdleTimer(entry)
  })
})
