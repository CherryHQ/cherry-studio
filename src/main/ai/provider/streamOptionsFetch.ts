import type { FetchFunction } from '@ai-sdk/provider-utils'

function stripStreamOptionsBody(body: BodyInit | null | undefined): string | undefined {
  if (typeof body !== 'string' || !body.includes('"stream_options"')) return undefined
  let json: unknown
  try {
    json = JSON.parse(body)
  } catch {
    return undefined
  }
  if (typeof json !== 'object' || json === null || Array.isArray(json)) return undefined
  if (!('stream_options' in json)) return undefined
  delete (json as Record<string, unknown>).stream_options
  return JSON.stringify(json)
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
