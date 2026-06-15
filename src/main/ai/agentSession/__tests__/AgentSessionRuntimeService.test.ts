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
  cacheSetShared: vi.fn(),
  cacheDeleteShared: vi.fn(),
  cacheMergePersist: vi.fn(),
  traceStorageSetTopicId: vi.fn()
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

vi.mock('@main/core/application', () => ({
  application: { get: mocks.applicationGet }
}))

const { AgentSessionRuntimeService } = await import('../AgentSessionRuntimeService')
const { runtimeDriverRegistry } = await import('../../runtime')
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
    mocks.saveMessage.mockImplementation(async ({ message }) => ({
      ...message,
      id: message.id ?? 'generated-message-id'
    }))
    mocks.getLastRuntimeResumeToken.mockResolvedValue(null)
    mocks.findPendingAssistantMessageIds.mockResolvedValue([])
    mocks.markMessagesError.mockResolvedValue(undefined)
    mocks.applicationGet.mockImplementation((name: string) => {
      if (name === 'AiStreamManager') {
        return {
          startRuntimeTurn: mocks.startRuntimeTurn,
          pauseRuntimeTurn: mocks.pauseRuntimeTurn,
          broadcastTopicError: mocks.broadcastTopicError
        }
      }
      if (name === 'CacheService') {
        return {
          mergePersist: mocks.cacheMergePersist,
          setShared: mocks.cacheSetShared,
          deleteShared: mocks.cacheDeleteShared
        }
      }
      if (name === 'TraceStorageService') return { setTopicId: mocks.traceStorageSetTopicId }
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

      // Hold the drain's assistant-placeholder save so we can observe the in-flight window.
      const deferred = createDeferred<any>()
      mocks.saveMessage.mockImplementationOnce(() => deferred.promise)

      service.markTurnTerminal('session-1', 'success') // current turn → terminal, schedules the drain
      await new Promise((resolve) => setTimeout(resolve, 0)) // flush microtasks → drain parks on saveMessage

      const entry = getEntry(service)
      // The bug window: the queued message was shifted (pendingTurns empty) and the old turn is
      // terminal — pre-fix nothing reported the session busy here.
      expect(entry.pendingTurns.length).toBe(0)
      expect(entry.currentTurn.terminalStatus).toBe('success')
      expect(entry.startingNextTurn).toBe(true) // flag now spans the whole drain
      expect(service.isSessionBusy('session-1')).toBe(true)

      deferred.resolve({ id: 'assistant-2' })
      await new Promise((resolve) => setTimeout(resolve, 0)) // drain completes → fresh live turn
      expect(service.isSessionBusy('session-1')).toBe(true)
      expect(getEntry(service).startingNextTurn).toBe(false)
    })

    it('does not resurrect a session torn down during the next-turn placeholder save (REGRESSION agent-session-1)', async () => {
      const service = new AgentSessionRuntimeService()
      service.beginTurn(baseTurnInput)
      service.enqueueUserMessage('session-1', userMessage('user-2'))

      // Hold the drain's placeholder save so we can tear the session down mid-await.
      const deferred = createDeferred<any>()
      mocks.saveMessage.mockImplementationOnce(() => deferred.promise)

      service.markTurnTerminal('session-1', 'success') // schedules the drain → parks on saveMessage
      await new Promise((resolve) => setTimeout(resolve, 0))

      const startCallsBefore = mocks.startRuntimeTurn.mock.calls.length

      // Session is torn down (shutdown / a fresh beginTurn) while the save is still in flight.
      service.closeSession('session-1')

      deferred.resolve({ id: 'assistant-2' })
      await new Promise((resolve) => setTimeout(resolve, 0))

      // The dead entry must NOT be resurrected into a runtime turn.
      expect(mocks.startRuntimeTurn.mock.calls.length).toBe(startCallsBefore)
      expect(getEntry(service)).toBeUndefined()
    })
  })

  describe('reconcileStalePendingMessages — boot crash recovery', () => {
    it('marks crash-orphaned pending assistant messages as errored on init', async () => {
      mocks.findPendingAssistantMessageIds.mockResolvedValue(['stale-1', 'stale-2'])
      const service = new AgentSessionRuntimeService()

      await (service as any).onInit()

      expect(mocks.findPendingAssistantMessageIds).toHaveBeenCalledOnce()
      expect(mocks.markMessagesError).toHaveBeenCalledWith(['stale-1', 'stale-2'])
    })

    it('does not mark anything when there are no stale messages', async () => {
      mocks.findPendingAssistantMessageIds.mockResolvedValue([])
      const service = new AgentSessionRuntimeService()

      await (service as any).onInit()

      expect(mocks.markMessagesError).not.toHaveBeenCalled()
    })

    it('logs and does not rethrow when the reconcile lookup throws, so boot is not blocked', async () => {
      const failure = new Error('db down')
      mocks.findPendingAssistantMessageIds.mockRejectedValue(failure)
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
    const connection = { close: vi.fn(), send: vi.fn(), events: [] }
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

  it('applies tool-policy updates when disabled tools change', async () => {
    const service = new AgentSessionRuntimeService()
    service.beginTurn(baseTurnInput)
    const entry = getEntry(service)
    const connection = {
      close: vi.fn(),
      send: vi.fn(),
      events: [],
      applyPolicyUpdate: vi.fn()
    }
    entry.connection = connection
    const agent = { id: 'agent-1' }

    await (service as any).handleAgentUpdated('agent-1', { disabledTools: ['Bash'] }, agent)

    expect(connection.applyPolicyUpdate).toHaveBeenCalledWith({ type: 'tool-policy', agent })
    expect(connection.close).not.toHaveBeenCalled()
  })

  it('applies permission-mode updates when configuration replacement drops the key', async () => {
    const service = new AgentSessionRuntimeService()
    service.beginTurn(baseTurnInput)
    const entry = getEntry(service)
    const connection = {
      close: vi.fn(),
      send: vi.fn(),
      events: [],
      applyPolicyUpdate: vi.fn()
    }
    entry.connection = connection

    await (service as any).handleAgentUpdated('agent-1', { configuration: {} }, { id: 'agent-1', configuration: {} })

    expect(connection.applyPolicyUpdate).toHaveBeenCalledWith({
      type: 'permission-mode',
      permissionMode: undefined
    })
    expect(connection.close).not.toHaveBeenCalled()
  })

  it('detaches and logs when a live policy update rejects without an open stream', async () => {
    const service = new AgentSessionRuntimeService()
    service.beginTurn(baseTurnInput)
    const failure = new Error('policy update failed')
    const entry = getEntry(service)
    const connection = {
      close: vi.fn(),
      send: vi.fn(),
      events: [],
      applyPolicyUpdate: vi.fn().mockRejectedValue(failure)
    }
    entry.connection = connection

    await (service as any).handleAgentUpdated('agent-1', { disabledTools: ['Bash'] }, { id: 'agent-1' })

    expect(mockMainLoggerService.error).toHaveBeenCalledWith(
      'Failed to apply live agent policy update; closing runtime connection',
      {
        agentId: 'agent-1',
        sessionId: 'session-1',
        error: failure
      }
    )
    expect(connection.close).toHaveBeenCalledOnce()
    expect(service.inspect('session-1')).toMatchObject({ sessionId: 'session-1', status: 'active' })
    expect(getEntry(service).connection).toBeUndefined()
  })

  it('pauses the active stream and preserves queued turns when a live policy update rejects', async () => {
    const events = createAsyncQueue<any>()
    const failure = new Error('policy update failed')
    const connection = {
      events: events.iterable,
      send: vi.fn(),
      close: vi.fn(),
      applyPolicyUpdate: vi.fn().mockRejectedValue(failure)
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
      pendingMessageCount: 1,
      interruptRequested: true
    })
    expect(getEntry(service).connection).toBeUndefined()

    await reader.cancel().catch(() => undefined)
  })

  it('does not close a replacement runtime when an old policy update rejects late', async () => {
    const service = new AgentSessionRuntimeService()
    service.beginTurn(baseTurnInput)
    const deferred = createDeferred<boolean>()
    const oldEntry = getEntry(service)
    const oldConnection = {
      close: vi.fn(),
      send: vi.fn(),
      events: [],
      applyPolicyUpdate: vi.fn(() => deferred.promise)
    }
    oldEntry.connection = oldConnection

    const updatePromise = (service as any).handleAgentUpdated('agent-1', { disabledTools: ['Bash'] }, { id: 'agent-1' })
    expect(oldConnection.applyPolicyUpdate).toHaveBeenCalledOnce()

    service.closeSession('session-1')
    service.beginTurn(baseTurnInput)
    const newConnection = {
      close: vi.fn(),
      send: vi.fn(),
      events: [],
      applyPolicyUpdate: vi.fn()
    }
    getEntry(service).connection = newConnection

    deferred.reject(new Error('late policy update failure'))
    await updatePromise

    expect(oldConnection.close).toHaveBeenCalledOnce()
    expect(newConnection.close).not.toHaveBeenCalled()
    expect(service.inspect('session-1')).toMatchObject({ sessionId: 'session-1', status: 'active' })
  })

  it('detaches without tearing down the session when a live policy update returns false', async () => {
    const service = new AgentSessionRuntimeService()
    service.beginTurn(baseTurnInput)
    const entry = getEntry(service)
    const connection = {
      close: vi.fn(),
      send: vi.fn(),
      events: [],
      applyPolicyUpdate: vi.fn().mockResolvedValue(false)
    }
    entry.connection = connection

    await (service as any).handleAgentUpdated('agent-1', { disabledTools: ['Bash'] }, { id: 'agent-1' })

    expect(mockMainLoggerService.warn).toHaveBeenCalledWith(
      'Live agent policy update had no live query; detaching runtime connection',
      {
        agentId: 'agent-1',
        sessionId: 'session-1'
      }
    )
    expect(connection.close).toHaveBeenCalledOnce()
    expect(service.inspect('session-1')).toMatchObject({ sessionId: 'session-1', status: 'active' })
    expect(getEntry(service).connection).toBeUndefined()
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
    const connection = { close: vi.fn(), send: vi.fn(), events: [] }
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

  it('publishes compaction state through shared cache and treats compaction as busy', () => {
    const service = new AgentSessionRuntimeService()
    service.beginTurn(baseTurnInput)
    service.markTurnTerminal('session-1', 'success')
    expect(service.isSessionBusy('session-1')).toBe(false)
    expect(service.willContinueTopic('agent-session:session-1')).toBe(false)

    ;(service as any).handleRuntimeEvent(getEntry(service), { type: 'compaction-start' })

    expect(service.isSessionBusy('session-1')).toBe(true)
    expect(service.willContinueTopic('agent-session:session-1')).toBe(false)
    expect(mocks.cacheSetShared).toHaveBeenCalledWith('agent.session.compaction.session-1', {
      status: 'compacting',
      startedAt: expect.any(String)
    })

    ;(service as any).handleRuntimeEvent(getEntry(service), { type: 'compaction-complete' })

    expect(service.isSessionBusy('session-1')).toBe(false)
    expect(mocks.cacheSetShared).toHaveBeenLastCalledWith('agent.session.compaction.session-1', {
      status: 'idle'
    })
  })

  it('a no-anchor compaction success following the boundary leaves status idle without clobbering (B2)', () => {
    const service = new AgentSessionRuntimeService()
    service.beginTurn(baseTurnInput)
    service.markTurnTerminal('session-1', 'success')

    ;(service as any).handleRuntimeEvent(getEntry(service), { type: 'compaction-start' })
    // The boundary carries the token anchor (its metrics ride the data-compaction-anchor chunk).
    ;(service as any).handleRuntimeEvent(getEntry(service), {
      type: 'compaction-complete',
      anchor: {
        trigger: 'auto',
        completedAt: '2026-06-09T12:00:00.000Z',
        preTokens: 52_000,
        postTokens: 14_000,
        durationMs: 1234
      }
    })
    mocks.cacheSetShared.mockClear()

    // A no-anchor `status: success` can arrive right after the boundary. It must only flip status to
    // idle — never write empty token fields or reset a timestamp (the old bug clobbered both).
    ;(service as any).handleRuntimeEvent(getEntry(service), { type: 'compaction-complete' })

    expect(mocks.cacheSetShared).toHaveBeenLastCalledWith('agent.session.compaction.session-1', {
      status: 'idle'
    })
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

    expect(mocks.cacheDeleteShared).toHaveBeenCalledWith('agent.session.compaction.session-1')
    expect(mocks.cacheDeleteShared).toHaveBeenCalledWith('agent.session.context_usage.session-1')
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
    mocks.getLastRuntimeResumeToken.mockResolvedValue('resume-db')
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

    it('closes the continuation when turn-complete arrives before A2 opens', async () => {
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
      const reader = service
        .openTurnStream({
          sessionId: 'session-1',
          turnId: handle.turnId,
          signal: new AbortController().signal
        })
        .getReader()
      await expect(reader.read()).resolves.toMatchObject({ value: { type: 'start' }, done: false })
      await vi.waitFor(() => expect(connection.send).toHaveBeenCalledOnce())

      events.push({ type: 'steer-boundary', inputs: [{ message: userMessage('user-2'), systemReminder: true }] })
      await vi.waitFor(() => expect(getEntry(service).rolling).toBe(true))
      await expect(reader.read()).resolves.toMatchObject({ done: true })

      events.push({ type: 'chunk', chunk: { type: 'text-delta', id: 'p2', delta: 'post' } })
      await vi.waitFor(() => expect(getEntry(service).rollBuffer).toHaveLength(1))

      // The SDK can finish the underlying query before the stream-manager has opened A2.
      events.push({ type: 'turn-complete' })
      await vi.waitFor(() => expect(getEntry(service).rollCompleted).toBe(true))

      void terminalListener(handle).onDone({ status: 'success', isTopicDone: false })
      await vi.waitFor(() => expect(getEntry(service).currentTurn.userMessage.id).toBe('user-2'))
      const a2 = getEntry(service).currentTurn
      const reader2 = service
        .openTurnStream({ sessionId: 'session-1', turnId: a2.turnId, signal: new AbortController().signal })
        .getReader()

      await expect(reader2.read()).resolves.toMatchObject({ value: { type: 'start' }, done: false })
      await expect(reader2.read()).resolves.toMatchObject({ value: { type: 'text-delta', delta: 'post' }, done: false })
      await expect(reader2.read()).resolves.toMatchObject({ done: true })
      expect(getEntry(service).rolling).toBe(false)
      expect(getEntry(service).rollCompleted).toBe(false)
      expect(getEntry(service).currentTurn.terminalStatus).toBe('success')

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

  it('surfaces the error and settles the turn when the next-turn placeholder save rejects (R3)', async () => {
    const service = new AgentSessionRuntimeService()
    service.beginTurn(baseTurnInput)
    const entry = getEntry(service)
    const queued = userMessage('user-2')
    entry.pendingTurns.push(queued)

    const saveError = new Error('db down')
    mocks.saveMessage.mockRejectedValueOnce(saveError)

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
    entry.rollCompleted = false

    const saveError = new Error('db down')
    mocks.saveMessage.mockRejectedValueOnce(saveError)

    // The A2 placeholder save failed: abandon the roll (drop the buffered post-steer chunks), surface
    // the failure to the live renderer, and settle the turn to `error` instead of idling on a doomed roll.
    await expect((service as any).startContinuationTurn(entry)).resolves.toBeUndefined()

    expect(mocks.startRuntimeTurn).not.toHaveBeenCalled()
    expect(entry.rolling).toBe(false)
    expect(entry.rollBuffer).toBeUndefined()
    expect(entry.rollCompleted).toBe(false)
    expect(mocks.broadcastTopicError).toHaveBeenCalledWith(
      entry.topicId,
      entry.modelId,
      expect.objectContaining({ message: expect.stringContaining('db down') })
    )
    expect(entry.status).toBe('idle')
    expect(entry.lastTerminalStatus).toBe('error')
  })
})
