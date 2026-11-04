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
 */
export function withStreamOptionsFallback(inner: FetchFunction): FetchFunction {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const response = await inner(input, init)
    if (response.status !== 400) return response

    let bodyText = ''
    try {
      bodyText = await response.clone().text()
    } catch {
      return response
    }
    if (!isStreamOptionsRejection(response.status, bodyText)) return response

    const stripped = stripStreamOptionsBody(init?.body)
    if (stripped === undefined) return response

    return inner(input, { ...init, body: stripped })
  }
}
