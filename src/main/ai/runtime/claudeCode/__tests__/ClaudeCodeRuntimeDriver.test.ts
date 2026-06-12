import { mockMainLoggerService } from '@test-mocks/MainLoggerService'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  buildRequest: vi.fn(),
  applicationGet: vi.fn(),
  consumeWarmQuery: vi.fn(),
  prepareTrace: vi.fn(),
  createClaudeQuery: vi.fn(),
  adapterInstances: [] as any[]
}))

vi.mock('@main/core/application', () => ({
  application: { get: mocks.applicationGet }
}))

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: mocks.createClaudeQuery
}))

vi.mock('../agentSessionWarmup', () => ({
  buildClaudeCodeQueryRequestForAgentSession: mocks.buildRequest
}))

vi.mock('../streamAdapter', () => ({
  convertClaudeCodeUsage: (usage: any) => ({
    inputTokens: {
      total:
        (usage?.input_tokens ?? 0) + (usage?.cache_creation_input_tokens ?? 0) + (usage?.cache_read_input_tokens ?? 0),
      noCache: usage?.input_tokens ?? 0,
      cacheRead: usage?.cache_read_input_tokens ?? 0,
      cacheWrite: usage?.cache_creation_input_tokens ?? 0
    },
    outputTokens: { total: usage?.output_tokens ?? 0, text: undefined, reasoning: undefined }
  }),
  ClaudeCodeStreamAdapter: class {
    readonly finalizeOpenParts = vi.fn()

    constructor(private readonly options: any) {
      mocks.adapterInstances.push(this)
    }

    handleTruncationError(error: any) {
      if (!String(error?.message ?? '').includes('truncat')) return false
      this.options.sink.enqueue({ type: 'text-delta', id: 'salvaged', delta: ' [truncated]' })
      this.options.sink.enqueue({ type: 'finish', finishReason: { unified: 'length', raw: 'truncation' } })
      return true
    }

    handleMessage(message: any) {
      if (message.type === 'truncate-now') {
        throw new Error('Claude Code SDK output ended unexpectedly; truncated response')
      }
      if (message.type === 'system' && message.subtype === 'init') {
        this.options.onSessionId(message.session_id)
        this.options.sink.enqueue({ type: 'message-metadata', messageMetadata: { modelId: 'sonnet-sdk' } })
        return { type: 'continue' }
      }
      if (message.type === 'stream_event') {
        this.options.sink.enqueue({ type: 'text-delta', id: 'text-1', delta: 'hello' })
        return { type: 'continue' }
      }
      if (message.type === 'result') {
        this.options.onSessionId(message.session_id)
        this.options.sink.enqueue({ type: 'finish', finishReason: { unified: 'stop', raw: 'end_turn' } })
        if (message.subtype !== 'success') throw new Error('runtime failed')
        return { type: 'result', sessionId: message.session_id, message }
      }
      return { type: 'continue' }
    }
  }
}))

const { ClaudeCodeRuntimeDriver } = await import('../ClaudeCodeRuntimeDriver')

function createAsyncQueue<T>() {
  const items: T[] = []
  const waiters: Array<(value: IteratorResult<T>) => void> = []
  let closed = false

  return {
    push(item: T) {
      const waiter = waiters.shift()
      if (waiter) waiter({ value: item, done: false })
      else items.push(item)
    },
    close() {
      closed = true
      while (waiters.length > 0) waiters.shift()?.({ value: undefined as T, done: true })
    },
    iterable: {
      [Symbol.asyncIterator](): AsyncIterator<T> {
        return {
          next: () => {
            const item = items.shift()
            if (item) return Promise.resolve({ value: item, done: false })
            if (closed) return Promise.resolve({ value: undefined as T, done: true })
            return new Promise<IteratorResult<T>>((resolve) => waiters.push(resolve))
          }
        }
      }
    }
  }
}

function userMessage() {
  return {
    id: 'user-1',
    topicId: 'agent-session:session-1',
    parentId: null,
    role: 'user',
    data: { parts: [{ type: 'text', text: 'hello' }] },
    status: 'success',
    createdAt: '',
    updatedAt: ''
  } as any
}

describe('ClaudeCodeRuntimeDriver', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.adapterInstances.length = 0
    mocks.applicationGet.mockImplementation((name: string) => {
      if (name === 'ClaudeCodeWarmQueryManager') return { consume: mocks.consumeWarmQuery }
      if (name === 'ClaudeCodeTraceBridgeService') return { prepareTrace: mocks.prepareTrace }
      throw new Error(`Unexpected application.get(${name})`)
    })
    mocks.consumeWarmQuery.mockResolvedValue(undefined)
    mocks.prepareTrace.mockResolvedValue(undefined)
    mocks.buildRequest.mockResolvedValue({
      key: 'warm-key',
      options: { model: 'sonnet' },
      settings: {},
      sdkModelId: 'sonnet-sdk',
      initializeTimeoutMs: 100
    })
  })

  it('connects with an opaque resume token and sends user input into the SDK queue', async () => {
    const queryQueue = createAsyncQueue<any>()
    const query = { ...queryQueue.iterable, interrupt: vi.fn(), close: vi.fn() }
    mocks.createClaudeQuery.mockReturnValue(query)

    const connection = await new ClaudeCodeRuntimeDriver().connect({
      sessionId: 'session-1',
      agentId: 'agent-1',
      modelId: 'claude-code::sonnet' as any,
      resumeToken: 'resume-1'
    })

    expect(mocks.buildRequest).toHaveBeenCalledWith('session-1', 'resume-1')
    const sdkInput = mocks.createClaudeQuery.mock.calls[0][0].prompt
    const nextInput = sdkInput[Symbol.asyncIterator]().next()

    void connection.send({ message: userMessage() })

    await expect(nextInput).resolves.toMatchObject({
      value: {
        type: 'user',
        session_id: 'resume-1',
        message: { role: 'user', content: 'hello' }
      },
      done: false
    })
    void connection.close()
  })

  it('emits resume token, chunks, and turn-complete events', async () => {
    const queryQueue = createAsyncQueue<any>()
    const query = { ...queryQueue.iterable, interrupt: vi.fn(), close: vi.fn() }
    mocks.createClaudeQuery.mockReturnValue(query)
    const connection = await new ClaudeCodeRuntimeDriver().connect({
      sessionId: 'session-1',
      agentId: 'agent-1',
      modelId: 'claude-code::sonnet' as any
    })
    const events = connection.events[Symbol.asyncIterator]()

    queryQueue.push({ type: 'system', subtype: 'init', session_id: 'resume-init' })
    await expect(events.next()).resolves.toMatchObject({
      value: { type: 'resume-token', token: 'resume-init' }
    })

    void connection.send({ message: userMessage() })
    await expect(events.next()).resolves.toMatchObject({
      value: { type: 'chunk', chunk: { type: 'message-metadata', messageMetadata: { modelId: 'sonnet-sdk' } } }
    })

    queryQueue.push({ type: 'stream_event', event: {}, session_id: 'resume-init' })
    await expect(events.next()).resolves.toMatchObject({
      value: { type: 'chunk', chunk: { type: 'text-delta', delta: 'hello' } }
    })

    queryQueue.push({
      type: 'result',
      subtype: 'success',
      session_id: 'resume-result',
      usage: {
        input_tokens: 10,
        output_tokens: 5,
        cache_creation_input_tokens: 3,
        cache_read_input_tokens: 2
      }
    })
    await expect(events.next()).resolves.toMatchObject({
      value: { type: 'resume-token', token: 'resume-result' }
    })
    await expect(events.next()).resolves.toMatchObject({
      value: { type: 'chunk', chunk: { type: 'finish' } }
    })
    await expect(events.next()).resolves.toMatchObject({
      value: {
        type: 'chunk',
        chunk: {
          type: 'message-metadata',
          messageMetadata: { totalTokens: 20, promptTokens: 15, completionTokens: 5 }
        }
      }
    })
    await expect(events.next()).resolves.toMatchObject({
      value: { type: 'turn-complete' }
    })
    void connection.close()
  })

  it('salvages a truncated SDK stream into a completed turn instead of erroring', async () => {
    const queryQueue = createAsyncQueue<any>()
    const query = { ...queryQueue.iterable, interrupt: vi.fn(), close: vi.fn() }
    mocks.createClaudeQuery.mockReturnValue(query)
    const connection = await new ClaudeCodeRuntimeDriver().connect({
      sessionId: 'session-1',
      agentId: 'agent-1',
      modelId: 'claude-code::sonnet' as any
    })
    const events = connection.events[Symbol.asyncIterator]()

    queryQueue.push({ type: 'system', subtype: 'init', session_id: 'resume-init' })
    await events.next() // resume-token
    void connection.send({ message: userMessage() })
    await events.next() // response-metadata chunk
    queryQueue.push({ type: 'stream_event', event: {}, session_id: 'resume-init' })
    await events.next() // buffered text-delta

    // SDK ends abruptly mid-output -> the adapter salvages buffered text.
    queryQueue.push({ type: 'truncate-now' })

    await expect(events.next()).resolves.toMatchObject({
      value: { type: 'chunk', chunk: { type: 'text-delta', delta: ' [truncated]' } }
    })
    await expect(events.next()).resolves.toMatchObject({
      value: { type: 'chunk', chunk: { type: 'finish', finishReason: { raw: 'truncation' } } }
    })
    // Turn completes cleanly — no `error` event surfaced for the dropped stream.
    await expect(events.next()).resolves.toMatchObject({ value: { type: 'turn-complete' } })
    void connection.close()
  })

  it('warns and drops turn-complete when a result arrives with no active turn', async () => {
    const queryQueue = createAsyncQueue<any>()
    const query = { ...queryQueue.iterable, interrupt: vi.fn(), close: vi.fn() }
    mocks.createClaudeQuery.mockReturnValue(query)
    const connection = await new ClaudeCodeRuntimeDriver().connect({
      sessionId: 'session-1',
      agentId: 'agent-1',
      modelId: 'claude-code::sonnet' as any
    })
    const events = connection.events[Symbol.asyncIterator]()

    // No `send()` -> no active adapter; a stray result must not be silently dropped.
    queryQueue.push({ type: 'result', subtype: 'success', session_id: 'resume-stray', usage: {} })

    await expect(events.next()).resolves.toMatchObject({
      value: { type: 'resume-token', token: 'resume-stray' }
    })
    expect(mockMainLoggerService.warn).toHaveBeenCalledWith(
      'Received a result message with no active turn; dropping turn-complete',
      { sessionId: 'session-1' }
    )

    // The stream closes with no turn-complete emitted for the stray result.
    queryQueue.close()
    await expect(events.next()).resolves.toMatchObject({ done: true })
    void connection.close()
  })

  it('interrupts and finalizes the active adapter', async () => {
    const queryQueue = createAsyncQueue<any>()
    const query = { ...queryQueue.iterable, interrupt: vi.fn(), close: vi.fn() }
    mocks.createClaudeQuery.mockReturnValue(query)
    const connection = await new ClaudeCodeRuntimeDriver().connect({
      sessionId: 'session-1',
      agentId: 'agent-1',
      modelId: 'claude-code::sonnet' as any
    })

    void connection.send({ message: userMessage() })
    await connection.interrupt?.()

    expect(query.interrupt).toHaveBeenCalled()
    expect(mocks.adapterInstances[0].finalizeOpenParts).toHaveBeenCalled()
    void connection.close()
  })

  it('injects Claude Code trace env and skips warm query for trace turns', async () => {
    const queryQueue = createAsyncQueue<any>()
    const query = { ...queryQueue.iterable, interrupt: vi.fn(), close: vi.fn() }
    mocks.createClaudeQuery.mockReturnValue(query)
    mocks.prepareTrace.mockResolvedValue({
      CLAUDE_CODE_ENABLE_TELEMETRY: '1',
      OTEL_EXPORTER_OTLP_ENDPOINT: 'http://127.0.0.1:4318',
      TRACEPARENT: `00-${'0'.repeat(32)}-${'1'.repeat(16)}-01`
    })

    const connection = await new ClaudeCodeRuntimeDriver().connect({
      sessionId: 'session-1',
      agentId: 'agent-1',
      modelId: 'claude-code::sonnet' as any,
      trace: {
        topicId: 'agent-session:session-1',
        traceId: '0'.repeat(32),
        rootSpanId: '1'.repeat(16),
        sessionId: 'session-1',
        turnId: 'turn-1',
        modelName: 'sonnet'
      }
    })

    expect(mocks.prepareTrace).toHaveBeenCalledWith({
      topicId: 'agent-session:session-1',
      traceId: '0'.repeat(32),
      rootSpanId: '1'.repeat(16),
      sessionId: 'session-1',
      turnId: 'turn-1',
      modelName: 'sonnet'
    })
    expect(mocks.consumeWarmQuery).not.toHaveBeenCalled()
    expect(mocks.createClaudeQuery).toHaveBeenCalledWith({
      prompt: expect.anything(),
      options: expect.objectContaining({
        model: 'sonnet',
        env: {
          CLAUDE_CODE_ENABLE_TELEMETRY: '1',
          OTEL_EXPORTER_OTLP_ENDPOINT: 'http://127.0.0.1:4318',
          TRACEPARENT: `00-${'0'.repeat(32)}-${'1'.repeat(16)}-01`
        }
      })
    })
    void connection.close()
  })

  it('updates the permission snapshot only after the SDK permission mode update succeeds', async () => {
    const queryQueue = createAsyncQueue<any>()
    const query = { ...queryQueue.iterable, interrupt: vi.fn(), close: vi.fn(), setPermissionMode: vi.fn() }
    const toolPolicySnapshot = { getPermissionMode: vi.fn(), setPermissionMode: vi.fn(), update: vi.fn() }
    mocks.createClaudeQuery.mockReturnValue(query)
    mocks.buildRequest.mockResolvedValue({
      key: 'warm-key',
      options: { model: 'sonnet' },
      settings: { toolPolicySnapshot },
      sdkModelId: 'sonnet-sdk',
      initializeTimeoutMs: 100
    })
    const connection = await new ClaudeCodeRuntimeDriver().connect({
      sessionId: 'session-1',
      agentId: 'agent-1',
      modelId: 'claude-code::sonnet' as any
    })

    await expect(
      connection.applyPolicyUpdate?.({ type: 'permission-mode', permissionMode: 'acceptEdits' })
    ).resolves.toBe(true)

    expect(query.setPermissionMode).toHaveBeenCalledWith('acceptEdits')
    expect(toolPolicySnapshot.setPermissionMode).toHaveBeenCalledWith('acceptEdits')
    expect(query.setPermissionMode.mock.invocationCallOrder[0]).toBeLessThan(
      toolPolicySnapshot.setPermissionMode.mock.invocationCallOrder[0]
    )
    void connection.close()
  })

  it('skips the SDK permission mode round-trip when the mode is unchanged', async () => {
    const queryQueue = createAsyncQueue<any>()
    const query = { ...queryQueue.iterable, interrupt: vi.fn(), close: vi.fn(), setPermissionMode: vi.fn() }
    const toolPolicySnapshot = {
      getPermissionMode: vi.fn(() => 'acceptEdits'),
      setPermissionMode: vi.fn(),
      update: vi.fn()
    }
    mocks.createClaudeQuery.mockReturnValue(query)
    mocks.buildRequest.mockResolvedValue({
      key: 'warm-key',
      options: { model: 'sonnet' },
      settings: { toolPolicySnapshot },
      sdkModelId: 'sonnet-sdk',
      initializeTimeoutMs: 100
    })
    const connection = await new ClaudeCodeRuntimeDriver().connect({
      sessionId: 'session-1',
      agentId: 'agent-1',
      modelId: 'claude-code::sonnet' as any
    })

    await expect(
      connection.applyPolicyUpdate?.({ type: 'permission-mode', permissionMode: 'acceptEdits' })
    ).resolves.toBe(true)

    expect(query.setPermissionMode).not.toHaveBeenCalled()
    expect(toolPolicySnapshot.setPermissionMode).not.toHaveBeenCalled()
    void connection.close()
  })

  it('does not mutate the permission snapshot when the SDK permission mode update fails', async () => {
    const queryQueue = createAsyncQueue<any>()
    const failure = new Error('setPermissionMode failed')
    const query = {
      ...queryQueue.iterable,
      interrupt: vi.fn(),
      close: vi.fn(),
      setPermissionMode: vi.fn().mockRejectedValue(failure)
    }
    const toolPolicySnapshot = { getPermissionMode: vi.fn(), setPermissionMode: vi.fn(), update: vi.fn() }
    mocks.createClaudeQuery.mockReturnValue(query)
    mocks.buildRequest.mockResolvedValue({
      key: 'warm-key',
      options: { model: 'sonnet' },
      settings: { toolPolicySnapshot },
      sdkModelId: 'sonnet-sdk',
      initializeTimeoutMs: 100
    })
    const connection = await new ClaudeCodeRuntimeDriver().connect({
      sessionId: 'session-1',
      agentId: 'agent-1',
      modelId: 'claude-code::sonnet' as any
    })

    await expect(
      connection.applyPolicyUpdate?.({ type: 'permission-mode', permissionMode: 'acceptEdits' })
    ).rejects.toBe(failure)

    expect(toolPolicySnapshot.setPermissionMode).not.toHaveBeenCalled()
    void connection.close()
  })

  it('binds tool approval requests into the active turn stream', async () => {
    const queryQueue = createAsyncQueue<any>()
    const query = { ...queryQueue.iterable, interrupt: vi.fn(), close: vi.fn() }
    const dispose = vi.fn()
    const approvalEmitter: any = { dispose }
    mocks.createClaudeQuery.mockReturnValue(query)
    mocks.buildRequest.mockResolvedValue({
      key: 'warm-key',
      options: { model: 'sonnet' },
      settings: { approvalEmitter },
      sdkModelId: 'sonnet-sdk',
      initializeTimeoutMs: 100
    })
    const connection = await new ClaudeCodeRuntimeDriver().connect({
      sessionId: 'session-1',
      agentId: 'agent-1',
      modelId: 'claude-code::sonnet' as any
    })
    const events = connection.events[Symbol.asyncIterator]()

    void connection.send({ message: userMessage() })
    approvalEmitter.emit({
      type: 'tool-approval-request',
      approvalId: 'approval-1',
      toolCallId: 'tool-1'
    } as any)

    await expect(events.next()).resolves.toMatchObject({
      value: {
        type: 'chunk',
        chunk: {
          type: 'tool-approval-request',
          approvalId: 'approval-1',
          toolCallId: 'tool-1'
        }
      }
    })
    void connection.close()
    expect(dispose).toHaveBeenCalled()
  })
})
