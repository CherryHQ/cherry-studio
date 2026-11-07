import { createAnthropic } from '@ai-sdk/anthropic'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import {
  APICallError,
  generateText,
  jsonSchema,
  JSONParseError,
  streamText,
  TypeValidationError,
  type UIMessageChunk
} from 'ai'
import { describe, expect, it, vi } from 'vitest'

import type * as AiCore from '@cherrystudio/ai-core'
import { Agent } from '@main/ai/runtime/aiSdk/Agent'
import { PersistenceListener } from '@main/ai/streamManager/listeners/PersistenceListener'
import type { PersistAssistantInput } from '@main/ai/streamManager/persistence/PersistenceBackend'
import { pipeStreamLoop } from '@main/ai/streamManager/pipeStreamLoop'
import { TopicMessageProjection } from '@main/ai/streamManager/TopicMessageProjection'
import type { StreamErrorResult } from '@main/ai/streamManager/types'
import { buildStreamErrorFrame, openaiErrorHandler } from '@main/features/apiGateway/errors'
import { toExecutionFailure } from '@shared/ai/executionFailure'
import type { SerializedError } from '@shared/types/error'

import { serializeError } from '../serializeError'

const createAgentMock = vi.hoisted(() => vi.fn())
vi.mock('@cherrystudio/ai-core', async (importOriginal) => ({
  ...(await importOriginal<typeof AiCore>()),
  createAgent: createAgentMock
}))

const SENTINEL = 'SENTINEL_PAYLOAD_9f3'
const EMPTY = 'Invalid response: empty response body. Retry or switch model.'
const JSON_ERROR = 'Invalid JSON data. Retry or check the provider endpoint and model.'
const VALIDATION = 'Type validation failed: unexpected data structure. Check the provider endpoint and model.'
const TERMINATED = 'Invalid response: response processing terminated. Retry the turn.'
const MODEL_ID = 'fixture-provider::fixture-model'
const encoder = new TextEncoder()

function fixture(kind: 'compatible' | 'anthropic') {
  const compatible = kind === 'compatible'
  const valid = compatible
    ? {
        id: 'chat-fixture',
        object: 'chat.completion',
        created: 1,
        model: 'fixture-model',
        choices: [{ index: 0, message: { role: 'assistant', content: 'OK' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
      }
    : {
        id: 'msg-fixture',
        type: 'message',
        role: 'assistant',
        model: 'fixture-model',
        content: [{ type: 'text', text: 'OK' }],
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 1 }
      }
  const first = compatible
    ? `data: ${JSON.stringify({ choices: [{ index: 0, delta: { role: 'assistant', content: 'OK' }, finish_reason: null }] })}\n\n`
    : `event: message_start\ndata: ${JSON.stringify({ type: 'message_start', message: { ...valid, content: [], stop_reason: null } })}\n\nevent: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\nevent: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"OK"}}\n\n`
  const end = compatible
    ? 'data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'
    : 'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\nevent: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},"usage":{"output_tokens":1}}\n\nevent: message_stop\ndata: {"type":"message_stop"}\n\n'
  return { valid, first, end }
}

function modelFor(kind: 'compatible' | 'anthropic', body: BodyInit | null, contentType = 'application/json') {
  const fetch = vi.fn(
    async () =>
      new Response(body, {
        status: 200,
        headers: { 'content-type': contentType, 'x-private-fixture': SENTINEL, 'set-cookie': `session=${SENTINEL}` }
      })
  )
  const settings = { baseURL: `https://fixture.invalid/v1?token=${SENTINEL}`, apiKey: SENTINEL, fetch }
  const provider =
    kind === 'compatible'
      ? createOpenAICompatible({ ...settings, name: 'fixture-provider' })
      : createAnthropic(settings)
  return { model: provider('fixture-model'), fetch }
}

function assertSafe(error: unknown, message: string, category = 'parse') {
  const serialized = serializeError(error)
  const failure = toExecutionFailure(serialized, MODEL_ID)
  expect(serialized).toMatchObject({ message, providerErrorCategory: category, stack: null, cause: null })
  expect(failure).toMatchObject({
    message,
    retryable: false,
    failure: {
      reasonCode: category === 'server' ? 'provider_unavailable' : 'parse',
      context: { providerId: 'fixture-provider', modelId: MODEL_ID }
    }
  })
  for (const field of ['text', 'value', 'issues']) expect(serialized).not.toHaveProperty(field)
  if (APICallError.isInstance(error)) {
    expect(serialized).toMatchObject({
      url: '',
      requestBodyValues: null,
      responseHeaders: null,
      responseBody: null,
      data: null,
      statusCode: error.statusCode,
      isRetryable: error.isRetryable
    })
    expect(error.isRetryable).toBe(false)
  }
  expect(JSON.stringify({ serialized, failure })).not.toContain(SENTINEL)
  return serialized
}

async function runAgent(
  model: ReturnType<typeof modelFor>['model'],
  onChunk: (chunk: UIMessageChunk) => void = () => {}
) {
  createAgentMock.mockResolvedValue({
    stream: async (options: Parameters<typeof streamText>[0]) =>
      streamText({ ...options, model, maxRetries: 0, maxOutputTokens: 32, onError: () => {} })
  })
  const agent = new Agent({
    providerId: 'openai',
    providerSettings: {},
    modelId: 'fixture-model',
    errorContext: { providerId: 'fixture-provider', modelId: MODEL_ID },
    messageId: 'assistant-fixture'
  })
  const signal = new AbortController().signal
  const chunks: UIMessageChunk[] = []
  const result = await pipeStreamLoop(
    agent.stream([{ id: 'user-fixture', role: 'user', parts: [{ type: 'text', text: SENTINEL }] }], signal),
    signal,
    {
      onChunk(chunk) {
        chunks.push(chunk)
        onChunk(chunk)
      }
    }
  )
  return { ...result, chunks }
}

async function persistAndProject(result: Awaited<ReturnType<typeof runAgent>>, error: SerializedError) {
  let saved: PersistAssistantInput | undefined
  const listener = new PersistenceListener({
    topicId: 'topic-fixture',
    modelId: MODEL_ID,
    backend: {
      kind: 'fixture',
      persistAssistant(input) {
        saved = structuredClone(input)
      }
    },
    onPersistFailed: () => {
      throw new Error('Unexpected persistence failure')
    }
  })
  const terminal: StreamErrorResult = {
    status: 'error',
    error,
    modelId: MODEL_ID,
    attemptId: 1,
    anchorMessageId: 'assistant-fixture',
    finalMessage: result.finalMessage
  }
  await listener.onError(terminal)
  const projection = new TopicMessageProjection('topic-fixture', (message) => message)
  projection.begin([{ executionId: MODEL_ID, attemptId: 1, anchorMessageId: 'assistant-fixture' }], true)
  projection.onError(terminal)
  const view = projection.snapshot()
  projection.dispose()
  expect(saved?.status).toBe('error')
  expect(saved?.finalMessage?.parts).toContainEqual({
    type: 'data-error',
    data: { ...error, executionFailure: toExecutionFailure(error, MODEL_ID) }
  })
  expect(view.executions).toMatchObject([{ status: 'error', anchorMessageId: 'assistant-fixture' }])
  expect(view.messages[0].id).toBe('assistant-fixture')
  expect(view.messages[0].parts).toEqual(saved?.finalMessage?.parts)
  expect(JSON.stringify({ saved, view })).not.toContain(SENTINEL)
  return saved?.finalMessage
}

// Real adapters expose different errors; each must retain meaning without their payloads.
describe.each(['compatible', 'anthropic'] as const)('%s successful HTTP response', (kind) => {
  it('preserves SDK cancellation instead of diagnosing a response failure', async () => {
    const { model, fetch } = modelFor(kind, null)
    const reason = new DOMException('Cancelled', 'AbortError')
    fetch.mockRejectedValueOnce(reason)
    await expect(
      generateText({
        model,
        prompt: 'hello',
        maxRetries: 0,
        maxOutputTokens: 32,
        abortSignal: AbortSignal.abort(reason)
      })
    ).rejects.toMatchObject({ name: 'AbortError' })
  })
  it.each([
    ['empty string', '', EMPTY],
    ['null body', null, EMPTY],
    ['HTML', `<html>${SENTINEL}</html>`, JSON_ERROR],
    ['wrong schema', '{}', VALIDATION],
    ['private wrong schema', JSON.stringify({ private: SENTINEL }), VALIDATION],
    ['whitespace', '   ', JSON_ERROR]
  ])('safely describes non-streaming %s', async (_label, body, message) => {
    const { model, fetch } = modelFor(kind, body)
    let error: unknown
    try {
      await generateText({ model, prompt: SENTINEL, maxRetries: 0, maxOutputTokens: 32 })
    } catch (caught) {
      error = caught
    }
    expect(APICallError.isInstance(error)).toBe(true)
    assertSafe(error, message)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it.each(['application/json', 'text/html'])('accepts valid JSON with %s MIME', async (contentType) => {
    const { model } = modelFor(kind, JSON.stringify(fixture(kind).valid), contentType)
    const result = await generateText({ model, prompt: SENTINEL, maxRetries: 0, maxOutputTokens: 32 })
    expect(result.text).toBe('OK')
    expect(result.finishReason).toBe('stop')
  })

  it('accepts protocol-complete empty text', async () => {
    const valid = fixture(kind).valid
    const body =
      kind === 'compatible'
        ? { ...valid, choices: [{ index: 0, message: { role: 'assistant', content: '' }, finish_reason: 'stop' }] }
        : { ...valid, content: [] }
    const { model } = modelFor(kind, JSON.stringify(body))
    const result = await generateText({ model, prompt: 'hello', maxRetries: 0, maxOutputTokens: 32 })
    expect(result.text).toBe('')
    expect(result.finishReason).toBe('stop')
  })

  it('accepts a protocol-complete tool-only response', async () => {
    const valid = fixture(kind).valid
    const body =
      kind === 'compatible'
        ? {
            ...valid,
            choices: [
              {
                index: 0,
                message: {
                  role: 'assistant',
                  content: null,
                  tool_calls: [{ id: 'call-fixture', type: 'function', function: { name: 'lookup', arguments: '{}' } }]
                },
                finish_reason: 'tool_calls'
              }
            ]
          }
        : {
            ...valid,
            content: [{ type: 'tool_use', id: 'call-fixture', name: 'lookup', input: {} }],
            stop_reason: 'tool_use'
          }
    const { model } = modelFor(kind, JSON.stringify(body))
    const result = await generateText({
      model,
      prompt: 'hello',
      maxRetries: 0,
      maxOutputTokens: 32,
      tools: { lookup: { inputSchema: jsonSchema({ type: 'object', properties: {} }) } }
    })
    expect(result.text).toBe('')
    expect(result.finishReason).toBe('tool-calls')
    expect(result.toolCalls[0]).toMatchObject({ toolName: 'lookup' })
    expect(result.toolCalls[0]).not.toHaveProperty('invalid', true)
  })

  it.each([
    ['null stream body', null, EMPTY, 'parse'],
    [
      'framed malformed event',
      `data: {"private":"${SENTINEL}","type":\n\n`,
      JSON_ERROR,
      kind === 'anthropic' ? 'server' : 'parse'
    ]
  ])('retains %s through original capture, persistence and projection', async (_label, body, message, category) => {
    const { model, fetch } = modelFor(kind, body, 'text/event-stream')
    const result = await runAgent(model)
    expect(result.threw).toBeDefined()
    expect(result.chunks.some((chunk) => chunk.type === 'finish')).toBe(false)
    const serialized = assertSafe(result.threw?.error, message, category)
    await persistAndProject(result, serialized)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('retains partial text when the next read terminates after consumption', async () => {
    let rejectRead!: () => void
    const consumed = new Promise<void>((resolve) => {
      rejectRead = resolve
    })
    const body = new ReadableStream<Uint8Array>({
      async start(controller) {
        controller.enqueue(encoder.encode(fixture(kind).first))
        await consumed
        controller.error(new TypeError('terminated'))
      }
    })
    const { model } = modelFor(kind, body, 'text/event-stream')
    const result = await runAgent(model, (chunk) => {
      if (chunk.type === 'text-delta' && chunk.delta === 'OK') rejectRead()
    })
    expect(result.finalMessage?.parts).toContainEqual(expect.objectContaining({ type: 'text', text: 'OK' }))
    expect(result.chunks.some((chunk) => chunk.type === 'finish')).toBe(false)
    const serialized = assertSafe(result.threw?.error, TERMINATED)
    const saved = await persistAndProject(result, serialized)
    expect(saved?.parts).toContainEqual(expect.objectContaining({ type: 'text', text: 'OK', state: 'done' }))
  })

  it('completes a valid framed stream without error', async () => {
    const { first, end } = fixture(kind)
    const { model } = modelFor(kind, first + end, 'text/event-stream')
    const result = await runAgent(model)
    expect(result.threw).toBeUndefined()
    expect(result.accumulationError).toBeUndefined()
    expect(result.chunks).toContainEqual({ type: 'finish', finishReason: 'stop' })
    expect(result.finalMessage?.parts).toContainEqual(expect.objectContaining({ type: 'text', text: 'OK' }))
  })
})

describe('entry routing and preserved terminal semantics', () => {
  it('recognises legacy wrapper text without rewriting old explicit failure categories', () => {
    const legacy = {
      name: 'AI_APICallError',
      message: 'Failed to process successful response',
      stack: null,
      statusCode: 200
    }
    expect(toExecutionFailure(legacy, MODEL_ID).failure.reasonCode).toBe('parse')
    expect(toExecutionFailure({ ...legacy, providerErrorCategory: 'unknown' }, MODEL_ID).failure.reasonCode).toBe(
      'unknown'
    )
  })
  it.each([
    new JSONParseError({ text: SENTINEL, cause: new Error(SENTINEL) }),
    new TypeValidationError({ value: { private: SENTINEL }, cause: new Error(SENTINEL) })
  ])('safely routes direct SDK $name', (error) => {
    assertSafe(error, JSONParseError.isInstance(error) ? JSON_ERROR : VALIDATION)
  })

  it('preserves MissingFinishReasonError metadata and partial content from the real compatible adapter', async () => {
    const { model } = modelFor('compatible', fixture('compatible').first, 'text/event-stream')
    const result = await runAgent(model)
    expect(result.threw?.error).toMatchObject({
      name: 'MissingFinishReasonError',
      i18nKey: 'missing_finish_reason',
      providerId: 'fixture-provider',
      modelId: MODEL_ID
    })
    const serialized = serializeError(result.threw?.error)
    expect(serialized).toMatchObject({
      name: 'MissingFinishReasonError',
      i18nKey: 'missing_finish_reason',
      message: 'Response stream ended without a finish reason.'
    })
    expect(toExecutionFailure(serialized, MODEL_ID).failure.reasonCode).toBe('parse')
    const saved = await persistAndProject(result, serialized)
    expect(saved?.parts).toContainEqual(expect.objectContaining({ type: 'text', text: 'OK', state: 'done' }))
  })

  it('leaves unrelated application errors unchanged', () => {
    const cause = new Error('application cause')
    const error = Object.assign(new Error('application error', { cause }), {
      text: 'application text',
      value: { field: 1 }
    })
    expect(serializeError(error)).toEqual({
      name: 'Error',
      message: 'application error',
      stack: error.stack,
      cause: String(cause),
      text: 'application text',
      value: { field: 1 }
    })
  })

  it.each([200, 201, 204, 206, 299])('keeps gateway HTTP %i failures at 502 with safe details', (statusCode) => {
    const error = serializeError(
      new APICallError({
        message: 'Invalid JSON response',
        statusCode,
        responseBody: '',
        url: `https://fixture.invalid/${SENTINEL}`,
        requestBodyValues: { prompt: SENTINEL }
      })
    )
    const response = openaiErrorHandler({
      code: 'UNKNOWN',
      error,
      status: (status, body) => ({ status, body })
    } as unknown as Parameters<typeof openaiErrorHandler>[0])
    expect(response).toEqual({
      status: 502,
      body: { error: { message: EMPTY, type: 'server_error', code: 'internal_error' } }
    })
    const frame = buildStreamErrorFrame('openai', error)
    expect(frame).toContain(EMPTY)
    expect(JSON.stringify({ response, frame })).not.toContain(SENTINEL)
  })

  it('keeps cancellation on the abort path without a response diagnosis', async () => {
    const controller = new AbortController()
    const reason = new DOMException('Cancelled', 'AbortError')
    createAgentMock.mockResolvedValue({
      stream: async () => {
        controller.abort(reason)
        throw reason
      }
    })
    const agent = new Agent({ providerId: 'openai', providerSettings: {}, modelId: 'fixture-model' })
    const result = await pipeStreamLoop(agent.stream([], controller.signal), controller.signal, { onChunk: () => {} })
    expect(result.threw).toBeUndefined()
    expect(result.finalMessage).toBeUndefined()
  })
})
