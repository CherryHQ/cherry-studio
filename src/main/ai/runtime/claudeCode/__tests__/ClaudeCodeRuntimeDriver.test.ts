import { mockMainLoggerService } from '@test-mocks/MainLoggerService'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  buildRequest: vi.fn(),
  deriveConfig: vi.fn(),
  getAgent: vi.fn(),
  applicationGet: vi.fn(),
  consumeWarmQuery: vi.fn(),
  prepareTrace: vi.fn(),
  createClaudeQuery: vi.fn(),
  collectFileAttachments: vi.fn(),
  prepareChatMessages: vi.fn(),
  materializeNativeFilePart: vi.fn(),
  adapterInstances: [] as any[]
}))

vi.mock('@application', () => ({
  application: { get: mocks.applicationGet }
}))

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: mocks.createClaudeQuery
}))

vi.mock('../agentSessionWarmup', () => ({
  buildClaudeCodeQueryRequestForAgentSession: mocks.buildRequest,
  deriveConnectionConfig: mocks.deriveConfig,
  // Mirror the real implementation (sorted-array JSON compare) — importing the actual module would
  // drag the unmocked data-service graph into this test file.
  toolPolicyFactsEqual: (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
}))

vi.mock('@data/services/AgentService', () => ({
  agentService: { getAgent: mocks.getAgent }
}))

vi.mock('@main/ai/messages/attachmentRouting', () => ({
  collectFileAttachments: mocks.collectFileAttachments,
  prepareChatMessages: mocks.prepareChatMessages
}))

vi.mock('@main/ai/messages/fileProcessor', () => ({
  materializeNativeFilePart: mocks.materializeNativeFilePart
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
    mocks.collectFileAttachments.mockReturnValue([])
    mocks.prepareChatMessages.mockImplementation(async (messages) => messages)
    mocks.materializeNativeFilePart.mockResolvedValue(null)
    mocks.buildRequest.mockResolvedValue({
      connectionConfig: {
        rebuildSignature: 'sig-1',
        live: { toolPolicy: { permissionMode: null, disabledTools: [], mcps: [] } }
      },
      key: 'warm-key',
      options: { model: 'sonnet' },
      settings: {},
      sdkModelId: 'sonnet-sdk',
      initializeTimeoutMs: 100
    })
    mocks.getAgent.mockReturnValue({ id: 'agent-1' })
    mocks.deriveConfig.mockResolvedValue({
      ok: true,
      config: {
        rebuildSignature: 'sig-1',
        live: { toolPolicy: { permissionMode: null, disabledTools: [], mcps: [] } }
      }
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

    // The connection routes with the host-chosen model — not a fresh DB read — so a live turn keeps
    // the model captured at its creation even if the agent was edited since.
    expect(mocks.buildRequest).toHaveBeenCalledWith('session-1', 'resume-1', 'claude-code::sonnet')
    const sdkInput = mocks.createClaudeQuery.mock.calls[0][0].prompt
    const nextInput = sdkInput[Symbol.asyncIterator]().next()

    await connection.send({ message: userMessage() })

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

  it('sends supported image attachments as native Claude SDK image blocks', async () => {
    const queryQueue = createAsyncQueue<any>()
    const query = { ...queryQueue.iterable, interrupt: vi.fn(), close: vi.fn() }
    mocks.createClaudeQuery.mockReturnValue(query)
    mocks.materializeNativeFilePart.mockResolvedValueOnce({
      type: 'file',
      url: 'data:image/png;base64,QUJD',
      mediaType: 'image/png'
    })
    const connection = await new ClaudeCodeRuntimeDriver().connect({
      sessionId: 'session-1',
      agentId: 'agent-1',
      modelId: 'claude-code::sonnet' as any
    })
    const sdkInput = mocks.createClaudeQuery.mock.calls[0][0].prompt
    const nextInput = sdkInput[Symbol.asyncIterator]().next()

    await connection.send({
      message: {
        ...userMessage(),
        data: {
          parts: [
            { type: 'text', text: 'describe this' },
            { type: 'file', url: 'file:///tmp/pixel.png', mediaType: 'image/png', filename: 'pixel.png' },
            { type: 'file', url: 'file:///tmp/spec.pdf', mediaType: 'application/pdf', filename: 'spec.pdf' }
          ]
        }
      }
    })

    await expect(nextInput).resolves.toMatchObject({
      value: {
        type: 'user',
        message: {
          role: 'user',
          content: [
            {
              type: 'text',
              text: 'describe this\n\nAttached files (read them with your tools using these absolute paths):\n- /tmp/spec.pdf'
            },
            { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'QUJD' } }
          ]
        }
      },
      done: false
    })
    expect(mocks.materializeNativeFilePart).toHaveBeenCalledTimes(1)
    void connection.close()
  })

  it('reuses first-party image data URLs prepared by shared attachment routing', async () => {
    const queryQueue = createAsyncQueue<any>()
    const query = { ...queryQueue.iterable, interrupt: vi.fn(), close: vi.fn() }
    mocks.createClaudeQuery.mockReturnValue(query)
    mocks.prepareChatMessages.mockImplementationOnce(async ([message]) => {
      const image = message.parts.find((part) => part.type === 'file')
      const materialized = await mocks.materializeNativeFilePart(image)
      return [{ ...message, parts: [message.parts[0], materialized] }]
    })
    mocks.materializeNativeFilePart.mockResolvedValueOnce({
      type: 'file',
      url: 'data:image/png;base64,QUJD',
      mediaType: 'image/png',
      filename: 'pixel.png',
      providerMetadata: { cherry: { fileEntryId: 'entry-1' } }
    })
    const connection = await new ClaudeCodeRuntimeDriver().connect({
      sessionId: 'session-1',
      agentId: 'agent-1',
      modelId: 'claude-code::sonnet' as any
    })
    const sdkInput = mocks.createClaudeQuery.mock.calls[0][0].prompt
    const nextInput = sdkInput[Symbol.asyncIterator]().next()

    await connection.send({
      message: {
        ...userMessage(),
        data: {
          parts: [
            { type: 'text', text: 'describe this' },
            {
              type: 'file',
              url: 'file:///tmp/pixel.png',
              mediaType: 'image/png',
              filename: 'pixel.png',
              providerMetadata: { cherry: { fileEntryId: 'entry-1' } }
            }
          ]
        }
      }
    })

    await expect(nextInput).resolves.toMatchObject({
      value: {
        message: {
          role: 'user',
          content: [
            { type: 'text', text: 'describe this' },
            { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'QUJD' } }
          ]
        }
      },
      done: false
    })
    expect(mocks.materializeNativeFilePart).toHaveBeenCalledTimes(1)
    void connection.close()
  })

  it('keeps a visible fallback when an image attachment cannot be materialized or exposed as a local path', async () => {
    const queryQueue = createAsyncQueue<any>()
    const query = { ...queryQueue.iterable, interrupt: vi.fn(), close: vi.fn() }
    mocks.createClaudeQuery.mockReturnValue(query)
    mocks.materializeNativeFilePart.mockResolvedValueOnce(null)
    const connection = await new ClaudeCodeRuntimeDriver().connect({
      sessionId: 'session-1',
      agentId: 'agent-1',
      modelId: 'claude-code::sonnet' as any
    })
    const sdkInput = mocks.createClaudeQuery.mock.calls[0][0].prompt
    const nextInput = sdkInput[Symbol.asyncIterator]().next()

    await connection.send({
      message: {
        ...userMessage(),
        data: {
          parts: [
            { type: 'text', text: 'describe this' },
            {
              type: 'file',
              url: 'https://example.com/pixel.png',
              mediaType: 'image/png',
              filename: 'pixel.png'
            }
          ]
        }
      }
    })

    await expect(nextInput).resolves.toMatchObject({
      value: {
        type: 'user',
        message: {
          role: 'user',
          content: 'describe this\n\nUnavailable attachments: pixel.png'
        }
      },
      done: false
    })
    expect(mockMainLoggerService.warn).toHaveBeenCalledWith('Claude Code attachments could not be sent', {
      attachments: ['pixel.png']
    })
    void connection.close()
  })

  it('distinguishes unsupported images from unreadable or invalid image payloads', async () => {
    const queryQueue = createAsyncQueue<any>()
    const query = { ...queryQueue.iterable, interrupt: vi.fn(), close: vi.fn() }
    mocks.createClaudeQuery.mockReturnValue(query)
    mocks.prepareChatMessages.mockImplementationOnce(async ([message]) => [
      {
        ...message,
        parts: message.parts.map((part) =>
          part.type === 'file' && part.filename === 'diagram.bmp'
            ? { ...part, url: 'data:image/bmp;base64,Qk0=', mediaType: 'image/bmp' }
            : part
        )
      }
    ])
    mocks.materializeNativeFilePart.mockImplementation(async (part) =>
      part.filename === 'mislabelled.png'
        ? { ...part, url: 'data:image/png;base64,QUJD', mediaType: 'image/png' }
        : null
    )
    const connection = await new ClaudeCodeRuntimeDriver().connect({
      sessionId: 'session-1',
      agentId: 'agent-1',
      modelId: 'claude-code::sonnet' as any
    })
    const sdkInput = mocks.createClaudeQuery.mock.calls[0][0].prompt
    const nextInput = sdkInput[Symbol.asyncIterator]().next()

    await connection.send({
      message: {
        ...userMessage(),
        data: {
          parts: [
            { type: 'text', text: 'inspect these images' },
            {
              type: 'file',
              url: 'file:///tmp/diagram.bmp',
              mediaType: 'image/bmp',
              filename: 'diagram.bmp',
              providerMetadata: { cherry: { fileEntryId: 'entry-bmp' } }
            },
            {
              type: 'file',
              url: 'file:///tmp/missing.png',
              mediaType: 'image/png',
              filename: 'missing.png',
              providerMetadata: { cherry: { fileEntryId: 'entry-missing' } }
            },
            { type: 'file', url: 'data:image/png;base64,', mediaType: 'image/png', filename: 'empty.png' },
            { type: 'file', mediaType: 'image/png', filename: 'missing-url.png' },
            {
              type: 'file',
              url: 'file:///tmp/mislabelled.png',
              mediaType: 'application/x-custom-image',
              filename: 'mislabelled.png'
            }
          ]
        }
      }
    })

    await expect(nextInput).resolves.toMatchObject({
      value: {
        type: 'user',
        message: {
          role: 'user',
          content: [
            {
              type: 'text',
              text: 'inspect these images\n\nAttached files (read them with your tools using these absolute paths):\n- /tmp/diagram.bmp\n\nUnavailable attachments: missing.png, empty.png, missing-url.png'
            },
            { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'QUJD' } }
          ]
        }
      },
      done: false
    })
    expect(mockMainLoggerService.warn).toHaveBeenCalledWith('Claude Code attachments could not be sent', {
      attachments: ['missing.png', 'empty.png', 'missing-url.png']
    })
    expect(mocks.materializeNativeFilePart).toHaveBeenCalledTimes(3)
    void connection.close()
  })

  it('routes first-party non-image attachments to extracted text before sending', async () => {
    const queryQueue = createAsyncQueue<any>()
    const query = { ...queryQueue.iterable, interrupt: vi.fn(), close: vi.fn() }
    mocks.createClaudeQuery.mockReturnValue(query)
    mocks.collectFileAttachments.mockReturnValueOnce([
      { fileEntryId: 'entry-1', handle: 'spec.pdf', displayName: 'spec.pdf' }
    ])
    mocks.prepareChatMessages.mockImplementationOnce(async ([message]) => [
      {
        ...message,
        parts: [
          { type: 'text', text: 'summarize this' },
          { type: 'text', text: 'Attached file "spec.pdf":\nextracted PDF body' }
        ]
      }
    ])
    const connection = await new ClaudeCodeRuntimeDriver().connect({
      sessionId: 'session-1',
      agentId: 'agent-1',
      modelId: 'claude-code::sonnet' as any
    })
    const sdkInput = mocks.createClaudeQuery.mock.calls[0][0].prompt
    const nextInput = sdkInput[Symbol.asyncIterator]().next()

    await connection.send({
      message: {
        ...userMessage(),
        data: {
          parts: [
            { type: 'text', text: 'summarize this' },
            {
              type: 'file',
              url: 'file:///tmp/spec.pdf',
              mediaType: 'application/pdf',
              filename: 'spec.pdf',
              providerMetadata: { cherry: { fileEntryId: 'entry-1' } }
            }
          ]
        }
      }
    })

    await expect(nextInput).resolves.toMatchObject({
      value: {
        message: {
          role: 'user',
          content: 'summarize this\nAttached file "spec.pdf":\nextracted PDF body'
        }
      },
      done: false
    })
    expect(mocks.prepareChatMessages).toHaveBeenCalledWith([expect.objectContaining({ id: 'user-1', role: 'user' })], {
      attachments: [{ fileEntryId: 'entry-1', handle: 'spec.pdf', displayName: 'spec.pdf' }],
      nativeSupport: { image: true, pdf: false, audio: false, video: false },
      isToolCapable: false
    })
    expect(mocks.materializeNativeFilePart).not.toHaveBeenCalled()
    void connection.close()
  })

  it('adds a steer reminder text part for image-only turns', async () => {
    const queryQueue = createAsyncQueue<any>()
    const query = { ...queryQueue.iterable, interrupt: vi.fn(), close: vi.fn() }
    mocks.createClaudeQuery.mockReturnValue(query)
    mocks.materializeNativeFilePart.mockResolvedValueOnce({
      type: 'file',
      url: 'data:image/png;base64,QUJD',
      mediaType: 'image/png'
    })
    const connection = await new ClaudeCodeRuntimeDriver().connect({
      sessionId: 'session-1',
      agentId: 'agent-1',
      modelId: 'claude-code::sonnet' as any
    })
    const sdkInput = mocks.createClaudeQuery.mock.calls[0][0].prompt
    const nextInput = sdkInput[Symbol.asyncIterator]().next()

    await connection.send({
      systemReminder: true,
      message: {
        ...userMessage(),
        data: {
          parts: [{ type: 'file', url: 'file:///tmp/pixel.png', mediaType: 'image/png', filename: 'pixel.png' }]
        }
      }
    })

    await expect(nextInput).resolves.toMatchObject({
      value: {
        type: 'user',
        message: {
          role: 'user',
          content: [
            { type: 'text', text: expect.stringContaining('<system-reminder>') },
            { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'QUJD' } }
          ]
        }
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

    await connection.send({ message: userMessage() })
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
          messageMetadata: {
            totalTokens: 20,
            promptTokens: 15,
            completionTokens: 5,
            noCacheTokens: 10,
            cacheReadTokens: 2,
            cacheWriteTokens: 3
          }
        }
      }
    })
    await expect(events.next()).resolves.toMatchObject({
      value: { type: 'turn-complete' }
    })
    await expect(events.next()).resolves.toMatchObject({
      value: { type: 'context-usage', usage: contextUsage }
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

  it('maps an SDK commands_changed message to a supported-commands event without an active turn', async () => {
    const queryQueue = createAsyncQueue<any>()
    const query = { ...queryQueue.iterable, interrupt: vi.fn(), close: vi.fn() }
    mocks.createClaudeQuery.mockReturnValue(query)
    const connection = await new ClaudeCodeRuntimeDriver().connect({
      sessionId: 'session-1',
      agentId: 'agent-1',
      modelId: 'claude-code::sonnet' as any
    })
    const events = connection.events[Symbol.asyncIterator]()

    // No `send()` → no adapter (the primed, turn-less case). The mid-session push must still surface so
    // the catalog refreshes; `supportedCommands()` alone would miss it (captured once at init).
    const commands = [{ name: 'deploy', description: 'Deploy the app', argumentHint: '' }]
    queryQueue.push({ type: 'system', subtype: 'commands_changed', commands, session_id: 'resume-1' })

    await expect(events.next()).resolves.toMatchObject({
      value: { type: 'supported-commands', commands }
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

  describe('reconcile — permission-mode applier discipline', () => {
    function makeSnapshot(initialMode: string | undefined) {
      let mode = initialMode
      return {
        update: vi.fn(async (agent: any) => {
          mode = agent.configuration?.permission_mode
        }),
        getPermissionMode: vi.fn(() => mode),
        setPermissionMode: vi.fn((next: string | undefined) => {
          mode = next
        })
      }
    }

    async function connectWith(snapshot: ReturnType<typeof makeSnapshot>, setPermissionMode: any) {
      mocks.buildRequest.mockResolvedValueOnce({
        connectionConfig: desiredPolicy(snapshot.getPermissionMode() ?? null).config,
        key: 'warm-key',
        options: { model: 'sonnet' },
        settings: { toolPolicySnapshot: snapshot },
        sdkModelId: 'sonnet-sdk',
        initializeTimeoutMs: 100
      })
      const queryQueue = createAsyncQueue<any>()
      const query = { ...queryQueue.iterable, interrupt: vi.fn(), close: vi.fn(), setPermissionMode }
      mocks.createClaudeQuery.mockReturnValue(query)
      return new ClaudeCodeRuntimeDriver().connect({
        sessionId: 'session-1',
        agentId: 'agent-1',
        modelId: 'claude-code::sonnet' as any
      })
    }

    function desiredPolicy(permissionMode: string | null) {
      return {
        ok: true as const,
        config: {
          rebuildSignature: 'sig-1',
          live: { toolPolicy: { permissionMode, disabledTools: [], mcps: [] } }
        }
      }
    }

    it('awaits the SDK call before mutating the snapshot', async () => {
      const snapshot = makeSnapshot('default')
      const updatedAgent = { id: 'agent-1', configuration: { permission_mode: 'acceptEdits' } }
      mocks.getAgent.mockReturnValue(updatedAgent)
      const setPermissionMode = vi.fn().mockImplementation(async () => {
        expect(snapshot.update).not.toHaveBeenCalled()
        expect(snapshot.getPermissionMode()).toBe('default')
      })
      const connection = await connectWith(snapshot, setPermissionMode)

      mocks.deriveConfig.mockResolvedValue(desiredPolicy('acceptEdits'))
      await expect(connection.reconcile({ modelId: 'claude-code::sonnet' as any })).resolves.toBe('patched')

      expect(setPermissionMode).toHaveBeenCalledWith('acceptEdits')
      expect(snapshot.update).toHaveBeenCalledWith(updatedAgent)
      expect(snapshot.getPermissionMode()).toBe('acceptEdits')
      expect(setPermissionMode.mock.invocationCallOrder[0]).toBeLessThan(snapshot.update.mock.invocationCallOrder[0])

      void connection.close()
    })

    it('does NOT mutate the snapshot when the SDK setPermissionMode rejects', async () => {
      const snapshot = makeSnapshot('default')
      mocks.getAgent.mockReturnValue({ id: 'agent-1', configuration: { permission_mode: 'acceptEdits' } })
      const setPermissionMode = vi.fn().mockRejectedValue(new Error('SDK refused'))
      const connection = await connectWith(snapshot, setPermissionMode)

      mocks.deriveConfig.mockResolvedValue(desiredPolicy('acceptEdits'))
      await expect(connection.reconcile({ modelId: 'claude-code::sonnet' as any })).resolves.toBe('failed')
      // Fail-closed: the snapshot (which gates canUseTool) keeps the old mode the running query
      // never moved off of — it must NOT be advanced to the unconfirmed tighten/loosen.
      expect(snapshot.update).not.toHaveBeenCalled()
      expect(snapshot.getPermissionMode()).toBe('default')

      void connection.close()
    })

    it('short-circuits an unchanged permission mode without an SDK round-trip', async () => {
      const snapshot = makeSnapshot('acceptEdits')
      const setPermissionMode = vi.fn().mockResolvedValue(undefined)
      const connection = await connectWith(snapshot, setPermissionMode)

      // Facts differ only in disabledTools — the snapshot heals, but the mode is already in sync.
      mocks.deriveConfig.mockResolvedValue({
        ok: true,
        config: {
          rebuildSignature: 'sig-1',
          live: { toolPolicy: { permissionMode: 'acceptEdits', disabledTools: ['WebSearch'], mcps: [] } }
        }
      })
      await expect(connection.reconcile({ modelId: 'claude-code::sonnet' as any })).resolves.toBe('patched')

      expect(snapshot.update).toHaveBeenCalled()
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
    await connection.send({ message: userMessage() })
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

  it('logs non-salvage SDK failures before surfacing the runtime error', async () => {
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
    await events.next()
    await connection.send({ message: userMessage() })
    await events.next()

    queryQueue.push({ type: 'result', subtype: 'error_during_execution', session_id: 'resume-init', usage: {} })

    await expect(events.next()).resolves.toMatchObject({ value: { type: 'chunk', chunk: { type: 'finish' } } })
    await expect(events.next()).resolves.toMatchObject({ value: { type: 'error' } })
    expect(mockMainLoggerService.error).toHaveBeenCalledWith(
      'Claude Code query loop failed',
      expect.objectContaining({ sessionId: 'session-1', modelId: 'sonnet-sdk', error: expect.any(Error) })
    )
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

  it('redirect only stashes text steers while a turn is active', async () => {
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
    await connection.send({ message: userMessage() })
    expect(connection.redirect?.({ message: userMessage() })).toBe(true)
    expect(steerHolder.pending).toHaveLength(1)

    const attachmentSteer = {
      message: {
        ...userMessage(),
        id: 'user-2',
        data: {
          parts: [
            { type: 'text', text: 'look at this' },
            { type: 'file', url: 'file:///tmp/pixel.png', mediaType: 'image/png', filename: 'pixel.png' }
          ]
        }
      },
      systemReminder: true
    }
    expect(connection.redirect?.(attachmentSteer)).toBe(false)
    expect(steerHolder.pending).toHaveLength(1)

    void connection.close()
    expect(steerHolder.dispose).toHaveBeenCalled()
  })

  it('emits pending text steers as undelivered before tearing down after a query error', async () => {
    const queryQueue = createAsyncQueue<any>()
    const query = { ...queryQueue.iterable, interrupt: vi.fn(), close: vi.fn() }
    const steerHolder = { pending: [] as any[], dispose: vi.fn() }
    steerHolder.dispose.mockImplementation(() => {
      steerHolder.pending = []
    })
    mocks.createClaudeQuery.mockReturnValue(query)
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
    const steer = {
      message: {
        ...userMessage(),
        id: 'user-2',
        data: {
          parts: [{ type: 'text', text: 'change direction' }]
        }
      },
      systemReminder: true
    }

    await connection.send({ message: userMessage() })
    expect(connection.redirect?.(steer)).toBe(true)
    queryQueue.push({ type: 'result', subtype: 'error_during_execution', session_id: 'resume-1', usage: {} })

    const seen: any[] = []
    for (;;) {
      const { value, done } = await events.next()
      if (done) break
      seen.push(value)
      if (value?.type === 'error') break
    }

    const undeliveredIndex = seen.findIndex((event) => event?.type === 'steer-undelivered')
    const errorIndex = seen.findIndex((event) => event?.type === 'error')
    expect(undeliveredIndex).toBeGreaterThanOrEqual(0)
    expect(errorIndex).toBeGreaterThan(undeliveredIndex)
    expect(seen[undeliveredIndex]).toEqual({ type: 'steer-undelivered', inputs: [steer] })
    expect(steerHolder.pending).toHaveLength(0)
    expect(steerHolder.dispose).toHaveBeenCalledTimes(1)

    void connection.close()
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
    await connection.send({ message: userMessage() })
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

    await connection.send({ message: userMessage() })
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

    await connection.send({ message: userMessage() })
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
    await connection.send({ message: userMessage() })
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

  it('runs the session teardown once — a late close after a query-loop error must not re-dispose', async () => {
    const queryQueue = createAsyncQueue<any>()
    const query = { ...queryQueue.iterable, interrupt: vi.fn(), close: vi.fn() }
    const approvalEmitter: any = { dispose: vi.fn() }
    const steerHolder = { pending: [] as unknown[], dispose: vi.fn() }
    mocks.createClaudeQuery.mockReturnValue(query)
    mocks.buildRequest.mockResolvedValue({
      key: 'warm-key',
      options: { model: 'sonnet' },
      settings: { approvalEmitter, steerHolder },
      sdkModelId: 'sonnet-sdk',
      initializeTimeoutMs: 100
    })
    const connection = await new ClaudeCodeRuntimeDriver().connect({
      sessionId: 'session-1',
      agentId: 'agent-1',
      modelId: 'claude-code::sonnet' as any
    })
    const events = connection.events[Symbol.asyncIterator]()

    // The query loop dies (failed result) → first teardown disposes the session-scoped state.
    void connection.send({ message: userMessage() })
    queryQueue.push({ type: 'result', subtype: 'error', session_id: 'resume-1' })
    let evt = await events.next()
    while (evt.value?.type !== 'error' && !evt.done) evt = await events.next()
    expect(approvalEmitter.dispose).toHaveBeenCalledTimes(1)

    // Regression: by the time the host's close() lands, a successor connection for the same session
    // (e.g. a model-edit reconnect) may have registered fresh session-keyed state — a second by-id
    // teardown would dispose the successor's approvals/snapshot, so it must no-op.
    void connection.close()
    expect(approvalEmitter.dispose).toHaveBeenCalledTimes(1)
    expect(steerHolder.dispose).toHaveBeenCalledTimes(1)
  })

  describe('reconcile', () => {
    function makeConfig(overrides: { signature?: string; permissionMode?: string | null; disabledTools?: string[] }) {
      return {
        ok: true as const,
        config: {
          rebuildSignature: overrides.signature ?? 'sig-1',
          live: {
            toolPolicy: {
              permissionMode: overrides.permissionMode ?? null,
              disabledTools: overrides.disabledTools ?? [],
              mcps: []
            }
          }
        }
      }
    }

    async function connectWithSnapshot() {
      const queryQueue = createAsyncQueue<any>()
      const query = { ...queryQueue.iterable, interrupt: vi.fn(), close: vi.fn(), setPermissionMode: vi.fn() }
      const toolPolicySnapshot = {
        update: vi.fn().mockResolvedValue(undefined),
        getPermissionMode: vi.fn(() => undefined),
        setPermissionMode: vi.fn()
      }
      mocks.createClaudeQuery.mockReturnValue(query)
      mocks.buildRequest.mockResolvedValue({
        connectionConfig: makeConfig({}).config,
        key: 'warm-key',
        options: { model: 'sonnet' },
        settings: { toolPolicySnapshot },
        sdkModelId: 'sonnet-sdk'
      })
      const connection = await new ClaudeCodeRuntimeDriver().connect({
        sessionId: 'session-1',
        agentId: 'agent-1',
        modelId: 'claude-code::sonnet' as any
      })
      return { connection, query, toolPolicySnapshot }
    }

    it('returns current when the derived config matches the connect-time baseline', async () => {
      const { connection, query } = await connectWithSnapshot()

      await expect(connection.reconcile({ modelId: 'claude-code::sonnet' as any })).resolves.toBe('current')
      expect(query.setPermissionMode).not.toHaveBeenCalled()
    })

    it('hot-patches live tool-policy facts and advances the baseline', async () => {
      const { connection, query, toolPolicySnapshot } = await connectWithSnapshot()

      mocks.deriveConfig.mockResolvedValue(makeConfig({ permissionMode: 'acceptEdits' }))
      await expect(connection.reconcile({ modelId: 'claude-code::sonnet' as any })).resolves.toBe('patched')
      // SDK first, snapshot second — the fail-closed ordering applyPolicyUpdate established.
      expect(toolPolicySnapshot.update).toHaveBeenCalled()
      expect(query.setPermissionMode).toHaveBeenCalledWith('acceptEdits')
      expect(query.setPermissionMode.mock.invocationCallOrder[0]).toBeLessThan(
        toolPolicySnapshot.update.mock.invocationCallOrder[0]
      )

      // Baseline advanced: the same desired config is now 'current', not re-patched.
      query.setPermissionMode.mockClear()
      await expect(connection.reconcile({ modelId: 'claude-code::sonnet' as any })).resolves.toBe('current')
      expect(query.setPermissionMode).not.toHaveBeenCalled()
    })

    it('applies a permission tighten BEFORE reporting rebuild for a combined update', async () => {
      const { connection, query } = await connectWithSnapshot()

      // One agent edit changed both a baked input (signature) and the permission mode.
      mocks.deriveConfig.mockResolvedValue(makeConfig({ signature: 'sig-2', permissionMode: 'plan' }))

      await expect(connection.reconcile({ modelId: 'claude-code::sonnet' as any })).resolves.toBe('rebuild')
      // The tighten must not be deferred behind the rebuild a live turn may postpone.
      expect(query.setPermissionMode).toHaveBeenCalledWith('plan')
    })

    it('fails closed when the live patch cannot be applied', async () => {
      const { connection, query, toolPolicySnapshot } = await connectWithSnapshot()

      query.setPermissionMode.mockRejectedValue(new Error('control channel down'))
      mocks.deriveConfig.mockResolvedValue(makeConfig({ permissionMode: 'acceptEdits' }))

      await expect(connection.reconcile({ modelId: 'claude-code::sonnet' as any })).resolves.toBe('failed')
      // Snapshot untouched — mutating it before SDK confirmation would fork local policy.
      expect(toolPolicySnapshot.update).not.toHaveBeenCalled()
    })

    it('compares against the materialized request baseline when configuration changes during connect', async () => {
      mocks.buildRequest.mockResolvedValue({
        connectionConfig: makeConfig({ signature: 'materialized-sig' }).config,
        key: 'warm-key',
        options: { model: 'sonnet' },
        settings: {},
        sdkModelId: 'sonnet-sdk'
      })
      const queryQueue = createAsyncQueue<any>()
      mocks.createClaudeQuery.mockReturnValue({
        ...queryQueue.iterable,
        interrupt: vi.fn(),
        close: vi.fn(),
        setPermissionMode: vi.fn()
      })
      mocks.deriveConfig.mockResolvedValue(makeConfig({ signature: 'edited-during-connect' }))

      const connection = await new ClaudeCodeRuntimeDriver().connect({
        sessionId: 'session-1',
        agentId: 'agent-1',
        modelId: 'claude-code::sonnet' as any
      })

      expect(mocks.deriveConfig).not.toHaveBeenCalled()
      await expect(connection.reconcile({ modelId: 'claude-code::sonnet' as any })).resolves.toBe('rebuild')
      expect(mocks.deriveConfig).toHaveBeenCalledTimes(1)
    })

    it('returns invalid when the desired config can no longer be derived', async () => {
      const { connection } = await connectWithSnapshot()

      mocks.deriveConfig.mockResolvedValue({ ok: false, reason: 'unroutable' })

      await expect(connection.reconcile({ modelId: 'claude-code::sonnet' as any })).resolves.toBe('invalid')
    })

    it('serializes concurrent reconciles instead of interleaving them', async () => {
      const { connection } = await connectWithSnapshot()

      let firstStarted = false
      let secondStarted = false
      let releaseFirst: () => void = () => {}
      const gate = new Promise<void>((resolve) => {
        releaseFirst = resolve
      })
      mocks.deriveConfig
        .mockImplementationOnce(async () => {
          firstStarted = true
          await gate
          return makeConfig({})
        })
        .mockImplementationOnce(async () => {
          secondStarted = true
          return makeConfig({})
        })

      const first = connection.reconcile({ modelId: 'claude-code::sonnet' as any })
      const second = connection.reconcile({ modelId: 'claude-code::sonnet' as any })
      await vi.waitFor(() => expect(firstStarted).toBe(true))

      // Push and pull overlapping on the same connection must queue — an interleaved
      // setPermissionMode/snapshot write pair could leave the gate and the subprocess split.
      expect(secondStarted).toBe(false)

      releaseFirst()
      await expect(first).resolves.toBe('current')
      await expect(second).resolves.toBe('current')
      expect(secondStarted).toBe(true)
    })
  })
})
