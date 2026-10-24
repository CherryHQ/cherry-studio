import { beforeEach, describe, expect, it, vi } from 'vitest'

import type * as SettingsBuilderModule from '../settingsBuilder'

const mocks = vi.hoisted(() => ({
  buildRequest: vi.fn(),
  consumeWarmQuery: vi.fn(),
  createClaudeQuery: vi.fn(),
  materializeNativeFilePart: vi.fn()
}))

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  const mock = mockApplicationFactory()
  mock.application.get.mockImplementation((name: string) => {
    if (name === 'ClaudeCodeWarmQueryManager') return { consume: mocks.consumeWarmQuery }
    if (name === 'ClaudeCodeTraceBridgeService') return { prepareTrace: vi.fn(), refreshTraceContext: vi.fn() }
    if (name === 'ClaudeCodeProcessManager') return { spawn: vi.fn() }
    if (name === 'ClaudeCodeSessionStateService') return { disposeToolPolicySnapshot: vi.fn() }
    return mock.application.getContainer().get(name)
  })
  return mock
})

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: mocks.createClaudeQuery
}))

vi.mock('../agentSessionWarmup', () => ({
  buildClaudeCodeQueryRequestForAgentSession: mocks.buildRequest,
  deriveConnectionConfig: vi.fn(),
  toolPolicyFactsEqual: (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
}))

vi.mock('@data/services/AgentService', () => ({
  agentService: { getAgent: vi.fn() }
}))

vi.mock('@data/services/ModelService', () => ({
  modelService: {
    getByKey: () => {
      throw new Error('unresolved in test')
    }
  }
}))

vi.mock('@main/ai/messages/fileProcessor', () => ({
  materializeNativeFilePart: mocks.materializeNativeFilePart
}))

vi.mock('../settingsBuilder', async (importActual) => ({
  ...(await importActual<typeof SettingsBuilderModule>()),
  registerMcpSessionCatalogSync: vi.fn(),
  disposeToolPolicySnapshot: vi.fn()
}))

const { ClaudeCodeRuntimeDriver } = await import('../ClaudeCodeRuntimeDriver')

const hostAssistantUuid = '9ad4b714-fe5d-4664-9f76-2b0cd13f4c03'
const foreignAssistantUuid = '20249b48-e174-4610-84c2-af6224228290'
const lateForeignAssistantUuid = 'b7c1d2e3-4f56-4789-8abc-def012345678'
const otherUserMessageUuid = '22222222-2222-4222-8222-222222222222'
const zeroUsage = { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }

function createAsyncQueue<T>() {
  const items: T[] = []
  const waiters: Array<(value: IteratorResult<T>) => void> = []
  let closed = false
  const close = () => {
    closed = true
    while (waiters.length > 0) waiters.shift()?.({ value: undefined as T, done: true })
  }
  return {
    push(item: T) {
      const waiter = waiters.shift()
      if (waiter) waiter({ value: item, done: false })
      else items.push(item)
    },
    iterable: {
      return: vi.fn(async () => {
        close()
        return { value: undefined, done: true } as IteratorResult<T>
      }),
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

function userMessage(text = 'hello') {
  return {
    id: 'user-1',
    topicId: 'agent-session:session-1',
    parentId: null,
    role: 'user',
    data: { parts: [{ type: 'text', text }] },
    status: 'success',
    createdAt: '',
    updatedAt: ''
  } as any
}

function stream(event: Record<string, unknown>, userMessageUuid?: string) {
  return {
    type: 'stream_event',
    event,
    parent_tool_use_id: null,
    session_id: 'sdk-1',
    uuid: crypto.randomUUID(),
    ...(userMessageUuid ? { user_message_uuid: userMessageUuid } : {})
  }
}

function textFrames(text: string) {
  return [
    stream({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }),
    stream({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } }),
    stream({ type: 'content_block_stop', index: 0 }),
    stream({ type: 'message_stop' })
  ]
}

describe('Claude Code host-turn correlation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.consumeWarmQuery.mockResolvedValue(undefined)
    mocks.materializeNativeFilePart.mockResolvedValue(null)
    mocks.buildRequest.mockResolvedValue({
      connectionConfig: {
        rebuildSignature: 'sig-1',
        live: { toolPolicy: { permissionMode: null, disabledTools: [], mcps: [] } }
      },
      key: 'warm-key',
      options: { model: 'sonnet', env: { CLAUDE_CONFIG_DIR: '/tmp/claude-correlation' } },
      settings: {},
      sdkModelId: 'sonnet-sdk',
      initializeTimeoutMs: 100,
      usageCapture: {
        owner: 'agent-sdk',
        credentialReceipt: { attribution: 'explicit', id: 'key-a', masked: 'key-***' },
        providerId: 'anthropic',
        providerName: 'Anthropic',
        source: null,
        frozenModels: [
          {
            modelId: 'sonnet',
            apiModelId: 'sonnet-sdk',
            modelName: 'Sonnet',
            pricingSnapshot: null,
            aliases: ['sonnet-sdk']
          }
        ]
      }
    })
  })

  it('keeps foreign frames, including an assistant after the host assistant, out of content, usage, and the fork checkpoint', async () => {
    const queryQueue = createAsyncQueue<any>()
    mocks.createClaudeQuery.mockReturnValue({ ...queryQueue.iterable, interrupt: vi.fn(), close: vi.fn() })
    const connection = await new ClaudeCodeRuntimeDriver().connect({
      sessionId: 'session-1',
      agentId: 'agent-1',
      modelId: 'claude-code::sonnet'
    })
    const sdkInput = mocks.createClaudeQuery.mock.calls[0][0].prompt
    const written = sdkInput[Symbol.asyncIterator]().next()
    const seen: any[] = []
    const completed = (async () => {
      for await (const event of connection.events) {
        seen.push(event)
        if (event.type === 'turn-complete') return event
      }
      throw new Error('missing turn completion')
    })()

    try {
      await connection.send({ message: userMessage() })
      const hostUserMessageUuid = (await written).value.uuid as string
      expect(hostUserMessageUuid).toEqual(expect.any(String))

      queryQueue.push(
        stream({ type: 'message_start', message: { id: 'foreign-req', usage: zeroUsage } }, otherUserMessageUuid)
      )
      for (const frame of textFrames('nope')) queryQueue.push(frame)
      queryQueue.push(
        stream({
          type: 'message_delta',
          delta: { stop_reason: 'end_turn' },
          usage: { input_tokens: 4, output_tokens: 2, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }
        })
      )
      queryQueue.push({
        type: 'assistant',
        uuid: foreignAssistantUuid,
        parent_tool_use_id: null,
        user_message_uuid: otherUserMessageUuid,
        message: {
          id: 'foreign-req',
          model: 'sonnet-sdk',
          stop_reason: 'end_turn',
          content: [{ type: 'text', text: 'nope' }],
          usage: { input_tokens: 4, output_tokens: 2, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }
        }
      })

      queryQueue.push(
        stream({ type: 'message_start', message: { id: 'our-req', usage: zeroUsage } }, hostUserMessageUuid)
      )
      for (const frame of textFrames('yes')) queryQueue.push(frame)
      queryQueue.push({
        type: 'assistant',
        uuid: hostAssistantUuid,
        parent_tool_use_id: null,
        user_message_uuid: hostUserMessageUuid,
        message: {
          id: 'our-req',
          model: 'sonnet-sdk',
          stop_reason: 'end_turn',
          content: [{ type: 'text', text: 'yes' }],
          usage: { input_tokens: 3, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }
        }
      })
      // After the host assistant, so a later foreign uuid cannot replace the fork checkpoint.
      queryQueue.push({
        type: 'assistant',
        uuid: lateForeignAssistantUuid,
        parent_tool_use_id: null,
        user_message_uuid: otherUserMessageUuid,
        message: {
          id: 'late-foreign',
          model: 'sonnet-sdk',
          stop_reason: 'end_turn',
          content: [{ type: 'text', text: 'foreign-late' }],
          usage: { input_tokens: 8, output_tokens: 9, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }
        }
      })
      queryQueue.push({
        type: 'result',
        subtype: 'success',
        is_error: false,
        num_turns: 1,
        result: 'yes',
        stop_reason: 'end_turn',
        duration_ms: 20,
        duration_api_ms: 10,
        total_cost_usd: 3.1183,
        usage: { input_tokens: 3, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
        modelUsage: {},
        permission_denials: [],
        session_id: 'sdk-session',
        uuid: crypto.randomUUID(),
        user_message_uuid: hostUserMessageUuid
      })

      const completion = await completed
      const text = seen
        .filter((event) => event.type === 'chunk' && event.chunk?.type === 'text-delta')
        .map((event) => event.chunk.delta)
        .join('')
      const requestIds = seen.filter((event) => event.type === 'usage').map((event) => event.invocation.requestId)

      const usageOutputs = seen
        .filter((event) => event.type === 'usage')
        .map((event) => event.invocation.usage.outputTokens)

      expect(text).toContain('yes')
      expect(text).not.toContain('nope')
      expect(text).not.toContain('foreign-late')
      expect(requestIds).toEqual(['claude-agent:our-req'])
      expect(usageOutputs).toEqual([1])
      expect(completion.forkAnchor).toMatchObject({
        checkpoint: { messageUuid: hostAssistantUuid, runtimeSessionId: 'sdk-session' }
      })
    } finally {
      await connection.close()
    }
  })

  it('does not finish on a hook stop or local command that arrives before the attachment is queued', async () => {
    const queryQueue = createAsyncQueue<any>()
    mocks.createClaudeQuery.mockReturnValue({ ...queryQueue.iterable, interrupt: vi.fn(), close: vi.fn() })
    let releaseMaterialize: (value: null) => void = () => {}
    mocks.materializeNativeFilePart.mockImplementation(
      () =>
        new Promise((resolve) => {
          releaseMaterialize = resolve
        })
    )
    const connection = await new ClaudeCodeRuntimeDriver().connect({
      sessionId: 'session-1',
      agentId: 'agent-1',
      modelId: 'claude-code::sonnet'
    })
    const seen: any[] = []
    const completed = (async () => {
      for await (const event of connection.events) {
        seen.push(event)
        if (event.type === 'turn-complete' || event.type === 'error') return event
      }
      throw new Error('missing turn completion')
    })()

    try {
      const sending = connection.send({
        message: {
          ...userMessage('/status'),
          data: {
            parts: [
              { type: 'text', text: 'hello' },
              { type: 'file', url: 'file:///tmp/pixel.png', mediaType: 'image/png', filename: 'pixel.png' }
            ]
          }
        }
      })
      await vi.waitFor(() => expect(mocks.materializeNativeFilePart).toHaveBeenCalled())
      queryQueue.push({
        type: 'result',
        subtype: 'success',
        is_error: false,
        num_turns: 0,
        result: '',
        stop_reason: 'end_turn',
        duration_ms: 5,
        duration_api_ms: 0,
        total_cost_usd: 3.1183,
        terminal_reason: 'hook_stopped',
        usage: zeroUsage,
        modelUsage: {},
        permission_denials: [],
        session_id: 'sdk-session',
        uuid: crypto.randomUUID()
      })
      queryQueue.push({
        type: 'result',
        subtype: 'success',
        is_error: false,
        num_turns: 0,
        result: '',
        stop_reason: 'end_turn',
        duration_ms: 5,
        duration_api_ms: 0,
        total_cost_usd: 3.1183,
        local_command: '/status',
        usage: zeroUsage,
        modelUsage: {},
        permission_denials: [],
        session_id: 'sdk-session',
        uuid: crypto.randomUUID()
      })
      await vi.waitFor(() => expect(seen.some((event) => event.type === 'resume-token')).toBe(true))
      expect(seen.some((event) => event.type === 'turn-complete')).toBe(false)
      expect(seen.some((event) => event.type === 'chunk' && event.chunk?.type === 'finish')).toBe(false)

      releaseMaterialize(null)
      await sending
      queryQueue.push({
        type: 'result',
        subtype: 'success',
        is_error: false,
        num_turns: 0,
        result: '',
        stop_reason: 'end_turn',
        duration_ms: 5,
        duration_api_ms: 0,
        total_cost_usd: 3.1183,
        usage: zeroUsage,
        modelUsage: {},
        permission_denials: [],
        session_id: 'sdk-session',
        uuid: crypto.randomUUID()
      })

      await expect(completed).resolves.toMatchObject({ type: 'turn-complete' })
    } finally {
      releaseMaterialize(null)
      await connection.close()
    }
  })

  it.each([
    ['/cost', '/usage'],
    ['/my-plugin:my-skill', '/my-plugin:my-skill']
  ])('finishes a queued slash send %s when the CLI reports %s', async (text, localCommand) => {
    const queryQueue = createAsyncQueue<any>()
    mocks.createClaudeQuery.mockReturnValue({ ...queryQueue.iterable, interrupt: vi.fn(), close: vi.fn() })
    const connection = await new ClaudeCodeRuntimeDriver().connect({
      sessionId: 'session-1',
      agentId: 'agent-1',
      modelId: 'claude-code::sonnet'
    })
    const seen: any[] = []
    const completed = (async () => {
      for await (const event of connection.events) {
        seen.push(event)
        if (event.type === 'turn-complete' || event.type === 'error') return event
      }
      throw new Error('missing turn completion')
    })()

    try {
      await connection.send({ message: userMessage(text) })
      queryQueue.push({
        type: 'result',
        subtype: 'success',
        is_error: false,
        num_turns: 0,
        result: '',
        stop_reason: 'end_turn',
        duration_ms: 5,
        duration_api_ms: 0,
        total_cost_usd: 3.1183,
        local_command: localCommand,
        usage: zeroUsage,
        modelUsage: {},
        permission_denials: [],
        session_id: 'sdk-session',
        uuid: crypto.randomUUID()
      })

      await expect(completed).resolves.toMatchObject({ type: 'turn-complete' })
      expect(seen.some((event) => event.type === 'chunk' && event.chunk?.type === 'finish')).toBe(true)
    } finally {
      await connection.close()
    }
  })
})
