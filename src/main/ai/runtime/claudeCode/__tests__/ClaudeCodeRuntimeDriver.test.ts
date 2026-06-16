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
    const contextUsage = {
      categories: [],
      totalTokens: 42,
      maxTokens: 100,
      rawMaxTokens: 100,
      percentage: 42,
      gridRows: [],
      model: 'sonnet',
      memoryFiles: [],
      mcpTools: [],
      agents: [],
      isAutoCompactEnabled: true,
      apiUsage: null
    }
    const query = {
      ...queryQueue.iterable,
      interrupt: vi.fn(),
      close: vi.fn(),
      getContextUsage: vi.fn().mockResolvedValue(contextUsage)
    }
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
      value: { type: 'context-usage', usage: contextUsage }
    })
    await expect(events.next()).resolves.toMatchObject({
      value: { type: 'turn-complete' }
    })
    void connection.close()
  })

  it('maps SDK compaction status and boundary messages to runtime compaction events', async () => {
    const queryQueue = createAsyncQueue<any>()
    const query = { ...queryQueue.iterable, interrupt: vi.fn(), close: vi.fn() }
    mocks.createClaudeQuery.mockReturnValue(query)
    const connection = await new ClaudeCodeRuntimeDriver().connect({
      sessionId: 'session-1',
      agentId: 'agent-1',
      modelId: 'claude-code::sonnet' as any
    })
    const events = connection.events[Symbol.asyncIterator]()

    queryQueue.push({
      type: 'system',
      subtype: 'status',
      status: 'compacting',
      session_id: 'resume-1'
    })
    await expect(events.next()).resolves.toMatchObject({
      value: { type: 'compaction-start' }
    })

    queryQueue.push({
      type: 'system',
      subtype: 'compact_boundary',
      session_id: 'resume-1',
      compact_metadata: {
        trigger: 'auto',
        pre_tokens: 52_000,
        post_tokens: 14_000,
        duration_ms: 1234
      }
    })
    await expect(events.next()).resolves.toMatchObject({
      value: {
        type: 'compaction-complete',
        anchor: {
          trigger: 'auto',
          completedAt: expect.any(String),
          preTokens: 52_000,
          postTokens: 14_000,
          durationMs: 1234
        }
      }
    })

    void connection.close()
  })

  it('maps SDK compact failures to runtime compaction-error events', async () => {
    const queryQueue = createAsyncQueue<any>()
    const query = { ...queryQueue.iterable, interrupt: vi.fn(), close: vi.fn() }
    mocks.createClaudeQuery.mockReturnValue(query)
    const connection = await new ClaudeCodeRuntimeDriver().connect({
      sessionId: 'session-1',
      agentId: 'agent-1',
      modelId: 'claude-code::sonnet' as any
    })
    const events = connection.events[Symbol.asyncIterator]()

    queryQueue.push({
      type: 'system',
      subtype: 'status',
      status: null,
      compact_result: 'failed',
      compact_error: 'context too large',
      session_id: 'resume-1'
    })

    await expect(events.next()).resolves.toMatchObject({
      value: { type: 'compaction-error', error: 'context too large' }
    })

    void connection.close()
  })

  it('maps SDK compact success status without a boundary to a completion event', async () => {
    const queryQueue = createAsyncQueue<any>()
    const query = { ...queryQueue.iterable, interrupt: vi.fn(), close: vi.fn() }
    mocks.createClaudeQuery.mockReturnValue(query)
    const connection = await new ClaudeCodeRuntimeDriver().connect({
      sessionId: 'session-1',
      agentId: 'agent-1',
      modelId: 'claude-code::sonnet' as any
    })
    const events = connection.events[Symbol.asyncIterator]()

    queryQueue.push({
      type: 'system',
      subtype: 'status',
      status: null,
      compact_result: 'success',
      session_id: 'resume-1'
    })

    await expect(events.next()).resolves.toEqual({
      value: { type: 'compaction-complete' },
      done: false
    })

    void connection.close()
  })

  describe('applyPolicyUpdate — permission mode', () => {
    function makeSnapshot(initialMode: string | undefined) {
      let mode = initialMode
      return {
        getPermissionMode: vi.fn(() => mode),
        setPermissionMode: vi.fn((next: string | undefined) => {
          mode = next
        })
      }
    }

    it('awaits the SDK call before mutating the snapshot', async () => {
      const snapshot = makeSnapshot('default')
      mocks.buildRequest.mockResolvedValueOnce({
        key: 'warm-key',
        options: { model: 'sonnet' },
        settings: { toolPolicySnapshot: snapshot },
        sdkModelId: 'sonnet-sdk',
        initializeTimeoutMs: 100
      })
      const queryQueue = createAsyncQueue<any>()
      // Assert the snapshot is untouched at the moment the SDK call runs — the driver must mutate it
      // only AFTER awaiting the SDK round-trip.
      const setPermissionMode = vi.fn().mockImplementation(async () => {
        expect(snapshot.setPermissionMode).not.toHaveBeenCalled()
      })
      const query = { ...queryQueue.iterable, interrupt: vi.fn(), close: vi.fn(), setPermissionMode }
      mocks.createClaudeQuery.mockReturnValue(query)
      const connection = await new ClaudeCodeRuntimeDriver().connect({
        sessionId: 'session-1',
        agentId: 'agent-1',
        modelId: 'claude-code::sonnet' as any
      })

      const ok = await connection.applyPolicyUpdate?.({ type: 'permission-mode', permissionMode: 'acceptEdits' })

      expect(ok).toBe(true)
      expect(setPermissionMode).toHaveBeenCalledWith('acceptEdits')
      expect(snapshot.setPermissionMode).toHaveBeenCalledWith('acceptEdits')

      void connection.close()
    })

    it('does NOT mutate the snapshot when the SDK setPermissionMode rejects', async () => {
      const snapshot = makeSnapshot('default')
      mocks.buildRequest.mockResolvedValueOnce({
        key: 'warm-key',
        options: { model: 'sonnet' },
        settings: { toolPolicySnapshot: snapshot },
        sdkModelId: 'sonnet-sdk',
        initializeTimeoutMs: 100
      })
      const queryQueue = createAsyncQueue<any>()
      const setPermissionMode = vi.fn().mockRejectedValue(new Error('SDK refused'))
      const query = { ...queryQueue.iterable, interrupt: vi.fn(), close: vi.fn(), setPermissionMode }
      mocks.createClaudeQuery.mockReturnValue(query)
      const connection = await new ClaudeCodeRuntimeDriver().connect({
        sessionId: 'session-1',
        agentId: 'agent-1',
        modelId: 'claude-code::sonnet' as any
      })

      await expect(
        connection.applyPolicyUpdate?.({ type: 'permission-mode', permissionMode: 'acceptEdits' })
      ).rejects.toThrow('SDK refused')
      // Fail-closed: the snapshot (which gates canUseTool) keeps the old mode the running query
      // never moved off of — it must NOT be advanced to the unconfirmed tighten/loosen.
      expect(snapshot.setPermissionMode).not.toHaveBeenCalled()

      void connection.close()
    })

    it('short-circuits an unchanged permission mode without an SDK round-trip', async () => {
      const snapshot = makeSnapshot('acceptEdits')
      mocks.buildRequest.mockResolvedValueOnce({
        key: 'warm-key',
        options: { model: 'sonnet' },
        settings: { toolPolicySnapshot: snapshot },
        sdkModelId: 'sonnet-sdk',
        initializeTimeoutMs: 100
      })
      const queryQueue = createAsyncQueue<any>()
      const setPermissionMode = vi.fn().mockResolvedValue(undefined)
      const query = { ...queryQueue.iterable, interrupt: vi.fn(), close: vi.fn(), setPermissionMode }
      mocks.createClaudeQuery.mockReturnValue(query)
      const connection = await new ClaudeCodeRuntimeDriver().connect({
        sessionId: 'session-1',
        agentId: 'agent-1',
        modelId: 'claude-code::sonnet' as any
      })

      const ok = await connection.applyPolicyUpdate?.({ type: 'permission-mode', permissionMode: 'acceptEdits' })

      expect(ok).toBe(true)
      expect(setPermissionMode).not.toHaveBeenCalled()
      expect(snapshot.setPermissionMode).not.toHaveBeenCalled()

      void connection.close()
    })
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

  it('redirect declines without a live turn and stashes the steer in the holder once a turn is active', async () => {
    const queryQueue = createAsyncQueue<any>()
    const query = { ...queryQueue.iterable, interrupt: vi.fn(), close: vi.fn() }
    mocks.createClaudeQuery.mockReturnValue(query)
    const steerHolder = { pending: [] as unknown[], dispose: vi.fn() }
    mocks.buildRequest.mockResolvedValueOnce({
      key: 'warm-key',
      options: { model: 'sonnet' },
      settings: { steerHolder },
      sdkModelId: 'sonnet-sdk',
      initializeTimeoutMs: 100
    })
    const connection = await new ClaudeCodeRuntimeDriver().connect({
      sessionId: 'session-1',
      agentId: 'agent-1',
      modelId: 'claude-code::sonnet' as any
    })

    // No active turn (no adapter yet) → redirect declines so the host queues instead of steering.
    expect(connection.redirect?.({ message: userMessage() })).toBe(false)
    expect(steerHolder.pending).toHaveLength(0)

    // A turn is now live → redirect stashes the steer in the shared holder for the PreToolUse hook.
    void connection.send({ message: userMessage() })
    expect(connection.redirect?.({ message: userMessage() })).toBe(true)
    expect(steerHolder.pending).toHaveLength(1)

    void connection.close()
    expect(steerHolder.dispose).toHaveBeenCalled()
  })

  it('emits a steer-boundary at the first top-level message_start after a steer is injected', async () => {
    const queryQueue = createAsyncQueue<any>()
    const query = { ...queryQueue.iterable, interrupt: vi.fn(), close: vi.fn() }
    mocks.createClaudeQuery.mockReturnValue(query)
    const steerHolder = { pending: [] as unknown[], onInjected: undefined as any, dispose: vi.fn() }
    mocks.buildRequest.mockResolvedValueOnce({
      key: 'warm-key',
      options: { model: 'sonnet' },
      settings: { steerHolder },
      sdkModelId: 'sonnet-sdk',
      initializeTimeoutMs: 100
    })
    const connection = await new ClaudeCodeRuntimeDriver().connect({
      sessionId: 'session-1',
      agentId: 'agent-1',
      modelId: 'claude-code::sonnet' as any
    })
    const events = connection.events[Symbol.asyncIterator]()

    // The live connection binds onInjected so the PreToolUse hook can arm the boundary.
    expect(typeof steerHolder.onInjected).toBe('function')

    queryQueue.push({ type: 'system', subtype: 'init', session_id: 'resume-init' })
    await events.next() // resume-token
    void connection.send({ message: userMessage() })
    await events.next() // metadata chunk (init replayed on send)

    // A message_start BEFORE injection (the pre-steer assistant message) must NOT roll.
    queryQueue.push({ type: 'stream_event', event: { type: 'message_start' }, parent_tool_use_id: null })
    await expect(events.next()).resolves.toMatchObject({ value: { type: 'chunk', chunk: { type: 'text-delta' } } })

    // PreToolUse hook injects the steer → arms the boundary.
    const steer = { message: userMessage() }
    steerHolder.onInjected([steer])

    // A nested (subagent) message_start carries a parent_tool_use_id → must NOT roll.
    queryQueue.push({ type: 'stream_event', event: { type: 'message_start' }, parent_tool_use_id: 'tool-x' })
    await expect(events.next()).resolves.toMatchObject({ value: { type: 'chunk', chunk: { type: 'text-delta' } } })

    // The first TOP-LEVEL message_start after injection emits the boundary, ahead of its own chunks.
    queryQueue.push({ type: 'stream_event', event: { type: 'message_start' }, parent_tool_use_id: null })
    await expect(events.next()).resolves.toMatchObject({ value: { type: 'steer-boundary', inputs: [steer] } })
    await expect(events.next()).resolves.toMatchObject({ value: { type: 'chunk', chunk: { type: 'text-delta' } } })

    void connection.close()
  })

  it('drops the steer-boundary arm when the turn ends before a post-steer message', async () => {
    const queryQueue = createAsyncQueue<any>()
    const query = { ...queryQueue.iterable, interrupt: vi.fn(), close: vi.fn() }
    mocks.createClaudeQuery.mockReturnValue(query)
    const steerHolder = { pending: [] as unknown[], onInjected: undefined as any, dispose: vi.fn() }
    mocks.buildRequest.mockResolvedValueOnce({
      key: 'warm-key',
      options: { model: 'sonnet' },
      settings: { steerHolder },
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
    steerHolder.onInjected([{ message: userMessage() }])

    // Turn ends (result) with no following top-level message_start → no boundary, just a clean turn end.
    queryQueue.push({ type: 'result', subtype: 'success', session_id: 'resume-result', usage: {} })

    const seen: any[] = []
    for (;;) {
      const { value, done } = await events.next()
      if (done) break
      seen.push(value)
      if (value?.type === 'turn-complete') break
    }
    expect(seen.some((e) => e?.type === 'steer-boundary')).toBe(false)
    expect(seen.some((e) => e?.type === 'turn-complete')).toBe(true)

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

  it('keeps the session approval emitter across turns — disposes only on close, not on turn-complete', async () => {
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

    // Turn 1 runs to completion.
    void connection.send({ message: userMessage() })
    queryQueue.push({ type: 'result', subtype: 'success', session_id: 'resume-1', usage: { output_tokens: 1 } })
    let evt = await events.next()
    while (evt.value?.type !== 'turn-complete') evt = await events.next()

    // Regression: a completed turn must NOT dispose the session-scoped approval emitter (doing so
    // evicted it, so the next turn's canUseTool found no emitter and denied "Approval emitter not ready").
    expect(dispose).not.toHaveBeenCalled()

    // Turn 2's approval still reaches the stream — the emitter survived turn 1.
    approvalEmitter.emit({ type: 'tool-approval-request', approvalId: 'approval-2', toolCallId: 'tool-2' } as any)
    await expect(events.next()).resolves.toMatchObject({
      value: { type: 'chunk', chunk: { type: 'tool-approval-request', approvalId: 'approval-2' } }
    })

    // Teardown is the only place that disposes.
    void connection.close()
    expect(dispose).toHaveBeenCalled()
  })
})
