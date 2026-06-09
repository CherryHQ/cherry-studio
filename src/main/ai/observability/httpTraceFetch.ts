import type { FetchFunction } from '@ai-sdk/provider-utils'
import { context, SpanStatusCode, trace, type Tracer } from '@opentelemetry/api'
import { KB } from '@shared/config/constant'

import { TRACER_NAME } from './constants'

/** Cap on how many bytes of a request/response body we capture into a span. */
export const MAX_BODY_BYTES = 512 * KB

/**
 * Header names whose values are secrets or session identifiers. We never
 * record their real value into a span — they're replaced with `***`.
 */
const SENSITIVE_HEADER_KEYS = new Set([
  'authorization',
  'x-api-key',
  'api-key',
  'cookie',
  'set-cookie',
  'x-goog-api-key',
  'openai-organization',
  'openai-project',
  'anthropic-api-key'
])

export interface HttpTraceOptions {
  topicId?: string
  modelName?: string
  /** Injectable for tests; defaults to the shared CherryStudio tracer. */
  tracer?: Tracer
  /** Per-body capture cap; defaults to {@link MAX_BODY_BYTES}. */
  maxBodyBytes?: number
}

/**
 * Wrap a `fetch` so every provider HTTP call emits an `http.request` span
 * under the active context (the `ai.turn`/`doStream` span), capturing the
 * raw url, method, redacted headers, and truncated request/response bodies.
 *
 * Gated by the caller on developer mode — this is a debugging aid, not a
 * production code path. Sensitive headers are redacted and bodies are
 * truncated to {@link HttpTraceOptions.maxBodyBytes}.
 */
export function createHttpTraceFetch(innerFetch: FetchFunction, opts: HttpTraceOptions): FetchFunction {
  const tracer = opts.tracer ?? trace.getTracer(TRACER_NAME)
  const maxBodyBytes = opts.maxBodyBytes ?? MAX_BODY_BYTES

  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const span = tracer.startSpan('http.request', {}, context.active())
    if (opts.topicId) span.setAttribute('trace.topicId', opts.topicId)
    if (opts.modelName) span.setAttribute('trace.modelName', opts.modelName)
    span.setAttribute('tags', 'HTTP')

    const url = normalizeUrl(input)
    const method = normalizeMethod(input, init)
    span.setAttribute('http.url', url)
    span.setAttribute('http.method', method)
    span.setAttribute('http.request.headers', JSON.stringify(redactHeaders(headersToRecord(init?.headers))))
    // `inputs` carries the request body only — url/method/headers are dedicated attributes so the
    // viewer can render them as detail rows / their own tabs instead of cramming them into the body.
    const requestBody = readRequestBody(init?.body, maxBodyBytes)
    if (requestBody !== undefined) span.setAttribute('inputs', stringifyBody(requestBody))

    let response: Response
    try {
      response = await innerFetch(input, init)
    } catch (error) {
      span.recordException(error as Error)
      span.setStatus({ code: SpanStatusCode.ERROR, message: (error as Error)?.message })
      span.end()
      throw error
    }

    span.setAttribute('http.status', response.status)
    span.setAttribute('http.statusText', response.statusText)
    span.setAttribute('http.response.headers', JSON.stringify(redactHeaders(headersToRecord(response.headers))))

    // No body (GET/HEAD/204) → nothing to tee; settle the span now.
    if (!response.body) {
      span.end()
      return response
    }

    // tee shares chunk references (no byte copy). Branch `a` goes to the SDK;
    // branch `b` is accumulated in the background for the span. accumulateBody
    // MUST cancel `b` at cap/abort/done — otherwise tee buffers the whole
    // response for `b` and backpressures `a` (the real, latency-sensitive read).
    const [a, b] = response.body.tee()
    void accumulateBody(b, maxBodyBytes, init?.signal).then((body) => {
      // `outputs` carries the response body only; status/headers are dedicated attributes.
      if (body) span.setAttribute('outputs', body)
      span.end()
    })

    return new Response(a, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers
    })
  }
}

/** Drain `stream` up to `maxBytes`, then cancel so tee stops buffering. */
async function accumulateBody(
  stream: ReadableStream<Uint8Array>,
  maxBytes: number,
  signal?: AbortSignal | null
): Promise<string> {
  const reader = stream.getReader()
  const onAbort = () => void reader.cancel().catch(() => {})
  signal?.addEventListener('abort', onAbort, { once: true })
  const decoder = new TextDecoder()
  let acc = ''
  try {
    while (acc.length < maxBytes) {
      const { done, value } = await reader.read()
      if (done) break
      if (value) acc += decoder.decode(value, { stream: true })
    }
  } catch {
    // Stream errored mid-read — keep whatever we accumulated.
  } finally {
    void reader.cancel().catch(() => {})
    signal?.removeEventListener('abort', onAbort)
  }
  return truncate(acc, maxBytes)
}

function readRequestBody(body: BodyInit | null | undefined, maxBytes: number): unknown {
  // LLM requests send a JSON string. Non-string bodies (streams, FormData,
  // Blob) aren't synchronously readable here — skip them.
  if (typeof body !== 'string') return undefined
  return body.length <= maxBytes ? parseJsonMaybe(body) : truncate(body, maxBytes)
}

/** Coerce a captured body to the string an OTel attribute requires. */
function stringifyBody(body: unknown): string {
  return typeof body === 'string' ? body : JSON.stringify(body)
}

function parseJsonMaybe(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

function truncate(str: string, max: number): string {
  return str.length > max ? `${str.slice(0, max)}…[truncated ${str.length - max} chars]` : str
}

function redactHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(headers)) {
    out[key] = SENSITIVE_HEADER_KEYS.has(key.toLowerCase()) ? '***' : value
  }
  return out
}

function headersToRecord(headers: HeadersInit | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  if (!headers) return out
  if (headers instanceof Headers) {
    headers.forEach((value, key) => {
      out[key] = value
    })
  } else if (Array.isArray(headers)) {
    for (const [key, value] of headers) out[key] = value
  } else {
    for (const [key, value] of Object.entries(headers)) out[key] = String(value)
  }
  return out
}

function normalizeUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.toString()
  return input.url
}

function normalizeMethod(input: RequestInfo | URL, init?: RequestInit): string {
  const method = init?.method ?? (input instanceof Request ? input.method : undefined) ?? 'GET'
  return method.toUpperCase()
}
