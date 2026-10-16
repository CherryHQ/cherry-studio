import type { ZodType } from 'zod'

import { webSearchCatalog } from '../catalog'
import { WebSearchError } from '../errors'
import { resolveApiHost } from '../tools/config'
import type {
  WebSearchExecuteRequest,
  WebSearchProviderId,
  WebSearchProviderMetadata,
  WebSearchResult,
  WebSearchResultSet,
  WebSearchTransport
} from '../types'

export function metadata(id: WebSearchProviderId): WebSearchProviderMetadata {
  return webSearchCatalog.find((provider) => provider.id === id)!
}
export function fail(
  code = 'invalid_response',
  kind: 'provider' | 'invalid_response' | 'configuration' = 'invalid_response',
  providerCode?: unknown
): never {
  throw new WebSearchError('Web search response or configuration is invalid', {
    kind,
    code,
    providerCode:
      typeof providerCode === 'string' || typeof providerCode === 'number' ? String(providerCode) : undefined
  })
}
export function prepare(
  request: WebSearchExecuteRequest,
  provider: WebSearchProviderMetadata
): { host: string; key: string } {
  const capability = provider.capabilities.find((item) => item.capability === request.capability)
  if (!capability || request.providerId !== provider.id) return fail('capability_unsupported', 'configuration')
  const host = resolveApiHost(request.config.apiHost, capability.defaultApiHost)
  const key = request.credentials?.apiKey ?? ''
  if (capability.requiresApiKey && !key) return fail('api_key_missing', 'configuration')
  return { host, key }
}
export async function send(
  request: WebSearchExecuteRequest,
  transport: WebSearchTransport,
  url: string,
  method: 'GET' | 'POST',
  headers: Record<string, string>,
  body?: unknown
): Promise<string> {
  const response = await transport.request({
    url,
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: request.signal,
    timeoutMs: request.timeoutMs
  })
  if (response.status < 200 || response.status >= 300)
    throw new WebSearchError('Web search HTTP request failed', {
      kind: 'http',
      code: 'http_error',
      httpStatus: response.status,
      retryAfter: response.headers['retry-after'],
      requestId: response.headers['x-request-id']
    })
  return response.bodyText
}
export function json(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return fail('invalid_json')
  }
}
export function decode<T>(schema: ZodType<T>, data: unknown): T {
  const parsed = schema.safeParse(data)
  if (!parsed.success) return fail()
  return parsed.data
}
export function checkFailure(data: unknown): void {
  if (!data || typeof data !== 'object') return
  const envelope = data as Record<string, unknown>
  if (
    envelope.error ||
    envelope.success === false ||
    (envelope.error_code !== undefined && envelope.error_code !== 200) ||
    (envelope.code !== undefined && ![200, '200'].includes(envelope.code as number | string)) ||
    (envelope.status !== undefined && ![200, '200', 'success'].includes(envelope.status as number | string))
  )
    fail(
      'provider_error',
      'provider',
      envelope.error_code ??
        envelope.code ??
        (typeof envelope.error === 'object' && envelope.error !== null
          ? (envelope.error as Record<string, unknown>).code
          : undefined)
    )
}
export function resultSet(request: WebSearchExecuteRequest, results: readonly WebSearchResult[]): WebSearchResultSet {
  if (request.capability === 'fetchUrls' && (!results.length || results.some((result) => !result.content.trim())))
    return fail('empty_content')
  return { providerId: request.providerId, capability: request.capability, input: request.input, results }
}
export function bearer(key: string): Record<string, string> {
  return key ? { Authorization: `Bearer ${key}` } : {}
}
export function isHttp(url: string): boolean {
  try {
    return ['http:', 'https:'].includes(new URL(url).protocol)
  } catch {
    return false
  }
}
