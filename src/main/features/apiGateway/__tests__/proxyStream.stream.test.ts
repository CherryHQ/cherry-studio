import type { StreamListener } from '@main/ai/streamManager/types'
import { createUniqueModelId } from '@shared/data/types/model'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Exercises the streaming path of `processMessage`: the `ReadableStream` wiring,
 * the `SseListener` push → adapter/formatter → SSE-frame flow, terminal close,
 * startup commitment, and `signal`-driven abort. The AiStreamManager, provider
 * lookup, and adapter factories are stubbed; the real listener/stream glue runs.
 */

const { mockStreamPrompt, mockAbort, mockGetProvider, mockListModels, captured } = vi.hoisted(() => ({
  mockStreamPrompt: vi.fn(),
  mockAbort: vi.fn(),
  mockGetProvider: vi.fn(),
  mockListModels: vi.fn(),
  captured: { listener: undefined as StreamListener | undefined }
}))

vi.mock('@application', () => ({
  application: {
    get: vi.fn((name: string) =>
      name === 'AiStreamManager' ? { streamPrompt: mockStreamPrompt, abort: mockAbort } : undefined
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
      toUIMessages: () => [],
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

describe('processMessage (streaming)', () => {
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
