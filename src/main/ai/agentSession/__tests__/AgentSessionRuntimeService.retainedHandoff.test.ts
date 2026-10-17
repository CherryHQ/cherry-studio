/**
 * Cross-boundary regression: the real `AiStreamManager` and real `PersistenceListener` drive the
 * terminal handoff of a retained agent's interrupted reply, so neither side of the stream-manager →
 * persistence contract is mocked away.
 *
 * Scenario (top-bar switch from agent A to agent B while A's detached work still holds A's
 * connection): A's autonomous reply is streaming when the runtime dissolves it. B's input is
 * deferred behind that reply and must resume only once A's reply has actually persisted.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { BaseService } from '@main/core/lifecycle/BaseService'

const mocks = vi.hoisted(() => ({
  saveMessage: vi.fn(),
  replaceMessageParts: vi.fn(),
  getSessionMessage: vi.fn(),
  hasSessionMessage: vi.fn(() => true),
  applyToolApprovalDecision: vi.fn(),
  getLastRuntimeResumeToken: vi.fn(),
  getNativeSessionId: vi.fn(),
  findCrashOrphanedAssistantMessages: vi.fn(),
  resolveCrashOrphanedMessages: vi.fn(),
  maybeRenameAgentSession: vi.fn(),
  applicationGet: vi.fn(),
  streamText: vi.fn(),
  cacheSetShared: vi.fn(),
  cacheGetShared: vi.fn(),
  cacheDeleteShared: vi.fn(),
  getSessionById: vi.fn(),
  getAgent: vi.fn(),
  ensureTraceId: vi.fn(),
  recordUsage: vi.fn(),
  findPendingAssistantMessageIds: vi.fn(),
  markMessagesError: vi.fn(),
  saveSpans: vi.fn(),
  willContinueTopic: vi.fn(),
  abortPendingTurn: vi.fn(),
  getWindow: vi.fn(),
  trackTokenUsage: vi.fn(),
  closeWarmQueries: vi.fn()
}))

vi.mock('@data/services/AgentSessionService', () => ({
  agentSessionService: { getById: mocks.getSessionById, ensureTraceId: mocks.ensureTraceId }
}))

vi.mock('@data/services/AgentService', () => ({
  agentService: { getAgent: mocks.getAgent, onAgentUpdated: () => () => {} }
}))

vi.mock('@data/services/AgentSessionMessageService', () => ({
  agentSessionMessageService: {
    saveMessage: mocks.saveMessage,
    replaceMessageParts: mocks.replaceMessageParts,
    getSessionMessage: mocks.getSessionMessage,
    hasSessionMessage: mocks.hasSessionMessage,
    applyToolApprovalDecision: mocks.applyToolApprovalDecision,
    getLastRuntimeResumeToken: mocks.getLastRuntimeResumeToken,
    getNativeSessionId: mocks.getNativeSessionId,
    findCrashOrphanedAssistantMessages: mocks.findCrashOrphanedAssistantMessages,
    resolveCrashOrphanedMessages: mocks.resolveCrashOrphanedMessages
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

vi.mock('@main/data/services/MessageService', () => ({
  messageService: {
    findPendingAssistantMessageIds: () => mocks.findPendingAssistantMessageIds(),
    markMessagesError: (ids: string[]) => mocks.markMessagesError(ids)
  }
}))

vi.mock('@application', () => ({
  application: { get: mocks.applicationGet, getPath: (key: string) => `/mock/${key}` }
}))

const { AgentSessionRuntimeService } = await import('../AgentSessionRuntimeService')
const { AiStreamManager } = await import('../../streamManager/AiStreamManager')

type Service = InstanceType<typeof AgentSessionRuntimeService>
type Manager = InstanceType<typeof AiStreamManager>

const baseTurnInput = {
  sessionId: 'session-1',
  topicId: 'agent-session:session-1',
  agentId: 'agent-1',
  agentType: 'test-runtime',
  modelId: 'claude-code::claude-sonnet-4-5' as any,
  assistantMessageId: 'assistant-1',
  traceId: 'a'.repeat(32)
}
const switchedModelId = 'claude-code::claude-opus-4-5' as any

function userMessage(id: string) {
  return {
    id,
    topicId: 'agent-session:session-1',
    parentId: null,
    role: 'user',
    data: { parts: [{ type: 'text', text: 'hello' }] },
    status: 'success',
    createdAt: '',
    updatedAt: ''
  } as any
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

function entryOf(service: Service) {
  const entry = (service as any).entries.get('session-1')
  if (!entry) throw new Error('runtime entry missing')
  return entry
}

/** A retained connection whose reconcile reports it can no longer be trusted. */
function retainedConnection() {
  return {
    agentId: 'agent-1',
    send: vi.fn(),
    close: vi.fn(),
    events: [],
    reconcile: vi.fn().mockResolvedValue('invalid' as const)
  }
}

/**
 * Drive the switch up to the point A's autonomous reply is streaming and B's accepted input is
 * deferred behind it. Returns the turn/reader so the caller controls when the stream is torn down.
 */
async function streamAutonomousReplyUnderDeferredSwitch(service: Service) {
  service.beginTurn({ ...baseTurnInput, userMessage: userMessage('user-1') })
  const entry = entryOf(service)
  const retained = retainedConnection()
  // The documented injection shape: `runtimeState.connection`, never a bare `entry.connection`.
  // Occupancy needs no `connection` argument — the reducer reads it off the `connected` variant.
  entry.runtimeState.connection = { kind: 'connected', connection: retained, occupancy: {} }
  ;(service as any).handleRuntimeEvent(entry, { type: 'background-work-state', active: true }, retained)
  service.markTurnTerminal('session-1', 'success')

  mocks.getSessionById.mockReturnValue({ id: 'session-1', agentId: 'agent-2' })
  mocks.getAgent.mockReturnValue({ id: 'agent-2', type: 'test-runtime', name: 'Agent B', model: switchedModelId })
  service.beginTurn({
    ...baseTurnInput,
    agentId: 'agent-2',
    modelId: switchedModelId,
    assistantMessageId: 'assistant-2',
    messageSnapshot: { agentName: 'Agent B' } as any,
    userMessage: userMessage('user-2')
  })

  mocks.saveMessage.mockClear()
  ;(service as any).handleRuntimeEvent(
    entry,
    { type: 'autonomous-turn-state', state: 'started', origin: { kind: 'background-work' } },
    retained
  )
  await flush()

  const autonomousTurn = entry.runtimeState.execution.turn
  const reader = service
    .openTurnStream({
      sessionId: 'session-1',
      turnId: autonomousTurn.turnId,
      signal: autonomousTurn.abortController.signal
    })
    .getReader()
  await expect(reader.read()).resolves.toMatchObject({ value: { type: 'start' } })
  await flush()
  // The placeholder row's id is whatever the backend assigned — the turn carries it.
  return { entry, retained, autonomousTurn, reader, savedId: autonomousTurn.assistantMessageId as string }
}

/**
 * Every assistant row the real `PersistenceListener` has written, in order. The mock assigns an id
 * when the payload omits one, so the row the turn actually claims is recorded here.
 */
const persistLog: Array<{ id: string; status: string }> = []

function persistedRows() {
  const rows = new Map<string, string>()
  for (const entry of persistLog) rows.set(entry.id, entry.status)
  return rows
}

describe('retained-reply interruption hands B back only after A persists', () => {
  let manager: Manager

  beforeEach(() => {
    BaseService.resetInstances()
    vi.clearAllMocks()
    persistLog.length = 0
    let generated = 0
    mocks.saveMessage.mockImplementation(({ message }) => {
      const saved = {
        ...message,
        id: message.id ?? `generated-message-${++generated}`,
        updatedAt: '2026-01-01T00:00:00.000Z'
      }
      persistLog.push({ id: saved.id, status: String(saved.status) })
      return saved
    })
    mocks.getSessionById.mockReturnValue({ updatedAt: '2026-01-01T00:00:01.000Z' })
    mocks.getLastRuntimeResumeToken.mockReturnValue(null)
    mocks.findCrashOrphanedAssistantMessages.mockReturnValue([])
    mocks.findPendingAssistantMessageIds.mockReturnValue([])
    mocks.ensureTraceId.mockReturnValue('b'.repeat(32))
    mocks.getAgent.mockReturnValue({ id: 'agent-1', type: 'test-runtime', model: baseTurnInput.modelId })
    mocks.saveSpans.mockResolvedValue(undefined)
    mocks.willContinueTopic.mockReturnValue(false)
    mocks.abortPendingTurn.mockReturnValue(false)
    mocks.closeWarmQueries.mockResolvedValue(undefined)
    // A's reply keeps producing until something aborts it: the stream closes on the execution's
    // abort signal, the way a provider stream does.
    mocks.streamText.mockImplementation((request: { requestOptions?: { signal?: AbortSignal } }) => {
      const signal = request.requestOptions?.signal
      return new ReadableStream({
        start(controller) {
          if (signal?.aborted) controller.close()
          else signal?.addEventListener('abort', () => controller.close(), { once: true })
        }
      })
    })

    manager = new (AiStreamManager as unknown as new () => Manager)()
    mocks.applicationGet.mockImplementation((name: string) => {
      if (name === 'AiStreamManager') return manager
      if (name === 'AiService') return { streamText: mocks.streamText }
      if (name === 'CacheService')
        return {
          setShared: mocks.cacheSetShared,
          getShared: mocks.cacheGetShared,
          deleteShared: mocks.cacheDeleteShared
        }
      if (name === 'TraceStorageService') return { saveSpans: mocks.saveSpans }
      if (name === 'AgentSessionRuntimeService')
        return { willContinueTopic: mocks.willContinueTopic, abortPendingTurn: mocks.abortPendingTurn }
      if (name === 'WindowManager') return { getWindow: mocks.getWindow }
      if (name === 'AnalyticsService') return { trackTokenUsage: mocks.trackTokenUsage }
      if (name === 'ClaudeCodeWarmQueryManager') return { closeAll: mocks.closeWarmQueries }
      throw new Error(`Unexpected application.get(${name})`)
    })
  })

  it('persists the interrupted reply before the deferred turn starts', async () => {
    const service = new AgentSessionRuntimeService()
    const { entry, retained, reader, savedId } = await streamAutonomousReplyUnderDeferredSwitch(service)

    const before = persistedRows().get(savedId)
    expect(before).toBe('pending')

    // Clearing A's model invalidates the retained connection mid-reply.
    mocks.getAgent.mockImplementation((agentId: string) =>
      agentId === 'agent-1'
        ? { id: 'agent-1', type: 'test-runtime', model: null }
        : { id: 'agent-2', type: 'test-runtime', name: 'Agent B', model: switchedModelId }
    )
    const managerInternals = manager as unknown as {
      activeStreams: Map<string, { turnId: string; executions: Map<string, unknown> }>
    }
    const aStream = managerInternals.activeStreams.get('agent-session:session-1')
    const aStreamTurnId = aStream?.turnId
    expect([...(aStream?.executions.keys() ?? [])]).toEqual([baseTurnInput.modelId])

    await (service as any).handleAgentUpdated('agent-1', { model: null }, { id: 'agent-1', model: null })

    // A's row must reach `paused` — and only then may B's turn take the topic over. B's
    // `startRuntimeTurn` evicts A's stream, and once it is gone `onExecutionPaused` early-returns
    // on the missing stream, so the row could never be written again.
    await vi.waitFor(() => {
      expect(persistedRows().get(savedId)).toBe('paused')
    })
    expect(retained.close).toHaveBeenCalled()

    const bStream = managerInternals.activeStreams.get('agent-session:session-1')
    expect(bStream?.turnId).not.toBe(aStreamTurnId)
    expect([...(bStream?.executions.keys() ?? [])]).toEqual([switchedModelId])

    // B's deferred input is now the session's live turn, and it resumed after A's row landed.
    expect(entry.runtimeState.execution).toMatchObject({
      kind: 'turn',
      turn: expect.objectContaining({ assistantMessageId: 'assistant-2' })
    })
    await flush()
    expect(persistedRows().get(savedId)).toBe('paused')

    void reader.cancel().catch(() => undefined)
    void service.closeSession('session-1')
  })

  /**
   * Pre-registration gap: the interrupted reply is a receive-only turn whose launch saved its
   * placeholder but is still yielding inside `refreshTurnTraceContext` — its stream was never
   * registered, so `pauseRuntimeTurn` cannot abort it and `awaitAbortedExecutions` observes a
   * previous execution. The teardown must wait for that exact launch to finish (and settle the
   * registered stream it may still open) before acknowledging the interruption and letting B run;
   * otherwise B takes the topic over while A's row is still `pending`.
   */
  it('holds the acknowledgement until the interrupted receive-only launch settles', async () => {
    const service = new AgentSessionRuntimeService()
    service.beginTurn({ ...baseTurnInput, userMessage: userMessage('user-1') })
    const entry = entryOf(service)
    let releaseTraceRefresh: (() => void) | undefined
    const traceGate = new Promise<void>((resolve) => {
      releaseTraceRefresh = resolve
    })
    const retained = {
      agentId: 'agent-1',
      send: vi.fn(),
      close: vi.fn(),
      events: [],
      reconcile: vi.fn().mockResolvedValue('invalid' as const),
      // Keeps A's launch suspended after the placeholder save, before its stream registers.
      refreshTraceContext: vi.fn(() => traceGate)
    }
    entry.runtimeState.connection = { kind: 'connected', connection: retained, occupancy: {} }
    ;(service as any).handleRuntimeEvent(entry, { type: 'background-work-state', active: true }, retained)
    service.markTurnTerminal('session-1', 'success')

    mocks.getSessionById.mockReturnValue({ id: 'session-1', agentId: 'agent-2' })
    mocks.getAgent.mockReturnValue({ id: 'agent-2', type: 'test-runtime', name: 'Agent B', model: switchedModelId })
    service.beginTurn({
      ...baseTurnInput,
      agentId: 'agent-2',
      modelId: switchedModelId,
      assistantMessageId: 'assistant-2',
      messageSnapshot: { agentName: 'Agent B' } as any,
      userMessage: userMessage('user-2')
    })

    mocks.saveMessage.mockClear()
    ;(service as any).handleRuntimeEvent(
      entry,
      { type: 'autonomous-turn-state', state: 'started', origin: { kind: 'background-work' } },
      retained
    )
    await flush()

    // The launch is suspended mid-flight: placeholder persisted, turn created, stream unregistered.
    const interruptedTurn = entry.runtimeState.execution.turn
    expect(interruptedTurn).toBeDefined()
    const savedId = interruptedTurn.assistantMessageId as string
    expect(persistedRows().get(savedId)).toBe('pending')
    const managerInternals = manager as unknown as {
      activeStreams: Map<string, { executions: Map<string, unknown> }>
    }
    expect(managerInternals.activeStreams.get('agent-session:session-1')).toBeUndefined()

    // Clearing A's model invalidates the retained connection while A's launch is still yielding.
    mocks.getAgent.mockImplementation((agentId: string) =>
      agentId === 'agent-1'
        ? { id: 'agent-1', type: 'test-runtime', model: null }
        : { id: 'agent-2', type: 'test-runtime', name: 'Agent B', model: switchedModelId }
    )
    await (service as any).handleAgentUpdated('agent-1', { model: null }, { id: 'agent-1', model: null })
    await flush()

    // The acknowledgement must not adopt B's deferred turn before A's launch has settled.
    expect(entry.runtimeState.execution.kind).toBe('autonomous-turn')

    // Releasing the launch lets A register, take the teardown's abort, and persist `paused` —
    // only then is B's deferred input handed back.
    releaseTraceRefresh!()
    await vi.waitFor(() => expect(persistedRows().get(savedId)).toBe('paused'))
    await vi.waitFor(() =>
      expect(entry.runtimeState.execution).toMatchObject({
        kind: 'turn',
        turn: expect.objectContaining({ assistantMessageId: 'assistant-2' })
      })
    )
    expect(persistedRows().get(savedId)).toBe('paused')
    expect(retained.close).toHaveBeenCalled()

    void service.closeSession('session-1')
  })

  /**
   * Pre-registration gap: the retained reconcile verdict lands while the receive-only launch is
   * still pending its turn creation (B's input suspended, `execution.turn` not yet minted). The
   * teardown's settlement is turn-keyed, so an `invalid`/`failed` verdict skipped it entirely and
   * the stale launch later minted a zombie receive-only turn on a reconnect — B's deferred input
   * stayed parked forever. The `current` control is the healthy handoff that must keep working.
   */
  describe('reconcile verdict lands before the receive-only turn exists', () => {
    async function suspendInputAndArmRetainedReconcile(verdict: 'invalid' | 'failed' | 'current') {
      const service = new AgentSessionRuntimeService()
      service.beginTurn({ ...baseTurnInput, userMessage: userMessage('user-1') })
      const entry = entryOf(service)
      const retained = {
        agentId: 'agent-1',
        send: vi.fn(),
        close: vi.fn(),
        events: [],
        reconcile: vi.fn().mockResolvedValue(verdict)
      }
      entry.runtimeState.connection = { kind: 'connected', connection: retained, occupancy: {} }
      ;(service as any).handleRuntimeEvent(entry, { type: 'background-work-state', active: true }, retained)
      service.markTurnTerminal('session-1', 'success')

      mocks.getSessionById.mockReturnValue({ id: 'session-1', agentId: 'agent-2' })
      mocks.getAgent.mockReturnValue({ id: 'agent-2', type: 'test-runtime', name: 'Agent B', model: switchedModelId })
      service.beginTurn({
        ...baseTurnInput,
        agentId: 'agent-2',
        modelId: switchedModelId,
        assistantMessageId: 'assistant-2',
        messageSnapshot: { agentName: 'Agent B' } as any,
        userMessage: userMessage('user-2')
      })

      mocks.saveMessage.mockClear()
      ;(service as any).handleRuntimeEvent(
        entry,
        { type: 'autonomous-turn-state', state: 'started', origin: { kind: 'background-work' } },
        retained
      )
      // B's input suspension has started, but the receive-only launch has not minted its turn —
      // the exact window the verdict can land in.
      expect(entry.runtimeState.execution).toMatchObject({ kind: 'autonomous-turn', ownership: 'active' })
      expect(entry.runtimeState.execution.turn).toBeUndefined()
      return { service, entry, retained }
    }

    it.each(['invalid', 'failed'] as const)(
      'resumes the deferred input when retained reconciliation reports %s before the receive-only turn exists',
      async (verdict) => {
        const { service, entry, retained } = await suspendInputAndArmRetainedReconcile(verdict)

        await (service as any).handleAgentUpdated('agent-1', { model: null }, { id: 'agent-1', model: null })
        await flush()

        expect(retained.close).toHaveBeenCalled()
        // The dead connection must not mint a receive-only turn: no placeholder row, and the
        // autonomous execution is gone.
        expect(mocks.saveMessage).not.toHaveBeenCalled()
        await vi.waitFor(() => {
          expect(entry.runtimeState.execution).toMatchObject({
            kind: 'turn',
            turn: expect.objectContaining({ assistantMessageId: 'assistant-2' })
          })
        })
        // The resume is real: B's runtime execution is registered on the topic stream.
        const managerInternals = manager as unknown as {
          activeStreams: Map<string, { executions: Map<string, unknown> }>
        }
        expect([...(managerInternals.activeStreams.get('agent-session:session-1')?.executions.keys() ?? [])]).toEqual([
          switchedModelId
        ])

        void service.closeSession('session-1')
      }
    )

    it('current control: the receive-only turn is still created and B resumes after it settles', async () => {
      const { service, entry, retained } = await suspendInputAndArmRetainedReconcile('current')

      await (service as any).handleAgentUpdated('agent-1', { model: null }, { id: 'agent-1', model: null })
      await flush()

      expect(retained.close).not.toHaveBeenCalled()
      const receiveOnlyTurn = entry.runtimeState.execution.turn
      expect(receiveOnlyTurn).toBeDefined()
      expect(mocks.saveMessage).toHaveBeenCalledTimes(1)

      // A's generation ends on its own, then the turn settles — the healthy handoff sequence.
      ;(service as any).handleRuntimeEvent(entry, { type: 'autonomous-turn-state', state: 'finished' }, retained)
      service.markTurnTerminal('session-1', 'paused', receiveOnlyTurn!.turnId)
      await vi.waitFor(() => {
        expect(entry.runtimeState.execution).toMatchObject({
          kind: 'turn',
          turn: expect.objectContaining({ assistantMessageId: 'assistant-2' })
        })
      })

      void service.closeSession('session-1')
    })
  })

  /**
   * Pre-registration gap: A's autonomous reply completes and releases the background work while
   * B's unadmitted stream is still suspending — before the delayed `startReceiveOnlyTurn` runs.
   * The release must not retire the captured author there: the reply streams on A's connection,
   * so its row would otherwise be minted on B's author/model.
   */
  it('attributes the delayed receive-only launch to A when the background work releases first', async () => {
    const service = new AgentSessionRuntimeService()
    service.beginTurn({ ...baseTurnInput, userMessage: userMessage('user-1') })
    const entry = entryOf(service)
    const retained = {
      agentId: 'agent-1',
      send: vi.fn(),
      close: vi.fn(),
      events: [],
      reconcile: vi.fn().mockResolvedValue('current' as const)
    }
    entry.runtimeState.connection = { kind: 'connected', connection: retained, occupancy: {} }
    ;(service as any).handleRuntimeEvent(entry, { type: 'background-work-state', active: true }, retained)
    service.markTurnTerminal('session-1', 'success')

    mocks.getSessionById.mockReturnValue({ id: 'session-1', agentId: 'agent-2' })
    mocks.getAgent.mockReturnValue({ id: 'agent-2', type: 'test-runtime', name: 'Agent B', model: switchedModelId })
    service.beginTurn({
      ...baseTurnInput,
      agentId: 'agent-2',
      modelId: switchedModelId,
      assistantMessageId: 'assistant-2',
      messageSnapshot: { agentName: 'Agent B' } as any,
      userMessage: userMessage('user-2')
    })

    mocks.saveMessage.mockClear()
    ;(service as any).handleRuntimeEvent(
      entry,
      { type: 'autonomous-turn-state', state: 'started', origin: { kind: 'background-work' } },
      retained
    )
    // A's reply finishes and the work releases while B's unadmitted stream is still suspending —
    // the receive-only launch for that reply has not minted its turn yet.
    ;(service as any).handleRuntimeEvent(entry, { type: 'background-work-state', active: false }, retained)

    await vi.waitFor(() => expect(mocks.saveMessage).toHaveBeenCalledTimes(1))
    expect(mocks.saveMessage.mock.calls[0][0].message).toMatchObject({
      modelId: baseTurnInput.modelId,
      messageSnapshot: undefined
    })

    // The release must not strand the handoff: A's reply settles, then B's deferred input resumes.
    const receiveOnlyTurn = entry.runtimeState.execution.turn
    expect(receiveOnlyTurn).toBeDefined()
    ;(service as any).handleRuntimeEvent(entry, { type: 'autonomous-turn-state', state: 'finished' }, retained)
    service.markTurnTerminal('session-1', 'paused', receiveOnlyTurn!.turnId)
    await vi.waitFor(() => {
      expect(entry.runtimeState.execution).toMatchObject({
        kind: 'turn',
        turn: expect.objectContaining({ assistantMessageId: 'assistant-2' })
      })
    })

    void service.closeSession('session-1')
  })
})
