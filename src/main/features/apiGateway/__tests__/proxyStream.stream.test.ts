import type { StreamListener } from '@main/ai/streamManager/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Exercises the streaming path of `processMessage`: the `ReadableStream` wiring,
 * the `SseListener` push → adapter/formatter → SSE-frame flow, terminal close,
 * and `signal`-driven abort. The AiStreamManager, provider lookup, and adapter
 * factories are stubbed; the real `SseListener` and `ReadableStream` glue run.
 */

const { mockStreamPrompt, mockAbort, captured } = vi.hoisted(() => ({
  mockStreamPrompt: vi.fn(),
  mockAbort: vi.fn(),
  captured: { listener: undefined as StreamListener | undefined }
}))

vi.mock('@main/core/application', () => ({
  application: {
    get: vi.fn((name: string) =>
      name === 'AiStreamManager' ? { streamPrompt: mockStreamPrompt, abort: mockAbort } : undefined
    )
  }
}))

vi.mock('@data/services/ProviderService', () => ({
  providerService: { getByProviderId: vi.fn(async () => undefined) }
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

describe('processMessage (streaming)', () => {
  it('returns a text/event-stream response and flushes adapter frames + done marker', async () => {
    const res = await processMessage({
      params: { model: 'openai:gpt-4', stream: true, messages: [] } as any,
      inputFormat: 'openai',
      outputFormat: 'openai'
    })

    expect(res.headers.get('Content-Type')).toBe('text/event-stream')
    expect(mockStreamPrompt).toHaveBeenCalledOnce()
    expect(captured.listener).toBeDefined()

    // Simulate AiStreamManager pushing a chunk then completing.
    captured.listener!.onChunk({ type: 'text-delta', id: 't1', delta: 'hello' } as any)
    await captured.listener!.onDone({} as any)

    const text = await readAll(res.body)
    expect(text).toContain('"type":"text-delta"')
    expect(text).toContain('hello')
    expect(text).toContain('data: [DONE]')
  })

  it('aborts the upstream stream when the request signal fires', async () => {
    const controller = new AbortController()
    const res = await processMessage({
      params: { model: 'openai:gpt-4', stream: true, messages: [] } as any,
      inputFormat: 'openai',
      outputFormat: 'openai',
      signal: controller.signal
    })

    expect(captured.listener).toBeDefined()
    controller.abort()

    expect(mockAbort).toHaveBeenCalledOnce()
    // Stream is closed after abort — reading drains to completion without hanging.
    await expect(readAll(res.body)).resolves.toBeTypeOf('string')
  })

  it('returns JSON (not a stream) for non-streaming requests', async () => {
    const resPromise = processMessage({
      params: { model: 'openai:gpt-4', messages: [] } as any,
      inputFormat: 'openai',
      outputFormat: 'openai'
    })

    // Non-streaming drives the listener to completion via onDone.
    await vi.waitFor(() => expect(captured.listener).toBeDefined())
    await captured.listener!.onDone({} as any)

    const res = await resPromise
    expect(res.headers.get('Content-Type')).toBe('application/json')
    const body = await res.json()
    expect(body).toEqual({ done: true })
  })

  it('passes the 20-minute idle timeout to streamPrompt', async () => {
    await processMessage({
      params: { model: 'openai:gpt-4', stream: true, messages: [] } as any,
      inputFormat: 'openai',
      outputFormat: 'openai'
    })
    // GATEWAY_STREAM_IDLE_TIMEOUT_MS = 20 * 60_000.
    expect(mockStreamPrompt.mock.calls[0][0]).toMatchObject({ idleTimeoutMs: 20 * 60_000 })
  })
})

describe('processMessage (error & pause)', () => {
  it('streaming: a terminal error emits a dialect error frame, not the raw SerializedError', async () => {
    const res = await processMessage({
      params: { model: 'openai:gpt-4', stream: true, messages: [] } as any,
      inputFormat: 'openai',
      outputFormat: 'openai'
    })
    await vi.waitFor(() => expect(captured.listener).toBeDefined())

    // SerializedError-shaped terminal error with leaky AI-SDK extras.
    void captured.listener!.onError({
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
    // None of the leaky fields are shipped to the client.
    expect(text).not.toContain('secret stack')
    expect(text).not.toContain('SECRET PROMPT')
    expect(text).not.toContain('secret body')
    expect(text).not.toContain('https://provider/v1')
  })

  it('streaming: an idle-timeout pause emits a truncation error frame (not a clean [DONE])', async () => {
    const res = await processMessage({
      params: { model: 'openai:gpt-4', stream: true, messages: [] } as any,
      inputFormat: 'openai',
      outputFormat: 'openai'
    })
    await vi.waitFor(() => expect(captured.listener).toBeDefined())

    await captured.listener!.onPaused({ status: 'paused' } as any)

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

    controller.abort() // sets `aborted` + resolves done
    await captured.listener!.onPaused({ status: 'paused' } as any) // late pause is a no-op

    const res = await resPromise
    expect(res.headers.get('Content-Type')).toBe('application/json')
    expect(mockAbort).toHaveBeenCalled()
  })
})
