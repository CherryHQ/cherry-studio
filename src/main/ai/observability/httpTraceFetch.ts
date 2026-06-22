import type { FetchFunction } from '@ai-sdk/provider-utils'
import { loggerService } from '@logger'
import { context, SpanStatusCode, trace, type Tracer } from '@opentelemetry/api'
import { KB } from '@shared/utils/constants'

import { TRACER_NAME } from './constants'

const logger = loggerService.withContext('httpTraceFetch')

/**
 * Soft cap on how much of a request/response body we capture into a span.
 * Compared against JS string `.length` (UTF-16 code units after decoding), not
 * raw byte length — an approximation that bounds span size without re-encoding
 * every chunk.
 */
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
    // Capturing request metadata must never break the real request: if any of the
    // url/header/body helpers throw, drop tracing for this call and fall back to
    // the untraced fetch.
    try {
      if (opts.topicId) span.setAttribute('trace.topicId', opts.topicId)
      if (opts.modelName) span.setAttribute('trace.modelName', opts.modelName)
      span.setAttribute('tags', 'HTTP')

      const url = normalizeUrl(input)
      const method = normalizeMethod(input, init)
      span.setAttribute('http.url', redactUrl(url))
      span.setAttribute('http.method', method)
      span.setAttribute('http.request.headers', JSON.stringify(redactHeaders(headersToRecord(init?.headers))))
      // `inputs` carries the request body only — url/method/headers are dedicated attributes so the
      // viewer can render them as detail rows / their own tabs instead of cramming them into the body.
      const requestBody = readRequestBody(init?.body, maxBodyBytes)
      if (requestBody !== undefined) span.setAttribute('inputs', stringifyBody(requestBody))
    } catch (error) {
      logger.warn('httpTraceFetch request-span setup failed; proceeding untraced', { error })
      span.end()
      return innerFetch(input, init)
    }

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
    // response.url is not always populated after a redirect, but when present it
    // carries the same `?key=`/userinfo secrets as the request url — redact it too.
    if (response.url) span.setAttribute('http.response.url', redactUrl(response.url))

    // No body (GET/HEAD/204) → nothing to tee; settle the span now.
    if (!response.body) {
      span.end()
      return response
    }

    // tee shares chunk references (no byte copy). Branch `a` goes to the SDK;
    // branch `b` is accumulated in the background for the span. The capture path
    // MUST NEVER break the real AI streaming path, so tee() and the replacement
    // Response constructor are guarded separately.
    let branches: [ReadableStream<Uint8Array>, ReadableStream<Uint8Array>]
    try {
      branches = response.body.tee()
    } catch (error) {
      // tee() unavailable (e.g. a custom-fetch body) — original body is untouched.
      logger.warn('httpTraceFetch tee failed, returning original response', { error })
      span.setAttribute('http.trace.captureError', String(error))
      span.end()
      return response
    }

    const [sdkBranch, captureBranch] = branches
    // Build the SDK-facing response BEFORE kicking off the background accumulate,
    // so a constructor failure here can't double-end the span the accumulate
    // chain owns, nor return the original body that tee() has already locked.
    let tracedResponse: Response
    try {
      tracedResponse = new Response(sdkBranch, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers
      })
    } catch (error) {
      logger.warn('httpTraceFetch Response construction failed after tee', { error })
      span.setAttribute('http.trace.captureError', String(error))
      span.end()
      void captureBranch.cancel().catch(() => {})
      // tee locked the original body; hand the SDK a minimal Response over `a`.
      return new Response(sdkBranch)
    }

    void accumulateBody(captureBranch, maxBodyBytes, init?.signal)
      .then(({ body, error }) => {
        if (body) span.setAttribute('outputs', body)
        if (error) {
          span.recordException(error as Error)
          span.setStatus({ code: SpanStatusCode.ERROR, message: (error as Error)?.message })
        } else if (init?.signal?.aborted) {
          span.setStatus({ code: SpanStatusCode.ERROR, message: 'request aborted before body completed' })
        }
        span.end()
      })
      .catch((error) => {
        logger.warn('httpTraceFetch body accumulation failed', { error })
        span.recordException(error as Error)
        span.setStatus({ code: SpanStatusCode.ERROR, message: 'body accumulation failed' })
        span.end()
      })

    return tracedResponse
  }
}

/** Drain `stream` up to `maxBytes`, then cancel so tee stops buffering. */
async function accumulateBody(
  stream: ReadableStream<Uint8Array>,
  maxBytes: number,
  signal?: AbortSignal | null
): Promise<{ body: string; error?: unknown }> {
  const reader = stream.getReader()
  const onAbort = () => void reader.cancel().catch(() => {})
  signal?.addEventListener('abort', onAbort, { once: true })
  const decoder = new TextDecoder()
  let acc = ''
  let streamError: unknown
  try {
    while (acc.length < maxBytes) {
      const { done, value } = await reader.read()
      if (done) break
      if (value) acc += decoder.decode(value, { stream: true })
    }
  } catch (error) {
    // Stream errored mid-read — keep whatever we accumulated, but surface the
    // error so the span is marked failed instead of looking like a clean exchange.
    streamError = error
  } finally {
    void reader.cancel().catch(() => {})
    signal?.removeEventListener('abort', onAbort)
  }
  return { body: truncate(acc, maxBytes), error: streamError }
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

// Some providers carry the API key in the query string (Gemini `?key=`, proxies `?api-key=`).
// Redact those so secrets don't reach the NDJSON trace file, the way header redaction prevents.
const SENSITIVE_QUERY_KEYS = new Set(['key', 'api_key', 'api-key', 'apikey', 'access_token', 'token', 'x-goog-api-key'])

function redactUrl(rawUrl: string): string {
  try {
    const u = new URL(rawUrl)
    let changed = false
    for (const k of [...u.searchParams.keys()]) {
      if (SENSITIVE_QUERY_KEYS.has(k.toLowerCase())) {
        u.searchParams.set(k, '***')
        changed = true
      }
    }
    // Userinfo (`user:pass@host`) carries the same credentials as a `?key=` — strip it too so a
    // proxy URL like `https://user:secret@host/v1` never lands verbatim in the trace file.
    if (u.username || u.password) {
      u.username = ''
      u.password = ''
      changed = true
    }
    return changed ? u.toString() : rawUrl
  } catch {
    // Relative or malformed URL (no host) — nothing to parse safely; leave it untouched.
    return rawUrl
  }
}

function normalizeMethod(input: RequestInfo | URL, init?: RequestInit): string {
  const method = init?.method ?? (input instanceof Request ? input.method : undefined) ?? 'GET'
  return method.toUpperCase()
}
