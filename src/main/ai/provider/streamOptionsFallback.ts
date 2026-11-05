import type { FetchFunction } from '@ai-sdk/provider-utils'

/**
 * Automatic fallback for OpenAI-compatible hosts that reject
 * `stream_options.include_usage` with a 400 (e.g. POE proxy, custom gateways).
 *
 * First request keeps `includeUsage:true` so usage telemetry is preserved when
 * supported. On a matching rejection the wrapper retries once with
 * `stream_options` stripped. Covers normal chat and the internal gateway
 * upstream (Pi agent) because both resolve through `providerToAiSdkConfig`.
 */

export function isStreamOptionsRejection(status: number, bodyText: string): boolean {
  if (status !== 400 || !bodyText) return false
  const mentionsStreamOptions = /stream_options|include_usage/i.test(bodyText)
  if (!mentionsStreamOptions) return false
  return /unknown|unrecogn|unsupported|invalid|not supported|not allowed/i.test(bodyText)
}

export function stripStreamOptionsBody(body: BodyInit | null | undefined): string | undefined {
  if (typeof body !== 'string') return undefined
  let json: unknown
  try {
    json = JSON.parse(body)
  } catch {
    return undefined
  }
  if (typeof json !== 'object' || json === null || Array.isArray(json)) return undefined
  if (!('stream_options' in json)) return undefined
  const { stream_options: _dropped, ...rest } = json as Record<string, unknown>
  void _dropped
  try {
    return JSON.stringify(rest)
  } catch {
    return undefined
  }
}

/**
 * Maximum error-body prefix inspected when classifying a 400.
 * `stream_options` rejections are small JSON errors; bounding the read keeps a
 * malformed or hostile endpoint from forcing the wrapper to buffer an
 * arbitrarily large body before the SDK can enforce its own size guard.
 */
export const STREAM_OPTIONS_ERROR_PREFIX_LIMIT = 16 * 1024

/**
 * Read at most `limit` bytes from a cloned response without disturbing the
 * original. Returns `undefined` when the body cannot be inspected.
 */
export async function readErrorPrefix(
  response: Response,
  limit = STREAM_OPTIONS_ERROR_PREFIX_LIMIT
): Promise<string | undefined> {
  try {
    const clone = response.clone()
    if (!clone.body) {
      const text = await clone.text()
      return text.slice(0, limit)
    }
    const reader = clone.body.getReader()
    const chunks: Uint8Array[] = []
    let total = 0
    try {
      while (total < limit) {
        const { done, value } = await reader.read()
        if (done) break
        if (!value) continue
        const remaining = limit - total
        if (value.byteLength > remaining) {
          chunks.push(value.slice(0, remaining))
          total = limit
          break
        }
        chunks.push(value)
        total += value.byteLength
      }
    } finally {
      // Cancel the inspection (cloned/tee'd) branch fire-and-forget so the
      // original stays promptly cancellable. Awaiting the cancel hangs on
      // undici for a partially-read clone, while releasing the lock alone
      // leaves tee backpressure in place and stalls `original.body.cancel()`
      // for a large, still-open 400. Initiating cancellation without awaiting
      // releases that backpressure; the original body remains readable.
      try {
        void reader.cancel().catch(() => {})
      } catch {
        // ignore synchronous cancel errors; lock release below still runs
      }
      try {
        reader.releaseLock()
      } catch {
        // ignore: reader may already be released on some transports
      }
    }
    if (chunks.length === 0) return ''
    const merged = new Uint8Array(total)
    let offset = 0
    for (const chunk of chunks) {
      merged.set(chunk, offset)
      offset += chunk.byteLength
    }
    return new TextDecoder().decode(merged)
  } catch {
    return undefined
  }
}

/**
 * Wrap a provider fetch so `stream_options` is omitted upfront.
 * Used when the endpoint dialect explicitly disables it (`streamOptions: false`)
 * on SDK paths that would otherwise send it unconditionally (notably the
 * `openai`-family `doStream`). Non-JSON bodies pass through untouched.
 */
export function withStreamOptionsOmitted(inner: FetchFunction): FetchFunction {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const stripped = stripStreamOptionsBody(init?.body)
    if (stripped === undefined) return inner(input, init)
    return inner(input, { ...init, body: stripped })
  }
}

/**
 * Wrap a provider fetch so a `stream_options` 400 retries once without the field.
 * Single retry only; non-matching errors and non-JSON bodies pass through untouched.
 * Skips body inspection when the request carries no `stream_options`, and
 * inspects only a bounded prefix so the SDK's own size guard still applies to
 * the untouched original response.
 */
export function withStreamOptionsFallback(inner: FetchFunction): FetchFunction {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const response = await inner(input, init)
    if (response.status !== 400) return response

    const stripped = stripStreamOptionsBody(init?.body)
    if (stripped === undefined) return response

    const bodyText = await readErrorPrefix(response)
    if (bodyText === undefined || !isStreamOptionsRejection(response.status, bodyText)) return response

    return inner(input, { ...init, body: stripped })
  }
}
