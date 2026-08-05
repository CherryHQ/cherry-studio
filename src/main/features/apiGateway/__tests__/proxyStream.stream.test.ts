import type { MessageCreateParams } from '@anthropic-ai/sdk/resources/messages'
import type { StreamListener } from '@main/ai/streamManager/types'
import type { CherryUIMessage } from '@shared/data/types/message'
import { createUniqueModelId, ENDPOINT_TYPE, type EndpointType } from '@shared/data/types/model'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Exercises the streaming path of `processMessage`: the `ReadableStream` wiring,
 * the `SseListener` push → adapter/formatter → SSE-frame flow, terminal close,
 * startup commitment, and `signal`-driven abort. The AiStreamManager, provider
 * lookup, and adapter factories are stubbed; the real listener/stream glue runs.
 */

const {
  mockStreamPrompt,
  mockAbort,
  mockGetProvider,
  mockListModels,
  mockResolveAgentSessionUsage,
  mockIsInternalAgentRequest,
  mockToUIMessages,
  captured
} = vi.hoisted(() => ({
  mockStreamPrompt: vi.fn(),
  mockAbort: vi.fn(),
  mockGetProvider: vi.fn(),
  mockListModels: vi.fn(),
  mockResolveAgentSessionUsage: vi.fn(),
  mockIsInternalAgentRequest: vi.fn(),
  mockToUIMessages: vi.fn<(params: MessageCreateParams) => CherryUIMessage[]>(),
  captured: { listener: undefined as StreamListener | undefined }
}))

vi.mock('@application', () => ({
  application: {
    get: vi.fn((name: string) =>
      name === 'AiStreamManager'
        ? { streamPrompt: mockStreamPrompt, abort: mockAbort }
        : name === 'ApiGatewayService'
          ? {
              resolveAgentSessionUsage: mockResolveAgentSessionUsage,
              isInternalAgentRequest: mockIsInternalAgentRequest
            }
          : undefined
    )
  }
}))

vi.mock('@data/services/ProviderService', () => ({
  providerService: { getByProviderId: mockGetProvider }
}))

vi.mock('@data/services/ModelService', () => ({
  modelService: { list: mockListModels }
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: vi.fn(() => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }))
  }
}))

// Deterministic converter + adapter + formatter so frame output is predictable.
vi.mock('../adapters', () => ({
  MessageConverterFactory: {
    create: () => ({
      toUIMessages: mockToUIMessages,
      toAiSdkTools: () => undefined,
      extractStreamOptions: () => ({}),
      extractProviderOptions: () => undefined
    })
  },
  StreamAdapterFactory: {
    createAdapter: () => ({
      transformChunk: (chunk: unknown) => [chunk],
      finalizeEvents: () => [],
      buildNonStreamingResponse: () => ({ done: true })
    }),
    getFormatter: () => ({
      formatEvent: (event: unknown) => `data: ${JSON.stringify(event)}\n\n`,
      formatDone: () => 'data: [DONE]\n\n'
    })
  }
}))

import { processMessage } from '../proxyStream'

function convertMockAnthropicMessages(params: MessageCreateParams): CherryUIMessage[] {
  const messages: CherryUIMessage[] = []

  params.messages.forEach((message, index) => {
    const parts: CherryUIMessage['parts'] = []
    if (typeof message.content === 'string') {
      if (message.content.length > 0) {
        parts.push({ type: 'text', text: message.content })
      }
    } else {
      for (const block of message.content) {
        if (block.type === 'text') {
          parts.push({ type: 'text', text: block.text })
        } else if (block.type === 'thinking') {
          parts.push({ type: 'reasoning', text: block.thinking })
        } else if (block.type === 'redacted_thinking') {
          parts.push({ type: 'reasoning', text: block.data })
        } else if (block.type === 'tool_use') {
          parts.push({
            type: 'dynamic-tool',
            toolName: block.name,
            toolCallId: block.id,
            state: 'input-available',
            input: block.input
          })
        }
      }
    }

    if (parts.length > 0) {
      messages.push({ id: `converted-${index}`, role: message.role, parts })
    }
  })

  return messages
}

beforeEach(() => {
  vi.clearAllMocks()
  captured.listener = undefined
  mockGetProvider.mockReturnValue({ id: 'openai', name: 'OpenAI', isEnabled: true })
  mockListModels.mockReturnValue([
    {
      id: createUniqueModelId('openai', 'gpt-4'),
      providerId: 'openai',
      apiModelId: 'gpt-4',
      capabilities: []
    }
  ])
  mockStreamPrompt.mockImplementation((opts: { listener: StreamListener }) => {
    captured.listener = opts.listener
  })
  mockResolveAgentSessionUsage.mockReturnValue(undefined)
  mockIsInternalAgentRequest.mockReturnValue(false)
  mockToUIMessages.mockImplementation(convertMockAnthropicMessages)
})

async function readAll(stream: ReadableStream<Uint8Array> | null): Promise<string> {
  if (!stream) return ''
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let out = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    out += decoder.decode(value, { stream: true })
  }
  return out
}

async function startStreaming(signal?: AbortSignal) {
  const response = processMessage({
    params: { model: 'openai:gpt-4', stream: true, messages: [] } as any,
    inputFormat: 'openai',
    outputFormat: 'openai',
    signal
  })
  await vi.waitFor(() => expect(captured.listener).toBeDefined())
  return { response, listener: captured.listener! }
}

function commit(listener: StreamListener): void {
  listener.onChunk({ type: 'text-delta', id: 't1', delta: 'hello' } as any)
}

const NO_PREFILL_CONTINUATION_TEXT =
  'Continue with the original user request above. The preceding assistant message is context, not a reply to complete.'

function useGatewayModel(apiModelId: string, endpointType: EndpointType = ENDPOINT_TYPE.ANTHROPIC_MESSAGES): void {
  mockGetProvider.mockReturnValue({ id: 'aihubmix', name: 'AiHubMix', isEnabled: true })
  mockListModels.mockReturnValue([
    {
      id: createUniqueModelId('aihubmix', apiModelId),
      providerId: 'aihubmix',
      apiModelId,
      capabilities: [],
      endpointTypes: [endpointType]
    }
  ])
}

function createAnthropicParams(
  apiModelId: string,
  messages: MessageCreateParams['messages'],
  streaming = true
): MessageCreateParams {
  return {
    model: `aihubmix:${apiModelId}`,
    max_tokens: 1024,
    messages,
    stream: streaming
  } as MessageCreateParams
}

async function processAndCaptureStreamMessages(
  params: MessageCreateParams,
  inputFormat: 'anthropic' | 'openai' = 'anthropic'
): Promise<CherryUIMessage[]> {
  const response = processMessage({
    params,
    inputFormat,
    outputFormat: 'anthropic',
    requestHeaders: new Headers({ 'x-cherry-internal-usage-token': 'proof' })
  })
  await vi.waitFor(() => expect(mockToUIMessages).toHaveBeenCalled())
  await vi.waitFor(() => expect(captured.listener).toBeDefined())

  if (params.stream === true) {
    commit(captured.listener!)
  }
  await captured.listener!.onDone({} as any)
  await response

  return mockStreamPrompt.mock.calls[0][0].messages as CherryUIMessage[]
}

describe('processMessage (no-prefill normalization)', () => {
  it('appends a continuation for an internal no-prefill Anthropic request without mutating config params', async () => {
    useGatewayModel('claude-opus-5')
    mockIsInternalAgentRequest.mockReturnValue(true)
    const params = createAnthropicParams('claude-opus-5', [
      { role: 'user', content: 'Build the requested feature' },
      { role: 'assistant', content: 'Deferred tools, agents, and skills context' }
    ])
    const snapshot = structuredClone(params)

    const messages = await processAndCaptureStreamMessages(params)

    expect(mockToUIMessages).toHaveBeenCalledWith(params)
    expect(messages).toEqual([
      { id: 'converted-0', role: 'user', parts: [{ type: 'text', text: 'Build the requested feature' }] },
      {
        id: 'converted-1',
        role: 'assistant',
        parts: [{ type: 'text', text: 'Deferred tools, agents, and skills context' }]
      },
      {
        id: 'no-prefill-continuation',
        role: 'user',
        parts: [{ type: 'text', text: NO_PREFILL_CONTINUATION_TEXT }]
      }
    ])
    expect(params).toEqual(snapshot)
  })

  it('appends after conversion when a trailing empty user message is dropped', async () => {
    useGatewayModel('claude-opus-5')
    mockIsInternalAgentRequest.mockReturnValue(true)
    const params = createAnthropicParams('claude-opus-5', [
      { role: 'user', content: 'Run the background agent task' },
      { role: 'assistant', content: 'Deferred tools, agents, and skills context' },
      { role: 'user', content: '' }
    ])
    const snapshot = structuredClone(params)

    const messages = await processAndCaptureStreamMessages(params)

    expect(mockToUIMessages.mock.calls[0][0]).toBe(params)
    expect(messages).toEqual([
      { id: 'converted-0', role: 'user', parts: [{ type: 'text', text: 'Run the background agent task' }] },
      {
        id: 'converted-1',
        role: 'assistant',
        parts: [{ type: 'text', text: 'Deferred tools, agents, and skills context' }]
      },
      {
        id: 'no-prefill-continuation',
        role: 'user',
        parts: [{ type: 'text', text: NO_PREFILL_CONTINUATION_TEXT }]
      }
    ])
    expect(params).toEqual(snapshot)
  })

  it('appends a continuation for an internal request without an active usage context', async () => {
    useGatewayModel('claude-opus-5')
    mockIsInternalAgentRequest.mockReturnValue(true)
    mockResolveAgentSessionUsage.mockReturnValue(undefined)
    const params = createAnthropicParams('claude-opus-5', [
      { role: 'user', content: 'Run the background agent task' },
      { role: 'assistant', content: 'Deferred tools, agents, and skills context' }
    ])

    const messages = await processAndCaptureStreamMessages(params)

    expect(messages.at(-1)).toEqual({
      id: 'no-prefill-continuation',
      role: 'user',
      parts: [{ type: 'text', text: NO_PREFILL_CONTINUATION_TEXT }]
    })
  })

  it('leaves an external gateway request unchanged', async () => {
    useGatewayModel('claude-opus-5')
    mockIsInternalAgentRequest.mockReturnValue(false)
    const params = createAnthropicParams('claude-opus-5', [
      { role: 'user', content: 'External request' },
      { role: 'assistant', content: 'Intentional prefill' }
    ])

    const messages = await processAndCaptureStreamMessages(params)

    expect(messages).toHaveLength(2)
    expect(messages.at(-1)).toMatchObject({ role: 'assistant' })
  })

  it('leaves Claude 4.5 prefill unchanged for an internal request', async () => {
    useGatewayModel('claude-opus-4-5')
    mockIsInternalAgentRequest.mockReturnValue(true)
    const params = createAnthropicParams('claude-opus-4-5', [
      { role: 'user', content: 'Original request' },
      { role: 'assistant', content: 'Supported prefill' }
    ])

    const messages = await processAndCaptureStreamMessages(params)

    expect(messages).toHaveLength(2)
    expect(messages.at(-1)).toMatchObject({ role: 'assistant' })
  })

  it('does not duplicate a continuation when the request already ends with a user message', async () => {
    useGatewayModel('claude-opus-5')
    mockIsInternalAgentRequest.mockReturnValue(true)
    const params = createAnthropicParams('claude-opus-5', [{ role: 'user', content: 'Original request' }])

    const messages = await processAndCaptureStreamMessages(params)

    expect(messages).toHaveLength(1)
    expect(messages.at(-1)).toMatchObject({ role: 'user' })
  })

  it('leaves a trailing assistant tool_use block unchanged', async () => {
    useGatewayModel('claude-opus-5')
    mockIsInternalAgentRequest.mockReturnValue(true)
    const params = createAnthropicParams('claude-opus-5', [
      { role: 'user', content: 'Original request' },
      {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'tool-1', name: 'read_file', input: { path: '/tmp/file' } }]
      }
    ])

    const messages = await processAndCaptureStreamMessages(params)

    expect(messages).toHaveLength(2)
    expect(messages.at(-1)).toMatchObject({
      role: 'assistant',
      parts: [expect.objectContaining({ type: 'dynamic-tool' })]
    })
  })

  it('leaves an OpenAI-compatible endpoint unchanged', async () => {
    useGatewayModel('claude-opus-5', ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS)
    mockIsInternalAgentRequest.mockReturnValue(true)
    const params = createAnthropicParams('claude-opus-5', [
      { role: 'user', content: 'Original request' },
      { role: 'assistant', content: 'Intentional prefill' }
    ])

    const messages = await processAndCaptureStreamMessages(params)

    expect(messages).toHaveLength(2)
    expect(messages.at(-1)).toMatchObject({ role: 'assistant' })
  })

  it('leaves a non-Anthropic input format unchanged', async () => {
    useGatewayModel('claude-opus-5')
    mockIsInternalAgentRequest.mockReturnValue(true)
    const params = createAnthropicParams('claude-opus-5', [
      { role: 'user', content: 'Original request' },
      { role: 'assistant', content: 'Intentional prefill' }
    ])

    const messages = await processAndCaptureStreamMessages(params, 'openai')

    expect(messages).toHaveLength(2)
    expect(messages.at(-1)).toMatchObject({ role: 'assistant' })
  })

  it.each([true, false])('normalizes before the streaming branch when stream is %s', async (streaming) => {
    useGatewayModel('claude-opus-5')
    mockIsInternalAgentRequest.mockReturnValue(true)
    const params = createAnthropicParams(
      'claude-opus-5',
      [
        { role: 'user', content: 'Original request' },
        { role: 'assistant', content: 'Deferred tools context' }
      ],
      streaming
    )

    const messages = await processAndCaptureStreamMessages(params)

    expect(messages).toHaveLength(3)
    expect(messages.at(-1)).toEqual({
      id: 'no-prefill-continuation',
      role: 'user',
      parts: [{ type: 'text', text: NO_PREFILL_CONTINUATION_TEXT }]
    })
  })
})

describe('processMessage (streaming)', () => {
  it('passes validated internal agent-session correlation to provider-call usage capture', async () => {
    const usageContext = {
      agentSessionId: 'session-1',
      source: { type: 'agent', id: 'agent-1', name: 'Original Agent', icon: '🧠' }
    }
    mockResolveAgentSessionUsage.mockReturnValue(usageContext)
    const requestHeaders = new Headers({ 'x-cherry-internal-usage-token': 'proof' })
    const response = processMessage({
      params: { model: 'openai:gpt-4', stream: true, messages: [] } as any,
      inputFormat: 'openai',
      outputFormat: 'openai',
      requestHeaders
    })
    await vi.waitFor(() => expect(captured.listener).toBeDefined())

    expect(mockResolveAgentSessionUsage).toHaveBeenCalledWith(requestHeaders)
    expect(mockStreamPrompt).toHaveBeenCalledWith(expect.objectContaining({ usageContext }))

    commit(captured.listener!)
    await captured.listener!.onDone({} as any)
    await response
  })

  it('buffers protocol scaffolding until a semantic chunk, then flushes frames + done marker', async () => {
    const { response, listener } = await startStreaming()

    listener.onChunk({ type: 'start' } as any)
    commit(listener)
    await listener.onDone({} as any)

    const res = await response
    expect(res.headers.get('Content-Type')).toBe('text/event-stream')
    expect(mockStreamPrompt).toHaveBeenCalledOnce()

    const text = await readAll(res.body)
    expect(text).toContain('"type":"start"')
    expect(text).toContain('"type":"text-delta"')
    expect(text).toContain('hello')
    expect(text).toContain('data: [DONE]')
  })

  it.each([
    'text-start',
    'text-delta',
    'text-end',
    'reasoning-start',
    'reasoning-delta',
    'reasoning-end',
    'tool-input-available',
    'finish'
  ])('commits on the semantic %s chunk', async (type) => {
    const { response, listener } = await startStreaming()

    listener.onChunk({ type, id: 'part-1' } as any)
    const res = await response
    await listener.onDone({} as any)

    expect(res.headers.get('Content-Type')).toBe('text/event-stream')
    await readAll(res.body)
  })

  it('returns a finalized empty successful stream when done arrives before a semantic chunk', async () => {
    const { response, listener } = await startStreaming()

    await listener.onDone({} as any)

    const res = await response
    await expect(readAll(res.body)).resolves.toBe('data: [DONE]\n\n')
  })

  it('does not start the upstream stream when the request is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()

    const res = await processMessage({
      params: { model: 'openai:gpt-4', stream: true, messages: [] } as any,
      inputFormat: 'openai',
      outputFormat: 'openai',
      signal: controller.signal
    })

    expect(mockStreamPrompt).not.toHaveBeenCalled()
    await expect(readAll(res.body)).resolves.toBe('')
  })

  it('settles as an empty response when the client aborts before commitment', async () => {
    const controller = new AbortController()
    const { response } = await startStreaming(controller.signal)

    controller.abort()

    const res = await response
    expect(mockAbort).toHaveBeenCalledOnce()
    await expect(readAll(res.body)).resolves.toBe('')
  })

  it('passes the 20-minute idle timeout to streamPrompt', async () => {
    const { response, listener } = await startStreaming()
    commit(listener)
    await response

    expect(mockStreamPrompt.mock.calls[0][0]).toMatchObject({ idleTimeoutMs: 20 * 60_000 })
  })

  it('marks streaming requests as caller-owned', async () => {
    const { response, listener } = await startStreaming()
    commit(listener)
    await response

    expect(mockStreamPrompt).toHaveBeenCalledWith(expect.objectContaining({ contextOwner: 'caller' }))
  })

  it('returns JSON (not a stream) for non-streaming requests', async () => {
    const resPromise = processMessage({
      params: { model: 'openai:gpt-4', messages: [] } as any,
      inputFormat: 'openai',
      outputFormat: 'openai'
    })

    await vi.waitFor(() => expect(captured.listener).toBeDefined())
    await captured.listener!.onDone({} as any)

    const res = await resPromise
    expect(res.headers.get('Content-Type')).toBe('application/json')
    await expect(res.json()).resolves.toEqual({ done: true })
  })
})

describe('processMessage (error & pause)', () => {
  it('rejects the original provider error before semantic commitment', async () => {
    const { response, listener } = await startStreaming()
    const error = { name: 'AI_APICallError', message: 'Provider rejected the request', stack: null, statusCode: 400 }

    listener.onChunk({ type: 'start' } as any)
    void listener.onError({ status: 'error', error } as any)

    await expect(response).rejects.toBe(error)
  })

  it('streaming: an error after commitment emits a dialect error frame, not the raw SerializedError', async () => {
    const { response, listener } = await startStreaming()
    commit(listener)
    const res = await response

    void listener.onError({
      status: 'error',
      error: {
        name: 'AI_APICallError',
        message: 'Provider rejected the request',
        stack: 'secret stack',
        statusCode: 429,
        url: 'https://provider/v1',
        requestBodyValues: { prompt: 'SECRET PROMPT' },
        responseBody: 'secret body'
      }
    } as any)

    const text = await readAll(res.body)
    expect(text).toContain('"error"')
    expect(text).toContain('Provider rejected the request')
    expect(text).not.toContain('secret stack')
    expect(text).not.toContain('SECRET PROMPT')
    expect(text).not.toContain('secret body')
    expect(text).not.toContain('https://provider/v1')
  })

  it('rejects with a 504 when the stream pauses before semantic commitment', async () => {
    const { response, listener } = await startStreaming()

    await listener.onPaused({ status: 'paused' } as any)

    await expect(response).rejects.toMatchObject({ status: 504 })
  })

  it('streaming: a pause after commitment emits a truncation error frame (not a clean [DONE])', async () => {
    const { response, listener } = await startStreaming()
    commit(listener)
    const res = await response

    await listener.onPaused({ status: 'paused' } as any)

    const text = await readAll(res.body)
    expect(text).toContain('"error"')
    expect(text).not.toContain('[DONE]')
  })

  it('non-streaming: a terminal error rejects (propagates to the route → onError envelope)', async () => {
    const resPromise = processMessage({
      params: { model: 'openai:gpt-4', messages: [] } as any,
      inputFormat: 'openai',
      outputFormat: 'openai'
    })
    await vi.waitFor(() => expect(captured.listener).toBeDefined())

    void captured.listener!.onError({
      status: 'error',
      error: { name: 'AI_APICallError', message: 'boom', stack: null, statusCode: 401 }
    } as any)

    await expect(resPromise).rejects.toMatchObject({ statusCode: 401 })
  })

  it('non-streaming: an idle-timeout pause rejects with a 504 (truncation is not a 200)', async () => {
    const resPromise = processMessage({
      params: { model: 'openai:gpt-4', messages: [] } as any,
      inputFormat: 'openai',
      outputFormat: 'openai'
    })
    await vi.waitFor(() => expect(captured.listener).toBeDefined())

    await captured.listener!.onPaused({ status: 'paused' } as any)

    await expect(resPromise).rejects.toMatchObject({ status: 504 })
  })

  it('non-streaming: client disconnect resolves without a 504 (response is moot)', async () => {
    const controller = new AbortController()
    const resPromise = processMessage({
      params: { model: 'openai:gpt-4', messages: [] } as any,
      inputFormat: 'openai',
      outputFormat: 'openai',
      signal: controller.signal
    })
    await vi.waitFor(() => expect(captured.listener).toBeDefined())

    controller.abort()
    await captured.listener!.onPaused({ status: 'paused' } as any)

    const res = await resPromise
    expect(res.headers.get('Content-Type')).toBe('application/json')
    expect(mockAbort).toHaveBeenCalled()
  })
})
