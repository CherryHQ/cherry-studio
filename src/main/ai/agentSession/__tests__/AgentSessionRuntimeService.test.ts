import { BaseService } from '@main/core/lifecycle/BaseService'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  saveMessage: vi.fn(),
  maybeRenameAgentSession: vi.fn(),
  applicationGet: vi.fn(),
  startRuntimeTurn: vi.fn(),
  pauseRuntimeTurn: vi.fn(),
  spanCacheSetTopicId: vi.fn(),
  prewarmAgentSession: vi.fn(),
  traceModeEnabled: vi.fn()
}))

vi.mock('@data/services/AgentSessionMessageService', () => ({
  agentSessionMessageService: { saveMessage: mocks.saveMessage }
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
  assistantMessageId: 'assistant-1'
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

describe('AgentSessionRuntimeService', () => {
  beforeEach(() => {
    BaseService.resetInstances()
    runtimeDriverRegistry.clearForTest()
    vi.clearAllMocks()
    mocks.saveMessage.mockImplementation(async ({ message }) => ({
      ...message,
      id: message.id ?? 'generated-message-id'
    }))
    mocks.applicationGet.mockImplementation((name: string) => {
      if (name === 'AiStreamManager') {
        return {
          startRuntimeTurn: mocks.startRuntimeTurn,
          pauseRuntimeTurn: mocks.pauseRuntimeTurn
        }
      }
      if (name === 'SpanCacheService') return { setTopicId: mocks.spanCacheSetTopicId }
      if (name === 'ClaudeCodeWarmQueryManager') return { prewarmAgentSession: mocks.prewarmAgentSession }
      if (name === 'ClaudeCodeTraceBridgeService') return { isTraceModeEnabled: mocks.traceModeEnabled }
      throw new Error(`Unexpected application.get(${name})`)
    })
    mocks.traceModeEnabled.mockReturnValue(false)
  })

  it('creates an active runtime with a session-level pending queue', () => {
    const service = new AgentSessionRuntimeService()

    const handle = service.beginTurn(baseTurnInput)
    handle.pendingMessages.push(userMessage('user-2'))

    expect(terminalListener(handle).id).toBe('agent-runtime:session-1')
    expect(persistenceListener(handle).id).toContain('persistence:agents-db:agent-session:session-1')
    expect(service.inspect('session-1')).toMatchObject({
      sessionId: 'session-1',
      topicId: 'agent-session:session-1',
      assistantMessageId: 'assistant-1',
      status: 'active',
      pendingMessageCount: 1,
      lastTerminalStatus: undefined,
      activeToolCount: 0,
      interruptRequested: false
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

  it('reuses an idle runtime for the next fresh turn', async () => {
    const service = new AgentSessionRuntimeService()
    const first = service.beginTurn(baseTurnInput)
    const closed = first.pendingMessages[Symbol.asyncIterator]().next()
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

    await expect(closed).resolves.toMatchObject({ done: true })
    expect(second.pendingMessages).not.toBe(first.pendingMessages)
    expect(getEntry(service).connection).toBe(connection)
    expect(service.inspect('session-1')).toMatchObject({
      assistantMessageId: 'assistant-2',
      status: 'active',
      pendingMessageCount: 0,
      resumeToken: 'resume-1'
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

  it('closes the active queue and clears the runtime on closeSession', async () => {
    const service = new AgentSessionRuntimeService()
    const handle = service.beginTurn(baseTurnInput)
    const next = handle.pendingMessages[Symbol.asyncIterator]().next()
    const connection = { close: vi.fn(), send: vi.fn(), events: [] }
    const entry = getEntry(service)
    entry.connection = connection
    entry.connectionLoop = Promise.resolve()
    entry.startingNextTurn = true

    service.closeSession('session-1')

    await expect(next).resolves.toMatchObject({ done: true })
    expect(connection.close).toHaveBeenCalled()
    expect(entry.connection).toBeUndefined()
    expect(entry.connectionLoop).toBeUndefined()
    expect(entry.currentTurn).toBeUndefined()
    expect(entry.startingNextTurn).toBe(false)
    expect(service.inspect('session-1')).toBeUndefined()
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

    await expect(reader.read()).resolves.toMatchObject({ value: { type: 'stream-start' }, done: false })
    await vi.waitFor(() => expect(connection.send).toHaveBeenCalledWith({ message: userMessage('user-1') }))

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

  it('passes trace context to the runtime driver and closes the connection after trace turns', async () => {
    mocks.traceModeEnabled.mockReturnValue(true)
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
      traceId: '0'.repeat(32),
      rootSpanId: '1'.repeat(16)
    })
    const stream = service.openTurnStream({
      sessionId: 'session-1',
      turnId: handle.turnId,
      signal: new AbortController().signal
    })
    const reader = stream.getReader()

    await expect(reader.read()).resolves.toMatchObject({ value: { type: 'stream-start' }, done: false })
    await vi.waitFor(() =>
      expect(connect).toHaveBeenCalledWith({
        sessionId: 'session-1',
        agentId: 'agent-1',
        modelId: 'claude-code::claude-sonnet-4-5',
        resumeToken: undefined,
        trace: {
          topicId: 'agent-session:session-1',
          traceId: '0'.repeat(32),
          rootSpanId: '1'.repeat(16),
          sessionId: 'session-1',
          turnId: handle.turnId,
          modelName: 'claude-sonnet-4-5'
        }
      })
    )

    void terminalListener(handle).onDone({ status: 'success', isTopicDone: true })

    expect(connection.close).toHaveBeenCalledOnce()
    expect(getEntry(service).connection).toBeUndefined()
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
    entry.pendingMessages.push(userMessage('user-2'))

    await (service as any).startNextTurn(entry)

    const savedMessage = mocks.saveMessage.mock.calls[0][0].message
    expect(mocks.saveMessage).toHaveBeenCalledWith({
      sessionId: 'session-1',
      message: {
        role: 'assistant',
        status: 'pending',
        data: { parts: [] },
        modelId: 'claude-code::claude-sonnet-4-5',
        traceId: expect.any(String)
      }
    })
    expect(mocks.spanCacheSetTopicId).toHaveBeenCalledWith(savedMessage.traceId, 'agent-session:session-1')
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
        runtime: { kind: 'agent-session', sessionId: 'session-1', turnId: expect.any(String) },
        pendingMessages: entry.pendingMessages
      },
      listeners: [
        expect.objectContaining({ id: expect.stringContaining('persistence:agents-db:') }),
        expect.objectContaining({ id: 'agent-runtime:session-1' }),
        expect.objectContaining({ id: 'persistence:trace:agent-session:session-1' })
      ]
    })
    const request = mocks.startRuntimeTurn.mock.calls[0][0].request
    expect(request.messageId).toBe(request.messages[1].id)
    expect(getEntry(service).currentTurn.trace).toMatchObject({
      topicId: 'agent-session:session-1',
      traceId: savedMessage.traceId,
      rootSpanId: expect.any(String),
      sessionId: 'session-1',
      turnId: request.runtime.turnId,
      modelName: 'claude-sonnet-4-5'
    })
  })
})
