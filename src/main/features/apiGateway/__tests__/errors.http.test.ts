import { mkdir, writeFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import { join } from 'node:path'

import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { node } from '@elysia/node'
import { startMockChatServer } from '@test-helpers/http/mockChatServer'
import { APICallError, generateText, streamText, type UIMessageChunk } from 'ai'
import { Elysia } from 'elysia'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { SseListener } from '@main/ai/streamManager/listeners/SseListener'
import { pipeStreamLoop } from '@main/ai/streamManager/pipeStreamLoop'
import { serializeError } from '@main/ai/utils/serializeError'
import { isDev } from '@main/core/platform'
import { withIdleTimeout } from '@main/utils/withIdleTimeout'
import { DataApiError } from '@shared/data/api/errors'
import type { SerializedError } from '@shared/types/error'

import type { OutputFormat } from '../adapters'
import { buildStreamErrorFrame, gatewayErrorHandler } from '../errors'

const timeoutMessage = 'Upstream request timed out'
const abortMessage = 'Upstream stream aborted'
const genericMessage = 'Internal server error'
const phrases = ['Upstream idle timeout exceeded', 'Stream idle timeout exceeded', 'Idle timeout exceeded']
const markers = {
  stack: 'MARKER_STACK',
  url: 'MARKER_URL',
  requestBodyValues: 'MARKER_REQUEST',
  responseBody: 'MARKER_RESPONSE',
  responseHeaders: 'MARKER_HEADERS',
  cause: 'MARKER_CAUSE',
  extra: 'MARKER_EXTRA'
}
const dialects: { format: OutputFormat; path: string }[] = [
  { format: 'anthropic', path: '/v1/messages' },
  { format: 'openai', path: '/v1/chat/completions' },
  { format: 'openai-responses', path: '/v1/responses' },
  { format: 'gemini', path: '/v1beta/models/fixture:generateContent' }
]
type Mode = 'non-streaming' | 'before-commit' | 'after-commit'
type Case = {
  id: string
  origin: string
  input: () => unknown | Promise<unknown>
  status: number
  message: string
  boundary?: boolean
  providerType?: string
  requestId?: string
}
const realInputs = new Map<string, unknown>()
const cases: Case[] = []
function add(id: string, value: unknown, status = 500, message = genericMessage, boundary = false) {
  cases.push({ id, origin: 'constructed boundary', input: () => value, status, message, boundary })
}
for (const [id, message] of [
  ['fetch-timeout', timeoutMessage],
  ['fetch-abort', abortMessage],
  ['sdk-sse', timeoutMessage]
]) {
  cases.push({
    id,
    origin:
      id === 'sdk-sse' ? 'real SDK SSE fixture + serializeError' : 'real socket fetch + wrapper/loop + serializeError',
    input: () => realInputs.get(id),
    status: 504,
    message
  })
}
for (const status of [401, 429, 500, 503]) {
  cases.push({
    id: `provider-${status}`,
    origin: 'real SDK HTTP fixture + serializeError',
    input: () => realInputs.get(`provider-${status}`),
    status,
    message: `Provider fixture ${status}`
  })
}
for (const name of ['ResponseAborted', 'AbortError', 'TimeoutError']) {
  const error = Object.assign(new Error('MARKER_PRIVATE_MESSAGE'), markers, { name })
  add(`direct-${name}`, error, 504, name === 'TimeoutError' ? timeoutMessage : abortMessage)
  add(`serialized-${name}`, serializeError(error), 504, name === 'TimeoutError' ? timeoutMessage : abortMessage)
}
add('direct-code-object', { ...markers, code: 'ABORT_ERR', message: 'MARKER_PRIVATE_MESSAGE' }, 504, abortMessage)
add(
  'direct-code-error',
  Object.assign(new Error('MARKER_PRIVATE_MESSAGE'), markers, { code: 'ABORT_ERR' }),
  504,
  abortMessage
)
add('serialized-code-stripped', serializeError(Object.assign(new Error('ordinary failure'), { code: 'ABORT_ERR' })))
for (const phrase of phrases) {
  add(`Error:${phrase}`, Object.assign(new Error(phrase), markers), 504, timeoutMessage)
  add(`StreamError:${phrase}`, { ...markers, name: 'StreamError', message: phrase }, 504, timeoutMessage)
  add(`serialized-string:${phrase}`, serializeError(phrase), 504, timeoutMessage)
  add(`serialized-object:${phrase}`, serializeError({ message: phrase }), 504, timeoutMessage)
  add(
    `APICallError:${phrase}`,
    serializeError(new APICallError({ message: phrase, url: 'http://fixture.invalid', requestBodyValues: {} })),
    504,
    timeoutMessage
  )
}
add('timeout-before-abort', { ...markers, name: 'AbortError', message: phrases[0] }, 504, timeoutMessage)
add(
  'status-before-statusCode',
  {
    ...markers,
    status: 401,
    statusCode: 503,
    name: 'TimeoutError',
    message: phrases[0],
    error: { message: 'Selected provider detail' }
  },
  401,
  'Selected provider detail'
)
add('statusCode-fallback', { ...markers, statusCode: 503, name: 'TimeoutError', message: phrases[0] }, 503, phrases[0])
add(
  'string-status-fallback',
  { ...markers, status: '401', statusCode: 429, code: 'ABORT_ERR', message: 'Provider rate limit' },
  429,
  'Provider rate limit'
)
add('provider-500-wins', { name: 'TimeoutError', status: 500, message: phrases[0] }, 500, phrases[0])
add('structured-hides-idle', { ...markers, message: phrases[0], error: { message: 'Provider-specific detail' } })
add(
  'structured-idle-wins',
  { ...markers, message: 'Different top-level detail', error: { message: phrases[0] } },
  504,
  timeoutMessage
)
add('structured-empty-wins', { message: phrases[0], error: { message: '' } })
add('status-structured-empty', { status: 503, message: phrases[0], error: { message: '' } }, 503)
cases.push({
  id: 'provider-type-request-id',
  origin: 'constructed boundary',
  input: () => ({
    ...markers,
    name: 'TimeoutError',
    message: 'MARKER_PRIVATE_MESSAGE',
    error: { type: 'provider_custom' },
    request_id: 'fixture-request-id'
  }),
  status: 504,
  message: timeoutMessage,
  providerType: 'provider_custom',
  requestId: 'fixture-request-id'
})
for (const message of [
  '',
  'unexpected failure',
  'database timeout',
  'MCP timeout',
  'timeout reading /path/to/secret',
  'Service temporarily overloaded',
  'Error: Upstream idle timeout exceeded',
  'Upstream idle timeout exceeded: /path/to/secret',
  'upstream idle timeout exceeded',
  ' Upstream idle timeout exceeded',
  'Upstream idle timeout exceeded ',
  'Upstream idle timeout exceeded\n'
]) {
  add(`generic:${JSON.stringify(message)}`, Object.assign(new Error(message), markers))
}
add('TypeError', Object.assign(new TypeError('private type detail'), markers))
add('empty-object', {})
for (const code of ['ETIMEDOUT', 'ECONNRESET', 20, 23])
  add(`unsupported-code-${code}`, { ...markers, name: 'Error', code })
add('network-category', { ...markers, providerErrorCategory: 'network' })
add('nested-timeout-only', { message: 'ordinary failure', cause: { name: 'TimeoutError', message: phrases[0] } })
for (const [id, value] of Object.entries({
  undefined,
  null: null,
  number: 42,
  boolean: true,
  string: phrases[0],
  function: () => undefined
}))
  add(`raw-${id}`, value, 500, genericMessage, true)
add(
  'internal-provenance-collision',
  Object.assign(new Error('MARKER_PRIVATE_MESSAGE'), markers, { name: 'TimeoutError' }),
  504,
  timeoutMessage
)
add(
  'zero-original-status',
  { status: 0, name: 'TimeoutError', message: 'Zero status preserved' },
  0,
  'Zero status preserved',
  true
)

// Independent protocol expectations also catch changes to dialect vocabulary and terminal event structure.
const vocabulary: Record<number, { anthropic: string; openai: string; code: string; google: string }> = {
  0: {
    anthropic: 'invalid_request_error',
    openai: 'invalid_request_error',
    code: 'bad_request',
    google: 'INVALID_ARGUMENT'
  },
  401: {
    anthropic: 'authentication_error',
    openai: 'authentication_error',
    code: 'invalid_api_key',
    google: 'UNAUTHENTICATED'
  },
  429: {
    anthropic: 'rate_limit_error',
    openai: 'rate_limit_error',
    code: 'rate_limit_exceeded',
    google: 'RESOURCE_EXHAUSTED'
  },
  500: { anthropic: 'api_error', openai: 'server_error', code: 'internal_error', google: 'INTERNAL' },
  503: { anthropic: 'api_error', openai: 'server_error', code: 'internal_error', google: 'UNAVAILABLE' },
  504: { anthropic: 'api_error', openai: 'server_error', code: 'internal_error', google: 'DEADLINE_EXCEEDED' }
}
function expectedBody(format: OutputFormat, c: Case, sse = false) {
  const v = vocabulary[c.status]
  if (format === 'anthropic')
    return {
      type: 'error',
      error: {
        type: c.providerType ?? v.anthropic,
        message: c.message,
        ...(c.requestId ? { requestId: c.requestId } : {})
      }
    }
  if (format === 'gemini') return { error: { code: c.status, message: c.message, status: v.google } }
  if (format === 'openai-responses' && sse) return { type: 'error', code: v.code, message: c.message }
  return { error: { message: c.message, type: v.openai, code: v.code } }
}
function expectedFrame(format: OutputFormat, c: Case) {
  const event = format === 'anthropic' || format === 'openai-responses' ? 'event: error\n' : ''
  return `${event}data: ${JSON.stringify(expectedBody(format, c, true))}\n\n`
}
const prefix = 'data: {"text":"previously delivered synthetic content"}\n\n'
let active: { test: Case; format: OutputFormat; mode: Mode }
let releaseError: (() => void) | undefined
let server: Server
let baseUrl: string
const observations: Record<string, unknown>[] = []
function inputShape(input: unknown) {
  if (input === null || typeof input !== 'object') return { typeof: typeof input, value: String(input) }
  const fields = input as Record<string, unknown>
  return { ...fields, name: fields.name, message: fields.message, typeof: typeof input }
}

async function listen(server: Server) {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('No fixture port')
  return `http://127.0.0.1:${address.port}`
}
async function close(server: Server) {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()))
    server.closeAllConnections()
  })
}
async function fetchFailure(abort: boolean) {
  const upstream = createServer()
  const url = await listen(upstream)
  const execution = new AbortController()
  const cancellation = new AbortController()
  const source = new ReadableStream<UIMessageChunk>({
    start(controller) {
      controller.enqueue({ type: 'start', messageId: 'synthetic' })
      const pending = fetch(url, { signal: abort ? cancellation.signal : AbortSignal.timeout(40) })
      if (abort) setTimeout(() => cancellation.abort(), 40)
      void pending.catch((error: unknown) => controller.error(error))
    }
  })
  const wrapped = withIdleTimeout(source, execution, 2000)
  try {
    const result = await pipeStreamLoop(wrapped.stream, execution.signal, { onChunk: () => {} })
    expect(execution.signal.aborted).toBe(false)
    expect(result.threw).toBeDefined()
    expect(result.accumulationError).toBeUndefined()
    const serialized = serializeError(result.threw!.error)
    expect(serialized.name).toBe(abort ? 'AbortError' : 'TimeoutError')
    return serialized
  } finally {
    wrapped.idle.cleanup()
    await close(upstream)
  }
}
async function sdkSseFailure() {
  const fixture = await startMockChatServer()
  try {
    const provider = createOpenAICompatible({ name: 'gateway-fixture', baseURL: fixture.baseUrl })
    const result = streamText({
      model: provider.chatModel(fixture.modelId),
      prompt: 'Synthetic timeout fixture',
      maxRetries: 0
    })
    const captured: unknown[] = []
    const ui = result.toUIMessageStream({
      onError(error) {
        captured.push(error)
        return 'synthetic error'
      }
    })
    const drain = (async () => {
      for await (const chunk of ui) {
        void chunk
      }
    })()
    const request = await fixture.nextRequest()
    expect(request.body.stream).toBe(true)
    request.fail(phrases[0])
    await drain
    expect(captured).toHaveLength(1)
    const serialized = serializeError(captured[0])
    expect(serialized).toEqual({ name: null, message: phrases[0], stack: null })
    return serialized
  } finally {
    await fixture.close()
  }
}
async function providerFailure(status: number) {
  const upstream = createServer((_req, res) => {
    res.writeHead(status, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: { message: `Provider fixture ${status}`, type: 'server_error' } }))
  })
  const url = await listen(upstream)
  try {
    const provider = createOpenAICompatible({ name: 'gateway-fixture', baseURL: `${url}/v1` })
    const error = await generateText({
      model: provider.chatModel('fixture'),
      prompt: 'Synthetic provider failure',
      maxRetries: 0
    }).catch((error: unknown) => error)
    expect(APICallError.isInstance(error)).toBe(true)
    const serialized = serializeError(error)
    expect(serialized.statusCode).toBe(status)
    expect(serialized.message).toBe(`Provider fixture ${status}`)
    return serialized
  } finally {
    await close(upstream)
  }
}

beforeAll(async () => {
  expect(isDev).toBe(false)
  realInputs.set('fetch-timeout', await fetchFailure(false))
  realInputs.set('fetch-abort', await fetchFailure(true))
  realInputs.set('sdk-sse', await sdkSseFailure())
  for (const status of [401, 429, 500, 503]) realInputs.set(`provider-${status}`, await providerFailure(status))
  expect(serializeError(Object.assign(new Error('ordinary failure'), { code: 'ABORT_ERR' }))).not.toHaveProperty('code')
  const app = new Elysia({ adapter: node() }).error({ DATA_API: DataApiError }).onError(gatewayErrorHandler)
  for (const path of [...dialects.map((d) => d.path), '/v1/models', '/v1/mcps/test/mcp']) {
    app.get(path, async (ctx) => {
      const { test, format, mode } = active
      if (mode !== 'after-commit') {
        const error = await test.input()
        // Explicit boundary invocation avoids Elysia's null-throw limitation, with its real context/status.
        if (test.boundary)
          return gatewayErrorHandler({ ...ctx, code: 'UNKNOWN', error } as Parameters<typeof gatewayErrorHandler>[0])
        throw error
      }
      let alive = true
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          const listener = new SseListener(
            (data) => controller.enqueue(new TextEncoder().encode(data)),
            () => {
              alive = false
              controller.close()
            },
            () => alive,
            { formatChunk: () => prefix, formatError: (error) => buildStreamErrorFrame(format, error) }
          )
          listener.onChunk({ type: 'text-delta', id: 'synthetic', delta: 'previously delivered synthetic content' })
          releaseError = () => {
            void Promise.resolve(test.input()).then((error) =>
              listener.onError({ status: 'error', error: error as SerializedError })
            )
          }
        }
      })
      return new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } })
    })
  }
  await new Promise<void>((resolve, reject) => {
    app.listen({ port: 0, hostname: '127.0.0.1', gracefulShutdown: false }, (info) => {
      const handle = info as unknown as { raw: { node: { server: Server }; ready(): Promise<unknown> } }
      server = handle.raw.node.server
      void handle.raw.ready().then(() => {
        const address = server.address()
        if (!address || typeof address === 'string') return reject(new Error('No gateway port'))
        baseUrl = `http://127.0.0.1:${address.port}`
        resolve()
      }, reject)
    })
  })
}, 20_000)

afterAll(async () => {
  try {
    if (server) await close(server)
  } finally {
    const dir = process.env.GATEWAY_EVIDENCE_DIR
    if (dir) {
      await mkdir(dir, { recursive: true })
      await writeFile(join(dir, 'observations.json'), JSON.stringify(observations, null, 2))
    }
  }
})

describe('gateway generation errors over real Elysia/node sockets', () => {
  for (const dialect of dialects) {
    for (const mode of ['non-streaming', 'before-commit', 'after-commit'] as const) {
      for (const test of cases) {
        if (test.status === 0 && mode !== 'after-commit') continue
        it(`${dialect.format} / ${mode} / ${test.id}`, async () => {
          active = { test, format: dialect.format, mode }
          releaseError = undefined
          const started = performance.now()
          const observation: Record<string, unknown> = {
            case: test.id,
            origin: test.origin,
            inputShape: inputShape(await test.input()),
            path: dialect.path,
            mode,
            commitment: mode === 'after-commit' ? 'HTTP 200 committed' : 'pending',
            outcome: 'failed'
          }
          observations.push(observation)
          try {
            const response = await fetch(`${baseUrl}${dialect.path}?stream=${mode !== 'non-streaming'}`, {
              signal: AbortSignal.timeout(5000)
            })
            observation.httpStatus = response.status
            let body: string
            if (mode === 'after-commit') {
              const reader = response.body!.getReader()
              const first = await reader.read()
              const delivered = new TextDecoder().decode(first.value)
              expect(delivered).toBe(prefix)
              expect(releaseError).toBeDefined()
              releaseError!()
              body = delivered
              for (;;) {
                const next = await reader.read()
                if (next.done) break
                body += new TextDecoder().decode(next.value)
              }
              observation.body = body
              expect(response.status).toBe(200)
              expect(response.headers.get('content-type')).toContain('text/event-stream')
              expect(body).toBe(prefix + expectedFrame(dialect.format, test))
              expect(body).not.toContain('[DONE]')
            } else {
              body = await response.text()
              observation.body = body
              expect(response.status).toBe(test.status)
              expect(response.headers.get('content-type')).toContain('application/json')
              expect(JSON.parse(body)).toEqual(expectedBody(dialect.format, test))
              expect(body).not.toContain('data: ')
            }
            for (const marker of [...Object.values(markers), 'MARKER_PRIVATE_MESSAGE'])
              expect(body).not.toContain(marker)
            observation.outcome = 'passed'
          } finally {
            observation.elapsedMs = performance.now() - started
          }
        })
      }
    }
  }
  for (const path of ['/v1/models', '/v1/mcps/test/mcp']) {
    it(`preserves REST/MCP vocabulary at ${path}`, async () => {
      const test = cases.find((c) => c.id === 'fetch-timeout')!
      active = { test, format: 'anthropic', mode: 'non-streaming' }
      const started = performance.now()
      const observation: Record<string, unknown> = {
        case: 'REST/MCP timeout control',
        origin: test.origin,
        inputShape: inputShape(await test.input()),
        path,
        mode: 'non-streaming',
        commitment: 'pending',
        outcome: 'failed'
      }
      observations.push(observation)
      try {
        const response = await fetch(`${baseUrl}${path}`, { signal: AbortSignal.timeout(5000) })
        const body = await response.text()
        Object.assign(observation, { httpStatus: response.status, body })
        expect(response.status).toBe(500)
        expect(JSON.parse(body)).toEqual(
          path === '/v1/models'
            ? { error: { code: 'INTERNAL_SERVER_ERROR', message: genericMessage } }
            : { jsonrpc: '2.0', error: { code: -32603, message: 'Internal error' }, id: null }
        )
        observation.outcome = 'passed'
      } finally {
        observation.elapsedMs = performance.now() - started
      }
    })
  }
})

it('preserves development-only messages separately from production non-disclosure', async () => {
  const previous = process.env.NODE_ENV
  vi.resetModules()
  vi.stubEnv('NODE_ENV', 'development')
  try {
    const { buildStreamErrorFrame: developmentFrame } = await import('../errors')
    expect(developmentFrame('openai', new Error('Synthetic development detail'))).toBe(
      'data: {"error":{"message":"Synthetic development detail","type":"server_error","code":"internal_error"}}\n\n'
    )
    expect(
      developmentFrame('openai', Object.assign(new Error('MARKER_PRIVATE_MESSAGE'), { name: 'TimeoutError' }))
    ).toContain(timeoutMessage)
  } finally {
    vi.stubEnv('NODE_ENV', previous)
    vi.resetModules()
  }
})
