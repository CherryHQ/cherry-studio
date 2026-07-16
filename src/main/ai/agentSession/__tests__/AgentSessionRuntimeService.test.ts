import { BaseService } from '@main/core/lifecycle/BaseService'
import { mockMainLoggerService } from '@test-mocks/MainLoggerService'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  saveMessage: vi.fn(),
  getLastRuntimeResumeToken: vi.fn(),
  findPendingAssistantMessageIds: vi.fn(),
  markMessagesError: vi.fn(),
  maybeRenameAgentSession: vi.fn(),
  applicationGet: vi.fn(),
  startRuntimeTurn: vi.fn(),
  pauseRuntimeTurn: vi.fn(),
  broadcastTopicError: vi.fn(),
  terminateHeldTopicStream: vi.fn(),
  cacheSetShared: vi.fn(),
  cacheDeleteShared: vi.fn(),
  getSessionById: vi.fn(),
  getAgent: vi.fn(),
  ensureTraceId: vi.fn()
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
    getLastRuntimeResumeToken: mocks.getLastRuntimeResumeToken,
    findPendingAssistantMessageIds: mocks.findPendingAssistantMessageIds,
    markMessagesError: mocks.markMessagesError
  }
}))

vi.mock('@main/services/TopicNamingService', () => ({
  topicNamingService: { maybeRenameAgentSession: mocks.maybeRenameAgentSession }
}))

vi.mock('@application', () => ({
  application: { get: mocks.applicationGet }
}))

const { AgentSessionRuntimeService } = await import('../AgentSessionRuntimeService')
const { runtimeDriverRegistry } = await import('../../runtime/registry')
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
  return (service as any).entries.get('session-1')
}

function createAsyncQueue<T>() {
  const items: T[] = []
  const waiters: Array<(value: IteratorResult<T>) => void> = []

  return {
    push(item: T) {
      const waiter = waiters.shift()
      if (waiter) waiter({ value: item, done: false })
      else items.push(item)
    },
    iterable: {
      [Symbol.asyncIterator](): AsyncIterator<T> {
        return {
          next: () => {
            const item = items.shift()
            if (item) return Promise.resolve({ value: item, done: false })
            return new Promise<IteratorResult<T>>((resolve) => waiters.push(resolve))
          }
        }
      }
    }
  }
}

function createDeferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

describe('AgentSessionRuntimeService', () => {
  beforeEach(() => {
    BaseService.resetInstances()
    runtimeDriverRegistry.clearForTest()
    vi.clearAllMocks()
    mocks.saveMessage.mockImplementation(({ message }) => ({
      ...message,
      id: message.id ?? 'generated-message-id'
    }))
    mocks.getLastRuntimeResumeToken.mockReturnValue(null)
    mocks.findPendingAssistantMessageIds.mockReturnValue([])
    mocks.markMessagesError.mockReturnValue(undefined)
    mocks.ensureTraceId.mockReturnValue('b'.repeat(32))
    // A live agent with a model — the drain re-reads this to bail on a deleted model. Tests exercising
    // the deleted-model path override it with `{ model: null }`.
    mocks.getAgent.mockReturnValue({ id: 'agent-1', type: 'test-runtime', model: baseTurnInput.modelId })
    mocks.applicationGet.mockImplementation((name: string) => {
      if (name === 'AiStreamManager') {
        return {
          startRuntimeTurn: mocks.startRuntimeTurn,
          pauseRuntimeTurn: mocks.pauseRuntimeTurn,
          broadcastTopicError: mocks.broadcastTopicError,
          terminateHeldTopicStream: mocks.terminateHeldTopicStream
        }
      }
      if (name === 'CacheService') return { setShared: mocks.cacheSetShared, deleteShared: mocks.cacheDeleteShared }
      throw new Error(`Unexpected application.get(${name})`)
    })
  })

  describe('isSessionBusy — inter-turn drain window (issue ①)', () => {
    it('is false with no entry and true while a turn is live', () => {
      const service = new AgentSessionRuntimeService()
      expect(service.isSessionBusy('session-1')).toBe(false)
      service.beginTurn(baseTurnInput)
      expect(service.isSessionBusy('session-1')).toBe(true)
    })

    it('is false once a turn settles with no queued follow-ups', () => {
      const service = new AgentSessionRuntimeService()
      service.beginTurn(baseTurnInput)
      service.markTurnTerminal('session-1', 'success')
      expect(service.isSessionBusy('session-1')).toBe(false)
    })

    it('stays busy throughout the next-turn drain, closing the clobber window', async () => {
      const service = new AgentSessionRuntimeService()
      service.beginTurn(baseTurnInput)
      service.enqueueUserMessage('session-1', userMessage('user-2'))

      service.markTurnTerminal('session-1', 'success') // current turn → terminal, schedules the drain

      const entry = getEntry(service)
      // The bug window: the current turn is terminal and the follow-up drain is scheduled but has
      // not yet swapped in the fresh turn — pre-fix nothing reported the session busy here.
      expect(entry.pendingTurns.length).toBe(1)
      expect(entry.currentTurn.terminalStatus).toBe('success')
      expect(entry.startingNextTurn).toBe(true) // flag now spans the whole drain
      expect(service.isSessionBusy('session-1')).toBe(true)

      await new Promise((resolve) => setTimeout(resolve, 0)) // drain completes → fresh live turn
      expect(service.isSessionBusy('session-1')).toBe(true)
      expect(getEntry(service).startingNextTurn).toBe(false)
    })
  })

  describe('per-turn headless state', () => {
    it('opens a queued busy follow-up as headless when enqueueUserMessage is marked headless', async () => {
      const service = new AgentSessionRuntimeService()
      service.beginTurn(baseTurnInput)

      service.enqueueUserMessage('session-1', userMessage('user-2'), { headless: true })
      expect(getEntry(service).headlessMessageIds.has('user-2')).toBe(true)

      service.markTurnTerminal('session-1', 'success')
      await new Promise((resolve) => setTimeout(resolve, 0))

      const entry = getEntry(service)
      expect(entry.currentTurn.userMessage.id).toBe('user-2')
      expect(entry.currentTurn.headless).toBe(true)
      expect(entry.headlessMessageIds?.has('user-2')).toBe(false)
      expect(service.isCurrentTurnHeadless('session-1')).toBe(true)
    })

    it('stamps a queued follow-up with its enqueue-time snapshot, not the prior turn snapshot', async () => {
      const service = new AgentSessionRuntimeService()
      const priorSnapshot = {
        id: 'agent-1',
        name: 'Old',
        model: { id: 'old', name: 'Old', provider: 'p' }
      } as any
      const followUpSnapshot = {
        id: 'agent-1',
        name: 'New',
        // Model matches the entry's running model — no mid-queue model switch here, so the drain-time
        // reconcile is a no-op and the frozen author (name 'New') is preserved verbatim.
        model: { id: 'claude-sonnet-4-5', name: 'New', provider: 'claude-code' }
      } as any

      // Turn 1 sets the entry snapshot; the follow-up queues with a fresh snapshot (agent renamed/model swapped).
      service.beginTurn({ ...baseTurnInput, messageSnapshot: priorSnapshot })
      service.enqueueUserMessage('session-1', userMessage('user-2'), { messageSnapshot: followUpSnapshot })
      service.markTurnTerminal('session-1', 'success')
      await new Promise((resolve) => setTimeout(resolve, 0))

      // The queued turn's assistant placeholder freezes the enqueue-time author, not the stale entry snapshot.
      const assistantSaves = mocks.saveMessage.mock.calls
        .map((call) => call[0].message)
        .filter((m: any) => m.role === 'assistant')
      expect(assistantSaves.at(-1)?.messageSnapshot).toEqual(followUpSnapshot)
      expect(getEntry(service).pendingSnapshots?.has('user-2')).toBe(false)
    })

    it('freezes a redirected steer-boundary continuation with the follow-up snapshot', async () => {
      const service = new AgentSessionRuntimeService()
      const priorSnapshot = {
        id: 'agent-1',
        name: 'Old',
        model: { id: 'old', name: 'Old', provider: 'p' }
      } as any
      const followUpSnapshot = {
        id: 'agent-1',
        name: 'New',
        // Model matches the entry's running model — no mid-queue model switch here, so the drain-time
        // reconcile is a no-op and the frozen author (name 'New') is preserved verbatim.
        model: { id: 'claude-sonnet-4-5', name: 'New', provider: 'claude-code' }
      } as any

      service.beginTurn({ ...baseTurnInput, userMessage: userMessage('user-1'), messageSnapshot: priorSnapshot })
      const entry = getEntry(service)
      const connection = { close: vi.fn(), send: vi.fn(), events: [], redirect: vi.fn().mockReturnValue(true) }
      entry.connection = connection
      entry.connectionModelId = baseTurnInput.modelId

      // Native steer accepts the follow-up via redirect → its snapshot must still be stored, and the
      // steer-boundary continuation (A2) must freeze it, not the prior turn's entry snapshot.
      service.enqueueUserMessage('session-1', userMessage('user-2'), { messageSnapshot: followUpSnapshot })
      expect(connection.redirect).toHaveBeenCalled()
      expect(entry.pendingTurns).toEqual([])

      ;(service as any).handleRuntimeEvent(entry, {
        type: 'steer-boundary',
        inputs: [{ message: userMessage('user-2'), systemReminder: true }]
      })
      await (service as any).startContinuationTurn(entry)

      const assistantSaves = mocks.saveMessage.mock.calls
        .map((call) => call[0].message)
        .filter((m: any) => m.role === 'assistant')
      expect(assistantSaves.at(-1)?.messageSnapshot).toEqual(followUpSnapshot)
      service.closeSession('session-1')
    })

    it('requeues a steer-undelivered follow-up with its enqueue-time snapshot', async () => {
      const service = new AgentSessionRuntimeService()
      const priorSnapshot = {
        id: 'agent-1',
        name: 'Old',
        model: { id: 'old', name: 'Old', provider: 'p' }
      } as any
      const followUpSnapshot = {
        id: 'agent-1',
        name: 'New',
        // Model matches the entry's running model — no mid-queue model switch here, so the drain-time
        // reconcile is a no-op and the frozen author (name 'New') is preserved verbatim.
        model: { id: 'claude-sonnet-4-5', name: 'New', provider: 'claude-code' }
      } as any

      service.beginTurn({ ...baseTurnInput, messageSnapshot: priorSnapshot })
      const entry = getEntry(service)
      const connection = { close: vi.fn(), send: vi.fn(), events: [], redirect: vi.fn().mockReturnValue(true) }
      entry.connection = connection
      entry.connectionModelId = baseTurnInput.modelId

      service.enqueueUserMessage('session-1', userMessage('user-2'), { messageSnapshot: followUpSnapshot })
      expect(connection.redirect).toHaveBeenCalled()

      // Turn ended before the steer landed → requeued; the requeued turn must still freeze the follow-up snapshot.
      ;(service as any).handleRuntimeEvent(entry, {
        type: 'steer-undelivered',
        inputs: [{ message: userMessage('user-2') }]
      })
      service.markTurnTerminal('session-1', 'success')
      await new Promise((resolve) => setTimeout(resolve, 0))

      const assistantSaves = mocks.saveMessage.mock.calls
        .map((call) => call[0].message)
        .filter((m: any) => m.role === 'assistant')
      expect(assistantSaves.at(-1)?.messageSnapshot).toEqual(followUpSnapshot)
    })

    it('opens an unmarked queued busy follow-up as interactive', async () => {
      const service = new AgentSessionRuntimeService()
      service.beginTurn({ ...baseTurnInput, headless: true })

      service.enqueueUserMessage('session-1', userMessage('user-2'))
      service.markTurnTerminal('session-1', 'success')
      await new Promise((resolve) => setTimeout(resolve, 0))

      expect(getEntry(service).currentTurn.headless).toBe(false)
      expect(service.isCurrentTurnHeadless('session-1')).toBe(false)
    })

    it('sets current turn headless from beginTurn input', () => {
      const service = new AgentSessionRuntimeService()

      service.beginTurn({ ...baseTurnInput, headless: true })

      expect(getEntry(service).currentTurn.headless).toBe(true)
      expect(service.isCurrentTurnHeadless('session-1')).toBe(true)
    })

    async function rollContinuation(initialHeadless: boolean, steerHeadless: boolean) {
      const service = new AgentSessionRuntimeService()
      service.beginTurn({ ...baseTurnInput, userMessage: userMessage('user-1'), headless: initialHeadless })
      const entry = getEntry(service)
      if (steerHeadless) (entry.headlessMessageIds ??= new Set()).add('user-2')

      ;(service as any).handleRuntimeEvent(entry, {
        type: 'steer-boundary',
        inputs: [{ message: userMessage('user-2'), systemReminder: true }]
      })
      await (service as any).startContinuationTurn(entry)

      return { service, entry }
    }

    it('keeps a roll continuation headless when the current turn and injected steer are headless', async () => {
      const { service, entry } = await rollContinuation(true, true)

      expect(entry.currentTurn.userMessage.id).toBe('user-2')
      expect(entry.currentTurn.headless).toBe(true)
      expect(entry.rollHeadless).toBeUndefined()
      expect(service.isCurrentTurnHeadless('session-1')).toBe(true)

      service.closeSession('session-1')
    })

    it('opens a headless turn plus interactive steer roll continuation as interactive', async () => {
      const { service, entry } = await rollContinuation(true, false)

      expect(entry.currentTurn.userMessage.id).toBe('user-2')
      expect(entry.currentTurn.headless).toBe(false)
      expect(service.isCurrentTurnHeadless('session-1')).toBe(false)

      service.closeSession('session-1')
    })

    it('opens an interactive turn plus headless steer roll continuation as interactive', async () => {
      const { service, entry } = await rollContinuation(false, true)

      expect(entry.currentTurn.userMessage.id).toBe('user-2')
      expect(entry.currentTurn.headless).toBe(false)
      expect(service.isCurrentTurnHeadless('session-1')).toBe(false)

      service.closeSession('session-1')
    })
  })

  describe('reconcileStalePendingMessages — boot crash recovery', () => {
    it('marks crash-orphaned pending assistant messages as errored on init', async () => {
      mocks.findPendingAssistantMessageIds.mockReturnValue(['stale-1', 'stale-2'])
      const service = new AgentSessionRuntimeService()

      await (service as any).onInit()

      expect(mocks.findPendingAssistantMessageIds).toHaveBeenCalledOnce()
      expect(mocks.markMessagesError).toHaveBeenCalledWith(['stale-1', 'stale-2'])
    })

    it('does not mark anything when there are no stale messages', async () => {
      mocks.findPendingAssistantMessageIds.mockReturnValue([])
      const service = new AgentSessionRuntimeService()

      await (service as any).onInit()

      expect(mocks.markMessagesError).not.toHaveBeenCalled()
    })

    it('logs and does not rethrow when the reconcile lookup throws, so boot is not blocked', async () => {
      const failure = new Error('db down')
      mocks.findPendingAssistantMessageIds.mockImplementation(() => {
        throw failure
      })
      const service = new AgentSessionRuntimeService()

      await expect((service as any).onInit()).resolves.toBeUndefined()

      expect(mocks.markMessagesError).not.toHaveBeenCalled()
      expect(mockMainLoggerService.error).toHaveBeenCalledWith(
        'Failed to reconcile stale pending agent-session messages',
        { error: failure }
      )
    })
  })

  it('creates an active runtime with a session-level pending queue', () => {
    const service = new AgentSessionRuntimeService()

    const handle = service.beginTurn(baseTurnInput)
    service.enqueueUserMessage('session-1', userMessage('user-2'))

    expect(terminalListener(handle).id).toBe('agent-runtime:session-1')
    expect(persistenceListener(handle).id).toContain('persistence:agents-db:agent-session:session-1')
    expect(service.inspect('session-1')).toMatchObject({
      sessionId: 'session-1',
      topicId: 'agent-session:session-1',
      assistantMessageId: 'assistant-1',
      status: 'active',
      pendingMessageCount: 1,
      lastTerminalStatus: undefined,
      activeToolCount: 0
    })
  })

  it('aborts the current turn controller before the stream starts', () => {
    const service = new AgentSessionRuntimeService()
    const handle = service.beginTurn(baseTurnInput)

    expect(service.abortPendingTurn('session-1', 'user-requested')).toBe(true)
    expect(handle.abortController.signal.aborted).toBe(true)
    expect(handle.abortController.signal.reason).toBe('user-requested')
  })

  it('does not reuse an aborted controller for a later turn', () => {
    const service = new AgentSessionRuntimeService()
    const first = service.beginTurn(baseTurnInput)

    expect(service.abortPendingTurn('session-1', 'user-requested')).toBe(true)
    void terminalListener(first).onPaused({ status: 'paused', isTopicDone: true })

    const second = service.beginTurn({
      ...baseTurnInput,
      assistantMessageId: 'assistant-2',
      userMessage: userMessage('user-2')
    })

    expect(first.abortController.signal.aborted).toBe(true)
    expect(second.abortController.signal.aborted).toBe(false)
  })

  it('marks the runtime idle when the terminal listener observes done', () => {
    const service = new AgentSessionRuntimeService()
    const handle = service.beginTurn(baseTurnInput)

    void terminalListener(handle).onDone({ status: 'success', isTopicDone: true })

    expect(service.inspect('session-1')).toMatchObject({
      status: 'idle',
      pendingMessageCount: 0,
      lastTerminalStatus: 'success'
    })
  })

  it('hands an idle session with a resume token to the driver onSessionIdle hook', () => {
    vi.useFakeTimers()
    try {
      const onSessionIdle = vi.fn()
      runtimeDriverRegistry.register({
        type: 'test-runtime',
        capabilities: ['agent-session'],
        connect: vi.fn(),
        validateSession: vi.fn(),
        listAvailableTools: vi.fn().mockResolvedValue([]),
        onSessionIdle
      })
      const service = new AgentSessionRuntimeService()
      const handle = service.beginTurn(baseTurnInput)
      getEntry(service).lastResumeToken = 'resume-1'

      void terminalListener(handle).onDone({ status: 'success', isTopicDone: true })
      vi.advanceTimersByTime(5 * 60 * 1000)

      expect(onSessionIdle).toHaveBeenCalledWith('session-1')
      expect(service.inspect('session-1')).toBeUndefined()
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not call onSessionIdle for an idle session without a resume token', () => {
    vi.useFakeTimers()
    try {
      const onSessionIdle = vi.fn()
      runtimeDriverRegistry.register({
        type: 'test-runtime',
        capabilities: ['agent-session'],
        connect: vi.fn(),
        validateSession: vi.fn(),
        listAvailableTools: vi.fn().mockResolvedValue([]),
        onSessionIdle
      })
      const service = new AgentSessionRuntimeService()
      const handle = service.beginTurn(baseTurnInput)

      void terminalListener(handle).onDone({ status: 'success', isTopicDone: true })
      vi.advanceTimersByTime(5 * 60 * 1000)

      expect(onSessionIdle).not.toHaveBeenCalled()
      expect(service.inspect('session-1')).toBeUndefined()
    } finally {
      vi.useRealTimers()
    }
  })

  it('reuses an idle runtime for the next fresh turn', () => {
    const service = new AgentSessionRuntimeService()
    const first = service.beginTurn(baseTurnInput)
    const entry = getEntry(service)
    const connection = { close: vi.fn(), send: vi.fn(), events: [], reconcile: vi.fn().mockResolvedValue('current') }
    entry.lastResumeToken = 'resume-1'
    entry.connection = connection

    void terminalListener(first).onDone({ status: 'success', isTopicDone: true })
    const second = service.beginTurn({
      ...baseTurnInput,
      assistantMessageId: 'assistant-2',
      userMessage: userMessage('user-2')
    })

    expect(second).not.toBe(first)
    expect(getEntry(service).connection).toBe(connection)
    expect(getEntry(service).pendingTurns).toEqual([])
    expect(service.inspect('session-1')).toMatchObject({
      assistantMessageId: 'assistant-2',
      status: 'active',
      pendingMessageCount: 0,
      resumeToken: 'resume-1'
    })
  })

  it('reuses an idle connection for a headless run regardless of the mode it was built in', () => {
    // Per-turn headless enforcement lives in `canUseTool` / PreToolUse hooks (resolved by session id at
    // fire-time via `isCurrentTurnHeadless`), so the warm connection's baked settings no longer vary by
    // headless mode and never need a mismatch rebuild — an interactive-primed connection is safe to
    // reuse for a scheduled/channel run, which keeps the resume token and avoids a reconnect.
    const service = new AgentSessionRuntimeService()
    const first = service.beginTurn(baseTurnInput)
    const entry = getEntry(service)
    const connection = { close: vi.fn(), send: vi.fn(), events: [], reconcile: vi.fn().mockResolvedValue('current') }
    entry.lastResumeToken = 'resume-1'
    entry.connection = connection

    void terminalListener(first).onDone({ status: 'success', isTopicDone: true })
    const second = service.beginTurn({
      ...baseTurnInput,
      assistantMessageId: 'assistant-2',
      userMessage: userMessage('user-2'),
      headless: true
    })

    expect(second).not.toBe(first)
    expect(connection.close).not.toHaveBeenCalled()
    expect(getEntry(service).connection).toBe(connection)
    expect(getEntry(service).currentTurn.headless).toBe(true)
  })

  it('reconnects an idle runtime when the agent model changes before the next turn', async () => {
    const firstConnection = {
      events: createAsyncQueue<any>().iterable,
      send: vi.fn(),
      close: vi.fn()
    }
    const secondConnection = {
      events: createAsyncQueue<any>().iterable,
      send: vi.fn(),
      close: vi.fn()
    }
    const connect = vi.fn().mockResolvedValueOnce(firstConnection).mockResolvedValueOnce(secondConnection)
    runtimeDriverRegistry.register({
      type: 'test-runtime',
      capabilities: ['agent-session'],
      connect,
      validateSession: vi.fn(),
      listAvailableTools: vi.fn().mockResolvedValue([])
    })
    const service = new AgentSessionRuntimeService()
    const first = service.beginTurn({ ...baseTurnInput, userMessage: userMessage('user-1') })
    const firstStream = service.openTurnStream({
      sessionId: 'session-1',
      turnId: first.turnId,
      signal: new AbortController().signal
    })
    const firstReader = firstStream.getReader()
    await expect(firstReader.read()).resolves.toMatchObject({ value: { type: 'start' }, done: false })
    await vi.waitFor(() => expect(firstConnection.send).toHaveBeenCalled())

    void terminalListener(first).onDone({ status: 'success', isTopicDone: true })
    await (service as any).handleAgentUpdated(
      'agent-1',
      { model: switchedModelId },
      { id: 'agent-1', model: switchedModelId }
    )

    const second = service.beginTurn({
      ...baseTurnInput,
      modelId: switchedModelId,
      assistantMessageId: 'assistant-2',
      userMessage: userMessage('user-2')
    })
    const secondStream = service.openTurnStream({
      sessionId: 'session-1',
      turnId: second.turnId,
      signal: new AbortController().signal
    })
    const secondReader = secondStream.getReader()

    await expect(secondReader.read()).resolves.toMatchObject({ value: { type: 'start' }, done: false })
    await vi.waitFor(() =>
      expect(secondConnection.send).toHaveBeenCalledWith({ message: userMessage('user-2'), systemReminder: false })
    )

    expect(firstConnection.close).toHaveBeenCalled()
    expect(connect).toHaveBeenNthCalledWith(1, expect.objectContaining({ modelId: baseTurnInput.modelId }))
    expect(connect).toHaveBeenNthCalledWith(2, expect.objectContaining({ modelId: switchedModelId }))
    expect(firstConnection.send).toHaveBeenCalledTimes(1)

    await firstReader.cancel().catch(() => undefined)
    await secondReader.cancel().catch(() => undefined)
  })

  it('retries callers sharing an in-flight connect when a mid-flight model edit discards it', async () => {
    const firstConnection = {
      events: createAsyncQueue<any>().iterable,
      send: vi.fn(),
      close: vi.fn(),
      reconcile: vi.fn().mockResolvedValue('current')
    }
    const secondConnection = {
      events: createAsyncQueue<any>().iterable,
      send: vi.fn(),
      close: vi.fn(),
      reconcile: vi.fn().mockResolvedValue('current')
    }
    const firstConnect = createDeferred<any>()
    const connect = vi.fn().mockReturnValueOnce(firstConnect.promise).mockResolvedValueOnce(secondConnection)
    runtimeDriverRegistry.register({
      type: 'test-runtime',
      capabilities: ['agent-session'],
      connect,
      validateSession: vi.fn(),
      listAvailableTools: vi.fn().mockResolvedValue([])
    })
    const service = new AgentSessionRuntimeService()
    service.beginTurn({ ...baseTurnInput, userMessage: userMessage('user-1') })
    const entry = getEntry(service)
    // Turn-less entry (primed / idle-warm): a live turn would pin the target to its captured model.
    entry.currentTurn = undefined

    // Starter opens the first connect; a second caller latches onto the shared in-flight promise.
    const starter = (service as any).ensureConnection(entry) as Promise<boolean>
    const waiter = (service as any).ensureConnection(entry) as Promise<boolean>

    // Model edited while that connect is in flight → the first attempt self-discards and resolves
    // false. Both callers must retry, not surface false — a false with a current entry leaves
    // openTurnStream's turn hanging forever.
    await (service as any).handleAgentUpdated(
      'agent-1',
      { model: switchedModelId },
      { id: 'agent-1', model: switchedModelId }
    )
    firstConnect.resolve(firstConnection)

    await expect(starter).resolves.toBe(true)
    await expect(waiter).resolves.toBe(true)
    expect(firstConnection.close).toHaveBeenCalled()
    expect(secondConnection.close).not.toHaveBeenCalled()
    expect(connect).toHaveBeenCalledTimes(2)
    expect(connect).toHaveBeenNthCalledWith(1, expect.objectContaining({ modelId: baseTurnInput.modelId }))
    expect(connect).toHaveBeenNthCalledWith(2, expect.objectContaining({ modelId: switchedModelId }))
    expect(getEntry(service).connection).toBe(secondConnection)
  })

  it('connects a turn created before a model edit with its captured model (edit-before-open-stream)', async () => {
    const connection = {
      events: createAsyncQueue<any>().iterable,
      send: vi.fn(),
      close: vi.fn(),
      reconcile: vi.fn().mockResolvedValue('current')
    }
    const connect = vi.fn().mockResolvedValue(connection)
    runtimeDriverRegistry.register({
      type: 'test-runtime',
      capabilities: ['agent-session'],
      connect,
      validateSession: vi.fn(),
      listAvailableTools: vi.fn().mockResolvedValue([])
    })
    const service = new AgentSessionRuntimeService()
    const handle = service.beginTurn({ ...baseTurnInput, userMessage: userMessage('user-1') })

    // Model edited in the window between beginTurn (assistant row, turn.modelId, persistence and
    // trace already stamped with the old model) and the renderer opening the turn stream. The turn
    // must execute on the model it records — not silently connect with the edited one.
    await (service as any).handleAgentUpdated(
      'agent-1',
      { model: switchedModelId },
      { id: 'agent-1', model: switchedModelId }
    )

    const stream = service.openTurnStream({
      sessionId: 'session-1',
      turnId: handle.turnId,
      signal: new AbortController().signal
    })
    const reader = stream.getReader()
    await expect(reader.read()).resolves.toMatchObject({ value: { type: 'start' }, done: false })
    await vi.waitFor(() => expect(connection.send).toHaveBeenCalled())

    expect(connect).toHaveBeenCalledTimes(1)
    expect(connect).toHaveBeenCalledWith(expect.objectContaining({ modelId: baseTurnInput.modelId }))
    expect(connection.close).not.toHaveBeenCalled()
    // The next turn (idle entry, no live turn) targets the edited model again.
    expect((service as any).connectionTargetModelId({ ...getEntry(service), currentTurn: undefined })).toBe(
      switchedModelId
    )

    await reader.cancel().catch(() => undefined)
  })

  it('invalidates an entry with an in-flight connect when the agent model is cleared', async () => {
    const connection = {
      events: createAsyncQueue<any>().iterable,
      send: vi.fn(),
      close: vi.fn(),
      reconcile: vi.fn().mockResolvedValue('current')
    }
    const pendingConnect = createDeferred<any>()
    const connect = vi.fn().mockReturnValue(pendingConnect.promise)
    runtimeDriverRegistry.register({
      type: 'test-runtime',
      capabilities: ['agent-session'],
      connect,
      validateSession: vi.fn(),
      listAvailableTools: vi.fn().mockResolvedValue([])
    })
    const service = new AgentSessionRuntimeService()
    service.beginTurn({ ...baseTurnInput, userMessage: userMessage('user-1') })
    const entry = getEntry(service)
    // Turn-less entry (primed / idle-warm) with an in-flight old-model connect.
    entry.currentTurn = undefined
    const connecting = (service as any).ensureConnection(entry) as Promise<boolean>
    await vi.waitFor(() => expect(connect).toHaveBeenCalledOnce())

    // An agent update clears the model (explicit `PATCH { model: null }`). The entry must be invalidated
    // so the in-flight old-model connect can't install against a now-modelless agent. (Deleting the model
    // nulls agent.model via the FK but emits no agent update, so it does not reach this path.)
    await (service as any).handleAgentUpdated('agent-1', { model: null }, { id: 'agent-1', model: null })
    expect(service.inspect('session-1')).toBeUndefined()
    expect(mocks.pauseRuntimeTurn).not.toHaveBeenCalled()

    // The stale connect resolves after the invalidation: it must close the connection it opened and
    // resolve false (not install), leaving no entry behind.
    pendingConnect.resolve(connection)
    await expect(connecting).resolves.toBe(false)
    await vi.waitFor(() => expect(connection.close).toHaveBeenCalledOnce())
    expect(getEntry(service)).toBeUndefined()
    expect(connect).toHaveBeenCalledTimes(1)
  })

  it('pauses a live turn and tears the session down when the agent model is cleared', async () => {
    const connection = {
      events: createAsyncQueue<any>().iterable,
      send: vi.fn(),
      close: vi.fn(),
      reconcile: vi.fn().mockResolvedValue('current')
    }
    const connect = vi.fn().mockResolvedValue(connection)
    runtimeDriverRegistry.register({
      type: 'test-runtime',
      capabilities: ['agent-session'],
      connect,
      validateSession: vi.fn(),
      listAvailableTools: vi.fn().mockResolvedValue([])
    })
    const service = new AgentSessionRuntimeService()
    const handle = service.beginTurn({ ...baseTurnInput, userMessage: userMessage('user-1') })
    const stream = service.openTurnStream({
      sessionId: 'session-1',
      turnId: handle.turnId,
      signal: new AbortController().signal
    })
    const reader = stream.getReader()
    await expect(reader.read()).resolves.toMatchObject({ value: { type: 'start' }, done: false })
    await vi.waitFor(() =>
      expect(connection.send).toHaveBeenCalledWith({ message: userMessage('user-1'), systemReminder: false })
    )
    const turn = getEntry(service).currentTurn

    // An agent update clears the model mid-turn (explicit `PATCH { model: null }`). The live turn is
    // paused (the renderer learns it stopped) and the session is fully torn down. (Deleting the model
    // nulls agent.model via the FK but emits no agent update, so it does not reach this path.)
    await (service as any).handleAgentUpdated('agent-1', { model: null }, { id: 'agent-1', model: null })

    expect(mocks.pauseRuntimeTurn).toHaveBeenCalledWith('agent-session:session-1', 'agent-model-cleared')
    expect(turn.terminalStatus).toBe('paused')
    await vi.waitFor(() => expect(connection.close).toHaveBeenCalledOnce())
    expect(service.inspect('session-1')).toBeUndefined()
    expect(connect).toHaveBeenCalledTimes(1)
    await reader.cancel().catch(() => undefined)
  })

  it('keeps the live connection across a steer roll when the agent model changes mid-roll', async () => {
    const service = new AgentSessionRuntimeService()
    service.beginTurn({ ...baseTurnInput, userMessage: userMessage('user-1') })
    const entry = getEntry(service)
    const connection = { close: vi.fn(), send: vi.fn(), events: [], reconcile: vi.fn().mockResolvedValue('current') }
    entry.connection = connection

    // Steer roll in flight: A1a was finalised at a steer-boundary (currentTurn is terminal) but `rolling`
    // stays true while the same SDK query keeps streaming the post-steer response into A2. A model edit
    // landing in that gap must NOT close the live connection — that would drop the continuation.
    entry.currentTurn.terminalStatus = 'success'
    entry.rolling = true

    await (service as any).handleAgentUpdated(
      'agent-1',
      { model: switchedModelId },
      { id: 'agent-1', model: switchedModelId }
    )

    expect(connection.close).not.toHaveBeenCalled()
    expect(getEntry(service).connection).toBe(connection)
    // The new model is still recorded; the next fresh turn reconnects to it via ensureConnection.
    expect(getEntry(service).modelId).toBe(switchedModelId)
  })

  it('does not retarget/close the live connection when ensureConnection re-enters mid-roll after a model edit', async () => {
    const reconnected = {
      events: createAsyncQueue<any>().iterable,
      send: vi.fn(),
      close: vi.fn(),
      reconcile: vi.fn().mockResolvedValue('current')
    }
    const connect = vi.fn().mockResolvedValue(reconnected)
    runtimeDriverRegistry.register({
      type: 'test-runtime',
      capabilities: ['agent-session'],
      connect,
      validateSession: vi.fn(),
      listAvailableTools: vi.fn().mockResolvedValue([])
    })
    const service = new AgentSessionRuntimeService()
    service.beginTurn({ ...baseTurnInput, userMessage: userMessage('user-1') })
    const entry = getEntry(service)
    const connection = { close: vi.fn(), send: vi.fn(), events: [], reconcile: vi.fn().mockResolvedValue('current') }
    entry.connection = connection

    // Steer roll in flight: A1a finalised at the boundary (currentTurn terminal), `rolling` still true,
    // and the model edit has already advanced entry.modelId (applyAgentModelUpdate kept the connection
    // because rolling counts as live). A re-prime (e.g. a second window) now re-enters ensureConnection.
    entry.currentTurn.terminalStatus = 'success'
    entry.rolling = true
    entry.modelId = switchedModelId

    const connected = await (service as any).ensureConnection(entry)

    // The connection target is pinned to the rolling turn's captured model, so ensureConnection keeps the
    // still-streaming connection instead of closing it and reconnecting on the edited model (dropping A2).
    expect(connected).toBe(true)
    expect(connect).not.toHaveBeenCalled()
    expect(connection.close).not.toHaveBeenCalled()
    expect(getEntry(service).connection).toBe(connection)
  })

  it('reconciles the connection on any agent update without closing a current one', async () => {
    const service = new AgentSessionRuntimeService()
    service.beginTurn(baseTurnInput)
    const entry = getEntry(service)
    const connection = {
      close: vi.fn(),
      send: vi.fn(),
      events: [],
      reconcile: vi.fn().mockResolvedValue('patched')
    }
    entry.connection = connection

    await (service as any).handleAgentUpdated('agent-1', { disabledTools: ['Bash'] }, { id: 'agent-1' })

    // The host carries no per-field knowledge — the connection re-derives the desired config itself
    // (which is also what makes wholesale `configuration` replaces resync a cleared permission_mode:
    // the derive reads the post-update agent row, not the DTO's key presence).
    expect(connection.reconcile).toHaveBeenCalledWith({ modelId: baseTurnInput.modelId })
    expect(connection.close).not.toHaveBeenCalled()
  })

  it('pushes a reconcile for configuration-only updates', async () => {
    const service = new AgentSessionRuntimeService()
    service.beginTurn(baseTurnInput)
    const entry = getEntry(service)
    const connection = {
      close: vi.fn(),
      send: vi.fn(),
      events: [],
      reconcile: vi.fn().mockResolvedValue('current')
    }
    entry.connection = connection

    await (service as any).handleAgentUpdated(
      'agent-1',
      { configuration: { permission_mode: 'plan' } },
      { id: 'agent-1', configuration: { permission_mode: 'plan' } }
    )

    expect(connection.reconcile).toHaveBeenCalledOnce()
    expect(connection.close).not.toHaveBeenCalled()
  })

  it('queues follow-ups instead of redirecting them into a stale-model live connection', async () => {
    const service = new AgentSessionRuntimeService()
    service.beginTurn(baseTurnInput)
    const entry = getEntry(service)
    const connection = {
      close: vi.fn(),
      send: vi.fn(),
      events: [],
      redirect: vi.fn().mockReturnValue(true)
    }
    entry.connection = connection

    await (service as any).handleAgentUpdated(
      'agent-1',
      { model: switchedModelId },
      { id: 'agent-1', model: switchedModelId }
    )
    service.enqueueUserMessage('session-1', userMessage('user-2'))

    expect(connection.redirect).not.toHaveBeenCalled()
    expect(entry.pendingTurns).toEqual([userMessage('user-2')])
    expect(entry.steerMessageIds?.has('user-2')).toBe(true)
  })

  it('fails closed and logs when a push reconcile throws', async () => {
    const service = new AgentSessionRuntimeService()
    service.beginTurn(baseTurnInput)
    const failure = new Error('policy update failed')
    const entry = getEntry(service)
    const connection = {
      close: vi.fn(),
      send: vi.fn(),
      events: [],
      reconcile: vi.fn().mockRejectedValue(failure)
    }
    entry.connection = connection

    await (service as any).handleAgentUpdated('agent-1', { disabledTools: ['Bash'] }, { id: 'agent-1' })

    expect(mockMainLoggerService.error).toHaveBeenCalledWith('Connection reconcile threw; failing closed', {
      sessionId: 'session-1',
      error: failure
    })
    expect(connection.close).toHaveBeenCalledOnce()
    expect(service.inspect('session-1')).toMatchObject({ sessionId: 'session-1', status: 'active' })
    expect(getEntry(service).connection).toBeUndefined()
  })

  it('pauses the active stream and preserves queued turns when a live reconcile fails', async () => {
    const events = createAsyncQueue<any>()
    const connection = {
      events: events.iterable,
      send: vi.fn(),
      close: vi.fn(),
      // 'failed' = a live patch (e.g. a permission tighten) could not be applied — the connection
      // may still be enforcing the OLD, looser policy and must not keep streaming.
      reconcile: vi.fn().mockResolvedValue('failed')
    }
    runtimeDriverRegistry.register({
      type: 'test-runtime',
      capabilities: ['agent-session'],
      connect: vi.fn().mockResolvedValue(connection),
      validateSession: vi.fn(),
      listAvailableTools: vi.fn().mockResolvedValue([])
    })
    const service = new AgentSessionRuntimeService()
    const handle = service.beginTurn({ ...baseTurnInput, userMessage: userMessage('user-1') })
    const stream = service.openTurnStream({
      sessionId: 'session-1',
      turnId: handle.turnId,
      signal: new AbortController().signal
    })
    const reader = stream.getReader()

    await expect(reader.read()).resolves.toMatchObject({ value: { type: 'start' }, done: false })
    await vi.waitFor(() =>
      expect(connection.send).toHaveBeenCalledWith(
        expect.objectContaining({ message: userMessage('user-1'), systemReminder: false })
      )
    )
    getEntry(service).pendingTurns.push(userMessage('user-2'))

    await (service as any).handleAgentUpdated('agent-1', { disabledTools: ['Bash'] }, { id: 'agent-1' })

    expect(mocks.pauseRuntimeTurn).toHaveBeenCalledWith('agent-session:session-1', 'agent-policy-update-failed')
    expect(connection.close).toHaveBeenCalledOnce()
    expect(service.inspect('session-1')).toMatchObject({
      sessionId: 'session-1',
      status: 'active',
      pendingMessageCount: 1
    })
    expect(getEntry(service).connection).toBeUndefined()

    await reader.cancel().catch(() => undefined)
  })

  it('does not close a replacement runtime when an old reconcile settles late', async () => {
    const service = new AgentSessionRuntimeService()
    service.beginTurn(baseTurnInput)
    const deferred = createDeferred<string>()
    const oldEntry = getEntry(service)
    const oldConnection = {
      close: vi.fn(),
      send: vi.fn(),
      events: [],
      reconcile: vi.fn(() => deferred.promise)
    }
    oldEntry.connection = oldConnection

    const updatePromise = (service as any).handleAgentUpdated('agent-1', { disabledTools: ['Bash'] }, { id: 'agent-1' })
    expect(oldConnection.reconcile).toHaveBeenCalledOnce()

    service.closeSession('session-1')
    service.beginTurn(baseTurnInput)
    const newConnection = {
      close: vi.fn(),
      send: vi.fn(),
      events: [],
      reconcile: vi.fn().mockResolvedValue('current')
    }
    getEntry(service).connection = newConnection

    deferred.reject(new Error('late reconcile failure'))
    await updatePromise

    // closeSession already closed the old connection; the late failure must not double-close it or
    // touch the successor entry's connection.
    expect(oldConnection.close).toHaveBeenCalledOnce()
    expect(newConnection.close).not.toHaveBeenCalled()
    expect(service.inspect('session-1')).toMatchObject({ sessionId: 'session-1', status: 'active' })
  })

  it('rebuilds an idle connection eagerly when reconcile reports rebuild', async () => {
    const service = new AgentSessionRuntimeService()
    service.beginTurn(baseTurnInput)
    const entry = getEntry(service)
    service.markTurnTerminal('session-1', 'success')
    const connection = {
      close: vi.fn(),
      send: vi.fn(),
      events: [],
      reconcile: vi.fn().mockResolvedValue('rebuild')
    }
    entry.connection = connection

    await (service as any).handleAgentUpdated('agent-1', { instructions: 'be terse' }, { id: 'agent-1' })

    // Nothing is streaming — release the stale subprocess now instead of waiting for the next turn.
    expect(connection.close).toHaveBeenCalledOnce()
    expect(service.inspect('session-1')).toMatchObject({ sessionId: 'session-1' })
    expect(getEntry(service).connection).toBeUndefined()
  })

  it('defers the rebuild while a turn is live and leaves the connection streaming', async () => {
    const service = new AgentSessionRuntimeService()
    service.beginTurn(baseTurnInput)
    const entry = getEntry(service)
    const connection = {
      close: vi.fn(),
      send: vi.fn(),
      events: [],
      reconcile: vi.fn().mockResolvedValue('rebuild')
    }
    entry.connection = connection

    await (service as any).handleAgentUpdated('agent-1', { instructions: 'be terse' }, { id: 'agent-1' })

    // Live patches were already applied inside reconcile (live-first); the spawn-frozen part waits
    // for the next fresh turn's pull instead of dropping the in-flight stream.
    expect(connection.close).not.toHaveBeenCalled()
    expect(getEntry(service).connection).toBe(connection)
  })

  describe('connection reconcile — pull path (fresh-turn staleness check)', () => {
    it('rebuilds a stale warm connection before the next turn — no event required', async () => {
      const firstConnection = {
        events: createAsyncQueue<any>().iterable,
        send: vi.fn(),
        close: vi.fn(),
        // Any spawn-frozen input changed since this connection was built (workspace, skills,
        // sub-models, MCP definitions, …) — including changes that never emit an agent event.
        reconcile: vi.fn().mockResolvedValue('rebuild')
      }
      const secondConnection = {
        events: createAsyncQueue<any>().iterable,
        send: vi.fn(),
        close: vi.fn(),
        reconcile: vi.fn().mockResolvedValue('current')
      }
      // The stale connection is hand-injected as the warm one; a reconnect builds the second.
      const connect = vi.fn().mockResolvedValue(secondConnection)
      runtimeDriverRegistry.register({
        type: 'test-runtime',
        capabilities: ['agent-session'],
        connect,
        validateSession: vi.fn(),
        listAvailableTools: vi.fn().mockResolvedValue([])
      })
      const service = new AgentSessionRuntimeService()
      service.beginTurn({ ...baseTurnInput, userMessage: userMessage('user-1') })
      const entry = getEntry(service)
      entry.connection = firstConnection
      service.markTurnTerminal('session-1', 'success')

      const handle = service.beginTurn({ ...baseTurnInput, userMessage: userMessage('user-2') })
      const stream = service.openTurnStream({
        sessionId: 'session-1',
        turnId: handle.turnId,
        signal: new AbortController().signal
      })
      const reader = stream.getReader()
      await expect(reader.read()).resolves.toMatchObject({ value: { type: 'start' }, done: false })

      await vi.waitFor(() =>
        expect(secondConnection.send).toHaveBeenCalledWith(expect.objectContaining({ message: userMessage('user-2') }))
      )
      expect(firstConnection.reconcile).toHaveBeenCalledWith({ modelId: baseTurnInput.modelId })
      expect(firstConnection.close).toHaveBeenCalledOnce()
      expect(connect).toHaveBeenCalledTimes(1)

      await reader.cancel().catch(() => undefined)
    })

    it('never reconciles under an admitted streaming turn', async () => {
      const service = new AgentSessionRuntimeService()
      service.beginTurn({ ...baseTurnInput, userMessage: userMessage('user-1') })
      const entry = getEntry(service)
      const connection = {
        close: vi.fn(),
        send: vi.fn(),
        events: [],
        reconcile: vi.fn().mockResolvedValue('rebuild')
      }
      entry.connection = connection
      entry.currentTurn.admitted = true

      // The steer-roll continuation (A2) is pre-admitted and `flushRollBuffer` clears `rolling`
      // before ensureConnection runs, so this admitted-turn guard is the ONLY thing keeping the
      // still-streaming SDK query alive — closing here would drop the stream mid-flight.
      await expect((service as any).ensureConnection(entry)).resolves.toBe(true)

      expect(connection.reconcile).not.toHaveBeenCalled()
      expect(connection.close).not.toHaveBeenCalled()
    })

    it('does not close a replacement connection when a slow reconcile resolves after a racing rebuild (TOCTOU)', async () => {
      const service = new AgentSessionRuntimeService()
      service.beginTurn({ ...baseTurnInput, userMessage: userMessage('user-1') })
      const entry = getEntry(service)
      const deferred = createDeferred<string>()
      const staleConnection = {
        close: vi.fn(),
        send: vi.fn(),
        events: [],
        reconcile: vi.fn(() => deferred.promise)
      }
      const replacement = {
        close: vi.fn(),
        send: vi.fn(),
        events: [],
        reconcile: vi.fn().mockResolvedValue('current')
      }
      entry.connection = staleConnection

      const ensuring = (service as any).ensureConnection(entry)
      await vi.waitFor(() => expect(staleConnection.reconcile).toHaveBeenCalledOnce())

      // While the check awaited, a racing caller replaced the connection and its turn was admitted.
      entry.connection = replacement
      entry.currentTurn.admitted = true
      deferred.resolve('rebuild')

      await expect(ensuring).resolves.toBe(true)
      // The stale verdict must not close the successor carrying a live stream.
      expect(replacement.close).not.toHaveBeenCalled()
      expect(replacement.reconcile).not.toHaveBeenCalled()
    })

    it('closes the session when reconcile reports the config is no longer derivable', async () => {
      const service = new AgentSessionRuntimeService()
      service.beginTurn({ ...baseTurnInput, userMessage: userMessage('user-1') })
      const entry = getEntry(service)
      const connection = {
        close: vi.fn(),
        send: vi.fn(),
        events: [],
        reconcile: vi.fn().mockResolvedValue('invalid')
      }
      entry.connection = connection

      await expect((service as any).ensureConnection(entry)).resolves.toBe(false)

      expect(connection.close).toHaveBeenCalledOnce()
      expect(service.inspect('session-1')).toBeUndefined()
    })
  })

  it('ignores per-execution terminal events until the topic is done', () => {
    const service = new AgentSessionRuntimeService()
    const handle = service.beginTurn(baseTurnInput)

    void terminalListener(handle).onPaused({ status: 'paused', isTopicDone: false })

    expect(service.inspect('session-1')).toMatchObject({
      status: 'active',
      lastTerminalStatus: undefined
    })
  })

  it('clears the runtime and closes the connection on closeSession', () => {
    const service = new AgentSessionRuntimeService()
    service.beginTurn(baseTurnInput)
    const connection = { close: vi.fn(), send: vi.fn(), events: [], reconcile: vi.fn().mockResolvedValue('current') }
    const entry = getEntry(service)
    entry.connection = connection
    entry.connectionLoop = Promise.resolve()
    entry.startingNextTurn = true

    service.closeSession('session-1')

    expect(connection.close).toHaveBeenCalled()
    expect(entry.connection).toBeUndefined()
    expect(entry.connectionLoop).toBeUndefined()
    expect(entry.currentTurn).toBeUndefined()
    expect(entry.startingNextTurn).toBe(false)
    expect(service.inspect('session-1')).toBeUndefined()
  })

  it('does not throw and logs a warning when the connection close rejects on closeSession (REGRESSION agent-session-5)', async () => {
    const service = new AgentSessionRuntimeService()
    service.beginTurn(baseTurnInput)
    const closeError = new Error('close failed')
    const connection = { close: vi.fn().mockRejectedValue(closeError), send: vi.fn(), events: [] }
    const entry = getEntry(service)
    entry.connection = connection
    entry.connectionLoop = Promise.resolve()

    expect(() => service.closeSession('session-1')).not.toThrow()

    expect(connection.close).toHaveBeenCalled()
    expect(service.inspect('session-1')).toBeUndefined()
    await vi.waitFor(() =>
      expect(mockMainLoggerService.warn).toHaveBeenCalledWith(
        'Agent runtime connection close failed',
        expect.objectContaining({ sessionId: 'session-1', error: closeError })
      )
    )
  })

  it('persists assistant turns with the latest resume token', async () => {
    const service = new AgentSessionRuntimeService()
    const handle = service.beginTurn({ ...baseTurnInput, userMessage: userMessage('user-1') })
    getEntry(service).lastResumeToken = 'resume-1'

    await persistenceListener(handle).onDone({
      status: 'success',
      isTopicDone: true,
      finalMessage: { id: 'assistant-1', role: 'assistant', parts: [{ type: 'text', text: 'hi' }] }
    })

    expect(mocks.saveMessage).toHaveBeenCalledWith({
      sessionId: 'session-1',
      runtimeResumeToken: 'resume-1',
      message: {
        id: 'assistant-1',
        role: 'assistant',
        status: 'success',
        data: { parts: [{ type: 'text', text: 'hi' }] },
        modelId: 'claude-code::claude-sonnet-4-5'
      }
    })
    expect(mocks.maybeRenameAgentSession).toHaveBeenCalledWith('agent-1', 'session-1', 'hello', {
      id: 'assistant-1',
      role: 'assistant',
      parts: [{ type: 'text', text: 'hi' }]
    })
  })

  it('persists empty paused terminals to the active assistant placeholder', async () => {
    const service = new AgentSessionRuntimeService()
    const handle = service.beginTurn({ ...baseTurnInput, userMessage: userMessage('user-1') })
    getEntry(service).lastResumeToken = 'resume-1'

    await persistenceListener(handle).onPaused({
      status: 'paused',
      isTopicDone: true,
      finalMessage: undefined
    })

    expect(mocks.saveMessage).toHaveBeenCalledWith({
      sessionId: 'session-1',
      runtimeResumeToken: 'resume-1',
      message: {
        id: 'assistant-1',
        role: 'assistant',
        status: 'paused',
        data: { parts: [] },
        modelId: 'claude-code::claude-sonnet-4-5'
      }
    })
  })

  it('routes runtime events from the selected driver into the active turn', async () => {
    const events = createAsyncQueue<any>()
    const connection = {
      events: events.iterable,
      send: vi.fn(),
      interrupt: vi.fn(),
      close: vi.fn()
    }
    const connect = vi.fn().mockResolvedValue(connection)
    runtimeDriverRegistry.register({
      type: 'test-runtime',
      capabilities: ['agent-session'],
      connect,
      validateSession: vi.fn(),
      listAvailableTools: vi.fn().mockResolvedValue([])
    })
    const service = new AgentSessionRuntimeService()
    const handle = service.beginTurn({ ...baseTurnInput, userMessage: userMessage('user-1') })
    const stream = service.openTurnStream({
      sessionId: 'session-1',
      turnId: handle.turnId,
      signal: new AbortController().signal
    })
    const reader = stream.getReader()

    await expect(reader.read()).resolves.toMatchObject({ value: { type: 'start' }, done: false })
    await vi.waitFor(() =>
      expect(connection.send).toHaveBeenCalledWith({ message: userMessage('user-1'), systemReminder: false })
    )

    events.push({ type: 'resume-token', token: 'resume-1' })
    await vi.waitFor(() => expect(service.inspect('session-1')).toMatchObject({ resumeToken: 'resume-1' }))

    events.push({ type: 'chunk', chunk: { type: 'text-delta', id: 'text-1', delta: 'hello' } })
    await expect(reader.read()).resolves.toMatchObject({
      value: { type: 'text-delta', id: 'text-1', delta: 'hello' },
      done: false
    })

    events.push({ type: 'turn-complete' })
    await expect(reader.read()).resolves.toMatchObject({ done: true })
  })

  it('publishes runtime context usage through persist cache', async () => {
    const events = createAsyncQueue<any>()
    const usage = {
      categories: [],
      totalTokens: 42,
      maxTokens: 100,
      rawMaxTokens: 100,
      percentage: 42,
      gridRows: [],
      model: 'claude-sonnet-4-5',
      memoryFiles: [],
      mcpTools: [],
      agents: [],
      isAutoCompactEnabled: false,
      apiUsage: null
    }
    const connection = {
      events: events.iterable,
      send: vi.fn(),
      close: vi.fn(),
      getContextUsage: vi.fn().mockResolvedValue(usage)
    }
    const connect = vi.fn().mockResolvedValue(connection)
    runtimeDriverRegistry.register({
      type: 'test-runtime',
      capabilities: ['agent-session'],
      connect,
      validateSession: vi.fn(),
      listAvailableTools: vi.fn().mockResolvedValue([])
    })
    const service = new AgentSessionRuntimeService()
    const handle = service.beginTurn({ ...baseTurnInput, userMessage: userMessage('user-1') })
    const stream = service.openTurnStream({
      sessionId: 'session-1',
      turnId: handle.turnId,
      signal: new AbortController().signal
    })
    const reader = stream.getReader()

    await expect(reader.read()).resolves.toMatchObject({ value: { type: 'start' }, done: false })

    await vi.waitFor(() =>
      expect(mocks.cacheSetShared).toHaveBeenCalledWith('agent.session.context_usage.session-1', usage)
    )

    events.push({ type: 'turn-complete' })
    await expect(reader.read()).resolves.toMatchObject({ done: true })
    await vi.waitFor(() => expect(connection.getContextUsage).toHaveBeenCalledTimes(2))
  })

  describe('primeConnection — eager command load on session open', () => {
    it('opens the connection without a turn and caches the slash-command catalog', async () => {
      const commands = [{ name: 'clear', description: 'Clear conversation' }]
      const connection = {
        events: createAsyncQueue<any>().iterable,
        send: vi.fn(),
        close: vi.fn(),
        reconcile: vi.fn().mockResolvedValue('current'),
        getSupportedCommands: vi.fn().mockResolvedValue(commands)
      }
      const connect = vi.fn().mockResolvedValue(connection)
      runtimeDriverRegistry.register({
        type: 'test-runtime',
        capabilities: ['agent-session'],
        connect,
        validateSession: vi.fn(),
        listAvailableTools: vi.fn().mockResolvedValue([])
      })
      mocks.getSessionById.mockReturnValue({ id: 'session-1', agentId: 'agent-1' })
      mocks.getAgent.mockReturnValue({ id: 'agent-1', type: 'test-runtime', model: baseTurnInput.modelId })

      const service = new AgentSessionRuntimeService()
      await service.primeConnection('session-1')

      expect(connect).toHaveBeenCalledTimes(1)
      // The primed connection carries the session's trace context (resolved via ensureTraceId) so its
      // subprocess spans join the session trace tree — not a trace-less connection reused by turn 1.
      expect(connect).toHaveBeenCalledWith(
        expect.objectContaining({ trace: expect.objectContaining({ traceId: 'b'.repeat(32) }) })
      )
      await vi.waitFor(() =>
        expect(mocks.cacheSetShared).toHaveBeenCalledWith('agent.session.slash_commands.session-1', commands)
      )
      // No turn was admitted — the entry sits idle and the stream manager was never asked to start one.
      expect(service.inspect('session-1')?.status).toBe('idle')
      expect(mocks.startRuntimeTurn).not.toHaveBeenCalled()
    })

    it('is a no-op for a session whose agent was deleted', async () => {
      mocks.getSessionById.mockReturnValue({ id: 'session-1', agentId: null })
      const service = new AgentSessionRuntimeService()
      await service.primeConnection('session-1')
      expect(service.inspect('session-1')).toBeUndefined()
    })

    it('re-priming a live session republishes the catalog without rebuilding the connection', async () => {
      const commands = [{ name: 'clear', description: 'Clear conversation' }]
      const connection = {
        events: createAsyncQueue<any>().iterable,
        send: vi.fn(),
        close: vi.fn(),
        reconcile: vi.fn().mockResolvedValue('current'),
        getSupportedCommands: vi.fn().mockResolvedValue(commands)
      }
      const connect = vi.fn().mockResolvedValue(connection)
      runtimeDriverRegistry.register({
        type: 'test-runtime',
        capabilities: ['agent-session'],
        connect,
        validateSession: vi.fn(),
        listAvailableTools: vi.fn().mockResolvedValue([])
      })
      mocks.getSessionById.mockReturnValue({ id: 'session-1', agentId: 'agent-1' })
      mocks.getAgent.mockReturnValue({ id: 'agent-1', type: 'test-runtime', model: baseTurnInput.modelId })

      const service = new AgentSessionRuntimeService()
      await service.primeConnection('session-1')
      await vi.waitFor(() =>
        expect(mocks.cacheSetShared).toHaveBeenCalledWith('agent.session.slash_commands.session-1', commands)
      )

      mocks.cacheSetShared.mockClear()
      connection.getSupportedCommands.mockClear()

      // Second prime hits the existing-entry branch — it must re-read and republish (so a window
      // mounting late still gets the catalog), not early-return on the live connection.
      await service.primeConnection('session-1')
      await vi.waitFor(() => {
        expect(connection.getSupportedCommands).toHaveBeenCalled()
        expect(mocks.cacheSetShared).toHaveBeenCalledWith('agent.session.slash_commands.session-1', commands)
      })
      // The existing connection is reused — no second connect.
      expect(connect).toHaveBeenCalledTimes(1)
    })

    it('replaces the cached catalog when the runtime pushes a commands_changed event', () => {
      const service = new AgentSessionRuntimeService()
      service.beginTurn(baseTurnInput)
      const updated = [
        { name: 'clear', description: 'Clear conversation' },
        { name: 'deploy', description: 'Custom project command discovered mid-session' }
      ]

      ;(service as any).handleRuntimeEvent(getEntry(service), { type: 'supported-commands', commands: updated })

      expect(mocks.cacheSetShared).toHaveBeenCalledWith('agent.session.slash_commands.session-1', updated)
    })

    it('releaseIdleConnection closes an idle session but leaves a busy one running', () => {
      const service = new AgentSessionRuntimeService()
      service.beginTurn(baseTurnInput)

      // Mid-turn: a backgrounded stream must keep running, so release is a no-op.
      service.releaseIdleConnection('session-1')
      expect(service.inspect('session-1')).toBeDefined()

      // Turn settled → idle: leaving the view tears the connection down now, not at the idle TTL.
      service.markTurnTerminal('session-1', 'success')
      service.releaseIdleConnection('session-1')
      expect(service.inspect('session-1')).toBeUndefined()
    })
  })

  it('publishes compaction state through shared cache and treats compaction as busy', () => {
    const service = new AgentSessionRuntimeService()
    service.beginTurn(baseTurnInput)
    service.markTurnTerminal('session-1', 'success')
    expect(service.isSessionBusy('session-1')).toBe(false)

    ;(service as any).handleRuntimeEvent(getEntry(service), { type: 'compaction-start' })

    expect(service.isSessionBusy('session-1')).toBe(true)
    expect(mocks.cacheSetShared).toHaveBeenCalledWith('agent.session.compaction.session-1', {
      status: 'compacting',
      startedAt: expect.any(String)
    })
  })

  it('a no-anchor compaction success (no boundary) settles status to idle and is no longer busy (B2)', () => {
    const service = new AgentSessionRuntimeService()
    service.beginTurn(baseTurnInput)
    service.markTurnTerminal('session-1', 'success')

    ;(service as any).handleRuntimeEvent(getEntry(service), { type: 'compaction-start' })
    expect(service.isSessionBusy('session-1')).toBe(true)
    mocks.cacheSetShared.mockClear()

    // The driver maps a `compact_result: 'success'` status with NO `compact_boundary` to a no-anchor
    // `compaction-complete` (the SDK does not guarantee a boundary). It must flip status to idle —
    // never write empty token fields or reset a timestamp — and clear the compacting state so the
    // session is no longer stuck busy until the idle TTL.
    ;(service as any).handleRuntimeEvent(getEntry(service), { type: 'compaction-complete' })

    expect(mocks.cacheSetShared).toHaveBeenLastCalledWith('agent.session.compaction.session-1', {
      status: 'idle'
    })
    expect(service.isSessionBusy('session-1')).toBe(false)
  })

  it('settles compaction when the runtime connection errors', () => {
    const service = new AgentSessionRuntimeService()
    service.beginTurn(baseTurnInput)
    service.markTurnTerminal('session-1', 'success')

    ;(service as any).handleRuntimeEvent(getEntry(service), { type: 'compaction-start' })
    expect(service.isSessionBusy('session-1')).toBe(true)

    ;(service as any).handleRuntimeEvent(getEntry(service), { type: 'error', error: new Error('runtime closed') })

    expect(service.isSessionBusy('session-1')).toBe(false)
    expect(mocks.cacheSetShared).toHaveBeenLastCalledWith('agent.session.compaction.session-1', {
      status: 'idle'
    })
  })

  it('swallows a getContextUsage rejection during refresh and logs a warning (S5)', async () => {
    const service = new AgentSessionRuntimeService()
    service.beginTurn(baseTurnInput)
    const entry = getEntry(service)
    const usageError = new Error('usage boom')
    entry.connection = {
      getContextUsage: vi.fn().mockRejectedValue(usageError),
      send: vi.fn(),
      close: vi.fn(),
      events: []
    } as any

    expect(() => (service as any).refreshContextUsage(entry)).not.toThrow()

    await vi.waitFor(() =>
      expect(mockMainLoggerService.warn).toHaveBeenCalledWith(
        'Failed to refresh agent session context usage',
        expect.objectContaining({ sessionId: 'session-1', error: usageError })
      )
    )
  })

  it('warns for an abort but errors for a real failure when the runtime ends with no active turn (S5)', () => {
    const service = new AgentSessionRuntimeService()
    service.beginTurn(baseTurnInput)
    service.markTurnTerminal('session-1', 'success') // no live (non-terminal) turn remains
    const entry = getEntry(service)

    const abort = Object.assign(new Error('aborted'), { name: 'AbortError' })
    ;(service as any).handleRuntimeError(entry, abort)
    expect(mockMainLoggerService.warn).toHaveBeenCalledWith(
      'Agent runtime connection ended without an active turn',
      expect.objectContaining({ sessionId: 'session-1', error: abort })
    )

    const boom = new Error('real failure')
    ;(service as any).handleRuntimeError(entry, boom)
    expect(mockMainLoggerService.error).toHaveBeenCalledWith(
      'Agent runtime connection ended without an active turn',
      expect.objectContaining({ sessionId: 'session-1', error: boom })
    )
  })

  it('persists context usage events from the runtime', () => {
    const usage = {
      categories: [],
      totalTokens: 64,
      maxTokens: 100,
      rawMaxTokens: 100,
      percentage: 64,
      gridRows: [],
      model: 'claude-sonnet-4-5',
      memoryFiles: [],
      mcpTools: [],
      agents: [],
      isAutoCompactEnabled: true,
      apiUsage: null
    }
    const service = new AgentSessionRuntimeService()
    service.beginTurn(baseTurnInput)

    ;(service as any).handleRuntimeEvent(getEntry(service), { type: 'context-usage', usage })

    expect(mocks.cacheSetShared).toHaveBeenCalledWith('agent.session.context_usage.session-1', usage)
  })

  it('clears session-scoped shared cache entries when closing a session', () => {
    const service = new AgentSessionRuntimeService()
    service.beginTurn(baseTurnInput)

    ;(service as any).handleRuntimeEvent(getEntry(service), { type: 'compaction-start' })
    ;(service as any).handleRuntimeEvent(getEntry(service), {
      type: 'context-usage',
      usage: {
        categories: [],
        totalTokens: 1,
        maxTokens: 100,
        rawMaxTokens: 100,
        percentage: 1,
        gridRows: [],
        model: 'claude-sonnet-4-5',
        memoryFiles: [],
        mcpTools: [],
        agents: [],
        apiUsage: null
      }
    })

    service.closeSession('session-1')

    // The context-usage entry is deleted outright; an in-flight compaction is settled to idle
    // (not deleted) so a re-open doesn't briefly observe a stale compacting status.
    expect(mocks.cacheDeleteShared).toHaveBeenCalledWith('agent.session.context_usage.session-1')
    expect(mocks.cacheSetShared).toHaveBeenLastCalledWith('agent.session.compaction.session-1', {
      status: 'idle'
    })
  })

  it('enqueues a compaction anchor into the current turn and refreshes context usage on completion', async () => {
    const events = createAsyncQueue<any>()
    const usage = {
      categories: [],
      totalTokens: 24,
      maxTokens: 100,
      rawMaxTokens: 100,
      percentage: 24,
      gridRows: [],
      model: 'claude-sonnet-4-5',
      memoryFiles: [],
      mcpTools: [],
      agents: [],
      isAutoCompactEnabled: true,
      apiUsage: null
    }
    const connection = {
      events: events.iterable,
      send: vi.fn(),
      close: vi.fn(),
      getContextUsage: vi.fn().mockResolvedValue(usage)
    }
    runtimeDriverRegistry.register({
      type: 'test-runtime',
      capabilities: ['agent-session'],
      connect: vi.fn().mockResolvedValue(connection),
      validateSession: vi.fn(),
      listAvailableTools: vi.fn().mockResolvedValue([])
    })
    const service = new AgentSessionRuntimeService()
    const handle = service.beginTurn({ ...baseTurnInput, userMessage: userMessage('user-1') })
    const stream = service.openTurnStream({
      sessionId: 'session-1',
      turnId: handle.turnId,
      signal: new AbortController().signal
    })
    const reader = stream.getReader()

    await expect(reader.read()).resolves.toMatchObject({ value: { type: 'start' }, done: false })
    await vi.waitFor(() =>
      expect(connection.send).toHaveBeenCalledWith({ message: userMessage('user-1'), systemReminder: false })
    )
    mocks.cacheSetShared.mockClear()
    connection.getContextUsage.mockClear()

    events.push({
      type: 'compaction-complete',
      anchor: {
        trigger: 'auto',
        completedAt: '2026-06-09T12:00:00.000Z',
        preTokens: 52_000,
        postTokens: 14_000,
        durationMs: 1234
      }
    })

    await expect(reader.read()).resolves.toMatchObject({
      value: {
        type: 'data-compaction-anchor',
        data: {
          trigger: 'auto',
          completedAt: '2026-06-09T12:00:00.000Z',
          preTokens: 52_000,
          postTokens: 14_000,
          durationMs: 1234
        }
      },
      done: false
    })
    expect(mocks.cacheSetShared).toHaveBeenCalledWith('agent.session.compaction.session-1', {
      status: 'idle'
    })
    await vi.waitFor(() =>
      expect(mocks.cacheSetShared).toHaveBeenCalledWith('agent.session.context_usage.session-1', usage)
    )

    events.push({ type: 'turn-complete' })
    await expect(reader.read()).resolves.toMatchObject({ done: true })
  })

  it('surfaces a runtime error event via controller.error and drops trailing chunks (REGRESSION agent-session-3)', async () => {
    const events = createAsyncQueue<any>()
    const connection = {
      events: events.iterable,
      send: vi.fn(),
      interrupt: vi.fn(),
      close: vi.fn()
    }
    const connect = vi.fn().mockResolvedValue(connection)
    runtimeDriverRegistry.register({
      type: 'test-runtime',
      capabilities: ['agent-session'],
      connect,
      validateSession: vi.fn(),
      listAvailableTools: vi.fn().mockResolvedValue([])
    })
    const service = new AgentSessionRuntimeService()
    const handle = service.beginTurn({ ...baseTurnInput, userMessage: userMessage('user-1') })
    const stream = service.openTurnStream({
      sessionId: 'session-1',
      turnId: handle.turnId,
      signal: new AbortController().signal
    })
    const reader = stream.getReader()

    await expect(reader.read()).resolves.toMatchObject({ value: { type: 'start' }, done: false })
    await vi.waitFor(() => expect(connection.send).toHaveBeenCalled())

    // A runtime `error` event surfaces through the active turn's controller.
    events.push({ type: 'error', error: new Error('runtime boom') })
    await expect(reader.read()).rejects.toThrow('runtime boom')

    // The turn is marked terminal synchronously, so a trailing chunk in the same connection
    // loop is dropped instead of being enqueued on the now-errored controller (which would throw).
    await vi.waitFor(() => expect(getEntry(service).currentTurn?.terminalStatus).toBe('error'))
    events.push({ type: 'chunk', chunk: { type: 'text-delta', id: 't', delta: 'late' } })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(getEntry(service).currentTurn?.terminalStatus).toBe('error')
  })

  it('passes trace context to the runtime driver and keeps the connection warm across turns', async () => {
    const events = createAsyncQueue<any>()
    const connection = {
      events: events.iterable,
      send: vi.fn(),
      close: vi.fn()
    }
    const connect = vi.fn().mockResolvedValue(connection)
    runtimeDriverRegistry.register({
      type: 'test-runtime',
      capabilities: ['agent-session'],
      connect,
      validateSession: vi.fn(),
      listAvailableTools: vi.fn().mockResolvedValue([])
    })
    const service = new AgentSessionRuntimeService()
    const handle = service.beginTurn({
      ...baseTurnInput,
      userMessage: userMessage('user-1'),
      traceId: 'a'.repeat(32)
    })
    const stream = service.openTurnStream({
      sessionId: 'session-1',
      turnId: handle.turnId,
      signal: new AbortController().signal
    })
    const reader = stream.getReader()

    await expect(reader.read()).resolves.toMatchObject({ value: { type: 'start' }, done: false })
    await vi.waitFor(() =>
      expect(connect).toHaveBeenCalledWith({
        sessionId: 'session-1',
        agentId: 'agent-1',
        modelId: 'claude-code::claude-sonnet-4-5',
        resumeToken: undefined,
        trace: {
          topicId: 'agent-session:session-1',
          traceId: 'a'.repeat(32),
          rootSpanId: 'a'.repeat(16),
          sessionId: 'session-1',
          turnId: handle.turnId,
          modelName: 'claude-sonnet-4-5'
        }
      })
    )

    void terminalListener(handle).onDone({ status: 'success', isTopicDone: true })

    // Warm: a turn ending does NOT tear the connection down — only closeSession / idle TTL does.
    expect(connection.close).not.toHaveBeenCalled()
    expect(getEntry(service).connection).toBe(connection)
    service.closeSession('session-1')
    await reader.cancel().catch(() => undefined)
  })

  it('hydrates the persisted resume token before connecting a cold historical session', async () => {
    mocks.getLastRuntimeResumeToken.mockReturnValue('resume-db')
    const events = createAsyncQueue<any>()
    const connection = {
      events: events.iterable,
      send: vi.fn(),
      close: vi.fn()
    }
    const connect = vi.fn().mockResolvedValue(connection)
    runtimeDriverRegistry.register({
      type: 'test-runtime',
      capabilities: ['agent-session'],
      connect,
      validateSession: vi.fn(),
      listAvailableTools: vi.fn().mockResolvedValue([])
    })
    const service = new AgentSessionRuntimeService()
    const handle = service.beginTurn({ ...baseTurnInput, userMessage: userMessage('user-1') })
    const stream = service.openTurnStream({
      sessionId: 'session-1',
      turnId: handle.turnId,
      signal: new AbortController().signal
    })
    const reader = stream.getReader()

    await expect(reader.read()).resolves.toMatchObject({ value: { type: 'start' }, done: false })
    await vi.waitFor(() =>
      expect(connect).toHaveBeenCalledWith({
        sessionId: 'session-1',
        agentId: 'agent-1',
        modelId: 'claude-code::claude-sonnet-4-5',
        resumeToken: 'resume-db',
        trace: {
          topicId: 'agent-session:session-1',
          traceId: 'a'.repeat(32),
          rootSpanId: 'a'.repeat(16),
          sessionId: 'session-1',
          turnId: handle.turnId,
          modelName: 'claude-sonnet-4-5'
        }
      })
    )

    expect(mocks.getLastRuntimeResumeToken).toHaveBeenCalledWith('session-1')
    expect(service.inspect('session-1')).toMatchObject({ resumeToken: 'resume-db' })
    service.closeSession('session-1')
    await reader.cancel().catch(() => undefined)
  })

  it('closes the runtime session when the active turn is aborted by the user', async () => {
    const events = createAsyncQueue<any>()
    const connection = {
      events: events.iterable,
      send: vi.fn(),
      close: vi.fn()
    }
    runtimeDriverRegistry.register({
      type: 'test-runtime',
      capabilities: ['agent-session'],
      connect: vi.fn().mockResolvedValue(connection),
      validateSession: vi.fn(),
      listAvailableTools: vi.fn().mockResolvedValue([])
    })
    const service = new AgentSessionRuntimeService()
    const handle = service.beginTurn({ ...baseTurnInput, userMessage: userMessage('user-1') })
    const controller = new AbortController()
    const stream = service.openTurnStream({
      sessionId: 'session-1',
      turnId: handle.turnId,
      signal: controller.signal
    })
    const reader = stream.getReader()

    await expect(reader.read()).resolves.toMatchObject({ value: { type: 'start' }, done: false })
    await vi.waitFor(() =>
      expect(connection.send).toHaveBeenCalledWith({ message: userMessage('user-1'), systemReminder: false })
    )

    controller.abort('user-requested')

    await vi.waitFor(() => expect(connection.close).toHaveBeenCalledOnce())
    expect(service.inspect('session-1')).toBeUndefined()
    await reader.cancel().catch(() => undefined)
  })

  it('closes a late runtime connection when the user aborts before connect resolves', async () => {
    const events = createAsyncQueue<any>()
    const connection = {
      events: events.iterable,
      send: vi.fn(),
      close: vi.fn()
    }
    const pendingConnection = createDeferred<typeof connection>()
    const connect = vi.fn().mockReturnValue(pendingConnection.promise)
    runtimeDriverRegistry.register({
      type: 'test-runtime',
      capabilities: ['agent-session'],
      connect,
      validateSession: vi.fn(),
      listAvailableTools: vi.fn().mockResolvedValue([])
    })
    const service = new AgentSessionRuntimeService()
    const handle = service.beginTurn({ ...baseTurnInput, userMessage: userMessage('user-1') })
    const controller = new AbortController()
    const stream = service.openTurnStream({
      sessionId: 'session-1',
      turnId: handle.turnId,
      signal: controller.signal
    })
    const reader = stream.getReader()

    await expect(reader.read()).resolves.toMatchObject({ value: { type: 'start' }, done: false })
    await vi.waitFor(() => expect(connect).toHaveBeenCalledOnce())

    controller.abort('user-requested')
    expect(service.inspect('session-1')).toBeUndefined()

    pendingConnection.resolve(connection)

    await vi.waitFor(() => expect(connection.close).toHaveBeenCalledOnce())
    expect(connection.send).not.toHaveBeenCalled()
    await reader.cancel().catch(() => undefined)
  })

  describe('steer soft-queue — live follow-up (pure streaming-input, no interrupt)', () => {
    it('does not interrupt a live turn; soft-queues the steer and pushes it into the SAME warm connection on the next turn', async () => {
      const events = createAsyncQueue<any>()
      const connection = {
        events: events.iterable,
        send: vi.fn(),
        close: vi.fn(),
        reconcile: vi.fn().mockResolvedValue('current')
      }
      const connect = vi.fn().mockResolvedValue(connection)
      runtimeDriverRegistry.register({
        type: 'test-runtime',
        capabilities: ['agent-session'],
        connect,
        validateSession: vi.fn(),
        listAvailableTools: vi.fn().mockResolvedValue([])
      })
      const service = new AgentSessionRuntimeService()
      const handle = service.beginTurn({ ...baseTurnInput, userMessage: userMessage('user-1') })
      const stream = service.openTurnStream({
        sessionId: 'session-1',
        turnId: handle.turnId,
        signal: new AbortController().signal
      })
      const reader = stream.getReader()

      await expect(reader.read()).resolves.toMatchObject({ value: { type: 'start' }, done: false })
      await vi.waitFor(() =>
        expect(connection.send).toHaveBeenCalledWith({ message: userMessage('user-1'), systemReminder: false })
      )

      // A tool is in flight, then a steer arrives. It must NOT interrupt — just soft-queue.
      events.push({ type: 'chunk', chunk: { type: 'tool-input-start', toolCallId: 'tool-1' } })
      await vi.waitFor(() => expect(getEntry(service).currentTurn.activeToolIds.has('tool-1')).toBe(true))
      service.enqueueUserMessage('session-1', userMessage('user-2'))
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(mocks.pauseRuntimeTurn).not.toHaveBeenCalled()
      expect(getEntry(service).pendingTurns).toHaveLength(1)

      // The current turn completes naturally → the steer drains into the SAME warm connection,
      // wrapped in a system-reminder. No reconnect: connect once, close never.
      void terminalListener(handle).onDone({ status: 'success', isTopicDone: true })
      await vi.waitFor(() => expect(getEntry(service).currentTurn?.userMessage.id).toBe('user-2'))
      const nextTurnId = getEntry(service).currentTurn.turnId
      const stream2 = service.openTurnStream({
        sessionId: 'session-1',
        turnId: nextTurnId,
        signal: new AbortController().signal
      })
      const reader2 = stream2.getReader()
      await reader2.read()

      await vi.waitFor(() =>
        expect(connection.send).toHaveBeenCalledWith({ message: userMessage('user-2'), systemReminder: true })
      )
      expect(connect).toHaveBeenCalledOnce()
      expect(connection.close).not.toHaveBeenCalled()

      service.closeSession('session-1')
      await reader.cancel().catch(() => undefined)
      await reader2.cancel().catch(() => undefined)
    })
  })

  describe('steer redirect — real mid-turn injection (claude PreToolUse hook)', () => {
    it('folds a live steer into the current turn via connection.redirect (not queued, no new turn)', async () => {
      const events = createAsyncQueue<any>()
      const redirect = vi.fn().mockReturnValue(true)
      const connection = { events: events.iterable, send: vi.fn(), redirect, close: vi.fn() }
      runtimeDriverRegistry.register({
        type: 'test-runtime',
        capabilities: ['agent-session'],
        connect: vi.fn().mockResolvedValue(connection),
        validateSession: vi.fn(),
        listAvailableTools: vi.fn().mockResolvedValue([])
      })
      const service = new AgentSessionRuntimeService()
      const handle = service.beginTurn({ ...baseTurnInput, userMessage: userMessage('user-1') })
      const stream = service.openTurnStream({
        sessionId: 'session-1',
        turnId: handle.turnId,
        signal: new AbortController().signal
      })
      const reader = stream.getReader()
      await expect(reader.read()).resolves.toMatchObject({ value: { type: 'start' }, done: false })
      await vi.waitFor(() =>
        expect(connection.send).toHaveBeenCalledWith({ message: userMessage('user-1'), systemReminder: false })
      )

      // Steer on a live turn → redirect injects it into the running turn: not queued, no new turn.
      service.enqueueUserMessage('session-1', userMessage('user-2'))
      expect(redirect).toHaveBeenCalledWith({ message: userMessage('user-2'), systemReminder: true })
      expect(getEntry(service).pendingTurns).toHaveLength(0)
      expect(getEntry(service).steerMessageIds?.has('user-2') ?? false).toBe(false)

      service.closeSession('session-1')
      await reader.cancel().catch(() => undefined)
    })

    it('queues a steer the turn ended before injecting (steer-undelivered → next turn, system-reminder)', async () => {
      const events = createAsyncQueue<any>()
      const redirect = vi.fn().mockReturnValue(true)
      const connection = { events: events.iterable, send: vi.fn(), redirect, close: vi.fn() }
      runtimeDriverRegistry.register({
        type: 'test-runtime',
        capabilities: ['agent-session'],
        connect: vi.fn().mockResolvedValue(connection),
        validateSession: vi.fn(),
        listAvailableTools: vi.fn().mockResolvedValue([])
      })
      const service = new AgentSessionRuntimeService()
      const handle = service.beginTurn({ ...baseTurnInput, userMessage: userMessage('user-1') })
      const stream = service.openTurnStream({
        sessionId: 'session-1',
        turnId: handle.turnId,
        signal: new AbortController().signal
      })
      const reader = stream.getReader()
      await expect(reader.read()).resolves.toMatchObject({ value: { type: 'start' }, done: false })
      await vi.waitFor(() => expect(connection.send).toHaveBeenCalledOnce())

      // Steer redirected (stashed), but the turn calls no tool → the connection hands it back.
      service.enqueueUserMessage('session-1', userMessage('user-2'))
      expect(getEntry(service).pendingTurns).toHaveLength(0)

      events.push({ type: 'steer-undelivered', inputs: [{ message: userMessage('user-2'), systemReminder: true }] })
      await vi.waitFor(() => expect(getEntry(service).pendingTurns).toHaveLength(1))
      // The undelivered steer is flagged so its next turn wraps it in a system-reminder.
      expect(getEntry(service).steerMessageIds?.has('user-2')).toBe(true)

      service.closeSession('session-1')
      await reader.cancel().catch(() => undefined)
    })

    it('rolls the turn at a steer-boundary: finalises A1a, opens A2 without re-sending, replays buffered chunks', async () => {
      const events = createAsyncQueue<any>()
      const connection = {
        events: events.iterable,
        send: vi.fn(),
        redirect: vi.fn().mockReturnValue(true),
        close: vi.fn()
      }
      runtimeDriverRegistry.register({
        type: 'test-runtime',
        capabilities: ['agent-session'],
        connect: vi.fn().mockResolvedValue(connection),
        validateSession: vi.fn(),
        listAvailableTools: vi.fn().mockResolvedValue([])
      })
      const service = new AgentSessionRuntimeService()
      const handle = service.beginTurn({ ...baseTurnInput, userMessage: userMessage('user-1') })
      const stream = service.openTurnStream({
        sessionId: 'session-1',
        turnId: handle.turnId,
        signal: new AbortController().signal
      })
      const reader = stream.getReader()
      await expect(reader.read()).resolves.toMatchObject({ value: { type: 'start' }, done: false })
      await vi.waitFor(() => expect(connection.send).toHaveBeenCalledOnce())

      // Pre-steer chunk → routed to A1a (the original turn's stream).
      events.push({ type: 'chunk', chunk: { type: 'text-delta', id: 'p1', delta: 'pre' } })
      await expect(reader.read()).resolves.toMatchObject({ value: { type: 'text-delta', delta: 'pre' }, done: false })

      // The driver signals the post-steer assistant message → roll: A1a closes, the topic stays busy.
      events.push({ type: 'steer-boundary', inputs: [{ message: userMessage('user-2'), systemReminder: true }] })
      await vi.waitFor(() => expect(getEntry(service).rolling).toBe(true))
      await expect(reader.read()).resolves.toMatchObject({ done: true })
      expect(getEntry(service).currentTurn.terminalStatus).toBe('success')

      // Post-steer chunk arrives before A2's stream is open → buffered, not dropped.
      events.push({ type: 'chunk', chunk: { type: 'text-delta', id: 'p2', delta: 'post' } })
      await vi.waitFor(() => expect(getEntry(service).rollBuffer).toHaveLength(1))

      // A1a's execution settles (terminal listener) → the continuation A2 opens. `isTopicDone=false`
      // (the stream-manager keeps the topic alive across the boundary), and onDone always advances.
      void terminalListener(handle).onDone({ status: 'success', isTopicDone: false })
      await vi.waitFor(() => expect(getEntry(service).currentTurn.userMessage.id).toBe('user-2'))
      const a2 = getEntry(service).currentTurn
      expect(a2.turnId).not.toBe(handle.turnId)
      expect(a2.admitted).toBe(true) // continuation: the steer was already injected via the hook — never re-sent
      expect(connection.send).toHaveBeenCalledOnce() // user-1 only; A2 sends nothing to the connection
      expect(mocks.saveMessage).toHaveBeenLastCalledWith({
        sessionId: 'session-1',
        message: { role: 'assistant', status: 'pending', data: { parts: [] }, modelId: baseTurnInput.modelId }
      })
      expect(mocks.startRuntimeTurn).toHaveBeenCalledTimes(1)

      // Opening A2's stream replays the buffered post-steer chunk in order, then routes live chunks.
      const reader2 = service
        .openTurnStream({ sessionId: 'session-1', turnId: a2.turnId, signal: new AbortController().signal })
        .getReader()
      await expect(reader2.read()).resolves.toMatchObject({ value: { type: 'start' }, done: false })
      await expect(reader2.read()).resolves.toMatchObject({ value: { type: 'text-delta', delta: 'post' }, done: false })
      expect(getEntry(service).rolling).toBe(false)

      events.push({ type: 'chunk', chunk: { type: 'text-delta', id: 'p3', delta: 'live' } })
      await expect(reader2.read()).resolves.toMatchObject({ value: { type: 'text-delta', delta: 'live' }, done: false })

      service.closeSession('session-1')
      await reader.cancel().catch(() => undefined)
      await reader2.cancel().catch(() => undefined)
    })
  })

  it('admits a steer-flagged turn with a system-reminder and consumes the flag (invariant 7)', async () => {
    const events = createAsyncQueue<any>()
    const connection = { events: events.iterable, send: vi.fn(), close: vi.fn() }
    runtimeDriverRegistry.register({
      type: 'test-runtime',
      capabilities: ['agent-session'],
      connect: vi.fn().mockResolvedValue(connection),
      validateSession: vi.fn(),
      listAvailableTools: vi.fn().mockResolvedValue([])
    })
    const service = new AgentSessionRuntimeService()
    const handle = service.beginTurn({ ...baseTurnInput, userMessage: userMessage('user-1') })
    // Mark this turn's message as a steer, as `enqueueUserMessage` does for a mid-turn arrival.
    getEntry(service).steerMessageIds = new Set(['user-1'])
    const stream = service.openTurnStream({
      sessionId: 'session-1',
      turnId: handle.turnId,
      signal: new AbortController().signal
    })
    const reader = stream.getReader()

    await expect(reader.read()).resolves.toMatchObject({ value: { type: 'start' }, done: false })
    await vi.waitFor(() =>
      expect(connection.send).toHaveBeenCalledWith({ message: userMessage('user-1'), systemReminder: true })
    )
    // The flag is consumed as the turn is admitted.
    expect(getEntry(service).steerMessageIds.has('user-1')).toBe(false)
    service.closeSession('session-1')
  })

  it('flags a mid-turn follow-up as a steer (system-reminder) while a turn is live', async () => {
    const events = createAsyncQueue<any>()
    const connection = { events: events.iterable, send: vi.fn(), interrupt: vi.fn(), close: vi.fn() }
    runtimeDriverRegistry.register({
      type: 'test-runtime',
      capabilities: ['agent-session'],
      connect: vi.fn().mockResolvedValue(connection),
      validateSession: vi.fn(),
      listAvailableTools: vi.fn().mockResolvedValue([])
    })
    const service = new AgentSessionRuntimeService()
    const handle = service.beginTurn({ ...baseTurnInput, userMessage: userMessage('user-1') })
    const stream = service.openTurnStream({
      sessionId: 'session-1',
      turnId: handle.turnId,
      signal: new AbortController().signal
    })
    const reader = stream.getReader()
    await expect(reader.read()).resolves.toMatchObject({ value: { type: 'start' }, done: false })
    await vi.waitFor(() => expect(connection.send).toHaveBeenCalled())

    // Arrives while the first turn is live → flagged as a steer.
    service.enqueueUserMessage('session-1', userMessage('user-2'))
    expect(getEntry(service).steerMessageIds?.has('user-2')).toBe(true)
    service.closeSession('session-1')
    await reader.cancel().catch(() => undefined)
  })

  it('tears the session down on any turn abort (steer no longer interrupts — abort is always a user Stop)', async () => {
    const events = createAsyncQueue<any>()
    const connection = {
      events: events.iterable,
      send: vi.fn(),
      close: vi.fn()
    }
    runtimeDriverRegistry.register({
      type: 'test-runtime',
      capabilities: ['agent-session'],
      connect: vi.fn().mockResolvedValue(connection),
      validateSession: vi.fn(),
      listAvailableTools: vi.fn().mockResolvedValue([])
    })
    const service = new AgentSessionRuntimeService()
    const handle = service.beginTurn({ ...baseTurnInput, userMessage: userMessage('user-1') })
    const controller = new AbortController()
    const stream = service.openTurnStream({
      sessionId: 'session-1',
      turnId: handle.turnId,
      signal: controller.signal
    })
    const reader = stream.getReader()

    await expect(reader.read()).resolves.toMatchObject({ value: { type: 'start' }, done: false })
    await vi.waitFor(() =>
      expect(connection.send).toHaveBeenCalledWith({ message: userMessage('user-1'), systemReminder: false })
    )

    // Steer no longer interrupts, so the only abort source is a user Stop — which always tears the
    // session down (closeSession → connection.close), regardless of the signal reason.
    controller.abort('agent-runtime-interrupt')

    await vi.waitFor(() => expect(connection.close).toHaveBeenCalledOnce())
    expect(service.inspect('session-1')).toBeUndefined()
    await reader.cancel().catch(() => undefined)
  })

  it('persists errored assistant turns with the latest resume token', async () => {
    const service = new AgentSessionRuntimeService()
    const handle = service.beginTurn({ ...baseTurnInput, userMessage: userMessage('user-1') })
    getEntry(service).lastResumeToken = 'resume-init'

    await persistenceListener(handle).onError({
      status: 'error',
      isTopicDone: true,
      error: { name: 'Error', message: 'boom' },
      finalMessage: { id: 'assistant-1', role: 'assistant', parts: [] }
    })

    expect(mocks.saveMessage).toHaveBeenCalledWith({
      sessionId: 'session-1',
      runtimeResumeToken: 'resume-init',
      message: {
        id: 'assistant-1',
        role: 'assistant',
        status: 'error',
        data: { parts: [{ type: 'data-error', data: { name: 'Error', message: 'boom' } }] },
        modelId: 'claude-code::claude-sonnet-4-5'
      }
    })
  })

  it('persists an active turn with the model captured when that turn began', async () => {
    const service = new AgentSessionRuntimeService()
    const handle = service.beginTurn({ ...baseTurnInput, userMessage: userMessage('user-1') })

    await (service as any).handleAgentUpdated(
      'agent-1',
      { model: switchedModelId },
      { id: 'agent-1', model: switchedModelId }
    )

    await persistenceListener(handle).onDone({
      status: 'success',
      isTopicDone: true,
      finalMessage: { id: 'assistant-1', role: 'assistant', parts: [] }
    })

    expect(mocks.saveMessage).toHaveBeenCalledWith({
      sessionId: 'session-1',
      message: {
        id: 'assistant-1',
        role: 'assistant',
        status: 'success',
        data: { parts: [] },
        modelId: 'claude-code::claude-sonnet-4-5'
      }
    })
  })

  it('starts queued turns with runtime request metadata and assistant seed', async () => {
    const service = new AgentSessionRuntimeService()
    service.beginTurn(baseTurnInput)
    const entry = getEntry(service)
    entry.lastResumeToken = 'resume-1'
    entry.currentTurn.activeToolIds.add('tool-1')
    entry.pendingTurns.push(userMessage('user-2'))

    await (service as any).startNextTurn(entry)

    expect(mocks.saveMessage).toHaveBeenCalledWith({
      sessionId: 'session-1',
      message: {
        role: 'assistant',
        status: 'pending',
        data: { parts: [] },
        modelId: 'claude-code::claude-sonnet-4-5'
      }
    })
    expect(mocks.startRuntimeTurn).toHaveBeenCalledWith({
      topicId: 'agent-session:session-1',
      modelId: 'claude-code::claude-sonnet-4-5',
      rootSpan: expect.anything(),
      request: {
        chatId: 'agent-session:session-1',
        trigger: 'submit-message',
        messageId: 'generated-message-id',
        messages: [
          { id: 'user-2', role: 'user', parts: [{ type: 'text', text: 'hello' }] },
          { id: 'generated-message-id', role: 'assistant', parts: [] }
        ],
        runtime: { kind: 'agent-session', sessionId: 'session-1', turnId: expect.any(String) }
      },
      abortController: expect.any(AbortController),
      listeners: [
        expect.objectContaining({ id: expect.stringContaining('persistence:agents-db:') }),
        expect.objectContaining({ id: 'agent-runtime:session-1' }),
        expect.objectContaining({ id: 'persistence:trace:agent-session:session-1' })
      ]
    })
    const request = mocks.startRuntimeTurn.mock.calls[0][0].request
    expect(request.messageId).toBe(request.messages[1].id)
    // The session trace id is cached on the entry and reused for every turn (container-scoped trace).
    expect(getEntry(service).sessionTraceId).toBe('a'.repeat(32))
  })

  it('starts queued turns with the latest agent model after a model edit', async () => {
    const service = new AgentSessionRuntimeService()
    service.beginTurn(baseTurnInput)
    const entry = getEntry(service)
    entry.pendingTurns.push(userMessage('user-2'))

    await (service as any).handleAgentUpdated(
      'agent-1',
      { model: switchedModelId },
      { id: 'agent-1', model: switchedModelId }
    )
    await (service as any).startNextTurn(entry)

    expect(mocks.saveMessage).toHaveBeenCalledWith({
      sessionId: 'session-1',
      message: {
        role: 'assistant',
        status: 'pending',
        data: { parts: [] },
        modelId: switchedModelId
      }
    })
    expect(mocks.startRuntimeTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        modelId: switchedModelId
      })
    )
  })

  it('reconciles a queued follow-up snapshot to the model that runs after a mid-queue model edit', async () => {
    const service = new AgentSessionRuntimeService()
    // Submit-time snapshot: author + the model as it was when the follow-up was queued.
    const followUpSnapshot = {
      id: 'agent-1',
      name: 'My Agent',
      emoji: '🤖',
      model: { id: 'claude-sonnet-4-5', name: 'Claude Sonnet', provider: 'claude-code' }
    } as any

    service.beginTurn(baseTurnInput)
    service.enqueueUserMessage('session-1', userMessage('user-2'), { messageSnapshot: followUpSnapshot })

    // User switches the agent model before the queued follow-up drains — the runtime runs the LATEST model.
    await (service as any).handleAgentUpdated(
      'agent-1',
      { model: switchedModelId },
      { id: 'agent-1', model: switchedModelId, modelName: 'Claude Opus' }
    )
    mocks.getAgent.mockReturnValue({
      id: 'agent-1',
      type: 'test-runtime',
      model: switchedModelId,
      modelName: 'Claude Opus'
    })

    service.markTurnTerminal('session-1', 'success')
    await new Promise((resolve) => setTimeout(resolve, 0))

    const assistantSave = mocks.saveMessage.mock.calls
      .map((call) => call[0].message)
      .filter((m: any) => m.role === 'assistant')
      .at(-1)

    // Row modelId, the started runtime model, and the snapshot's nested model all agree on the new model;
    // the frozen author (name/emoji) is preserved.
    expect(assistantSave?.modelId).toBe(switchedModelId)
    expect(assistantSave?.messageSnapshot).toEqual({
      id: 'agent-1',
      name: 'My Agent',
      emoji: '🤖',
      model: { id: 'claude-opus-4-5', name: 'Claude Opus', provider: 'claude-code' }
    })
    expect(mocks.startRuntimeTurn).toHaveBeenCalledWith(expect.objectContaining({ modelId: switchedModelId }))
  })

  it('does not drain a queued turn onto a stale deleted model; surfaces an error and settles', async () => {
    const service = new AgentSessionRuntimeService()
    service.beginTurn(baseTurnInput)
    const entry = getEntry(service)
    entry.pendingTurns.push(userMessage('user-2'))

    // The model was deleted while user-2 sat queued: its `user_model` row is gone and `agent.model` is
    // FK-nulled, but no agent update fires — the entry still caches the deleted model. The drain must
    // re-read the live model and bail, not stamp/start a turn with the stale deleted `entry.modelId`.
    mocks.getAgent.mockReturnValue({ id: 'agent-1', model: null })
    mocks.saveMessage.mockClear()
    mocks.startRuntimeTurn.mockClear()

    await (service as any).startNextTurn(entry)

    // No assistant turn is saved or started on the stale model, the renderer learns the queued
    // follow-up can't run, and the queue is drained (its user rows stay resendable).
    expect(mocks.saveMessage).not.toHaveBeenCalled()
    expect(mocks.startRuntimeTurn).not.toHaveBeenCalled()
    // The prior turn kept this topic's stream alive for the continuation (willContinueTopic), skipping
    // its terminal lifecycle — so the held stream must be terminalized/evicted, not merely error-broadcast
    // (a bare broadcast would leave its status cache stuck `streaming` and the stream re-attachable).
    expect(mocks.terminateHeldTopicStream).toHaveBeenCalledWith(
      'agent-session:session-1',
      baseTurnInput.modelId,
      expect.anything()
    )
    expect(mocks.broadcastTopicError).not.toHaveBeenCalled()
    expect(getEntry(service).pendingTurns).toEqual([])
  })

  it('surfaces the error and settles the turn when the next-turn placeholder save rejects (R3)', async () => {
    const service = new AgentSessionRuntimeService()
    service.beginTurn(baseTurnInput)
    const entry = getEntry(service)
    const queued = userMessage('user-2')
    entry.pendingTurns.push(queued)

    const saveError = new Error('db down')
    mocks.saveMessage.mockImplementationOnce(() => {
      throw saveError
    })

    // The placeholder save failed: re-queuing would just fail again and the idle TTL would
    // silently clear it, so the message is dropped, the failure is surfaced to the live renderer,
    // and the turn is settled to `error` (not left silently idle).
    await expect((service as any).startNextTurn(entry)).resolves.toBeUndefined()

    expect(entry.pendingTurns).toEqual([])
    expect(mocks.startRuntimeTurn).not.toHaveBeenCalled()
    expect(mocks.broadcastTopicError).toHaveBeenCalledWith(
      entry.topicId,
      entry.modelId,
      expect.objectContaining({ message: expect.stringContaining('db down') })
    )
    expect(entry.status).toBe('idle')
    expect(entry.lastTerminalStatus).toBe('error')
  })

  it('abandons the roll and surfaces the error when the continuation placeholder save rejects (S5)', async () => {
    const service = new AgentSessionRuntimeService()
    service.beginTurn(baseTurnInput)
    const entry = getEntry(service)
    // Drive the entry into a roll mid-turn: A1a closed at a steer boundary, post-steer chunks buffered,
    // and the continuation (A2) is about to open. This is the state `startContinuationTurn` runs against.
    entry.rolling = true
    entry.rollBuffer = [{ type: 'text-delta', id: 'p2', delta: 'post' } as any]
    entry.rollSteerInputs = [{ message: userMessage('user-2'), systemReminder: true }] as any

    const saveError = new Error('db down')
    mocks.saveMessage.mockImplementationOnce(() => {
      throw saveError
    })

    // The A2 placeholder save failed: abandon the roll (drop the buffered post-steer chunks), surface
    // the failure to the live renderer, and settle the turn to `error` instead of idling on a doomed roll.
    await expect((service as any).startContinuationTurn(entry)).resolves.toBeUndefined()

    expect(mocks.startRuntimeTurn).not.toHaveBeenCalled()
    expect(entry.rolling).toBe(false)
    expect(entry.rollBuffer).toBeUndefined()
    expect(mocks.broadcastTopicError).toHaveBeenCalledWith(
      entry.topicId,
      entry.modelId,
      expect.objectContaining({ message: expect.stringContaining('db down') })
    )
    expect(entry.status).toBe('idle')
    expect(entry.lastTerminalStatus).toBe('error')
  })
})
