import { application } from '@application'

import type { ProviderConfig } from '../types'

const CHERRY_CLOUD_MESSAGES_PATH = '/v1/messages'
const SDK_API_KEY_PLACEHOLDER = 'managed-by-cherry-cloud'
const UNSAFE_FORWARD_HEADERS = new Set([
  'authorization',
  'connection',
  'content-encoding',
  'content-length',
  'host',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'x-api-key',
  'x-cherry-agent-session-id',
  'x-cherry-fast-mode',
  'x-cherry-internal-request-token',
  'x-cherry-internal-usage-token'
])

function forwardedHeaders(source: Headers): Headers {
  const headers = new Headers()
  for (const [name, value] of source) {
    const normalizedName = name.toLowerCase()
    if (UNSAFE_FORWARD_HEADERS.has(normalizedName) || normalizedName.startsWith('sec-fetch-')) continue
    headers.append(name, value)
  }
  return headers
}

export function buildCherryCloudProviderConfig(endpoint?: string): ProviderConfig<'anthropic'> {
  const service = application.get('CherryCloudService')
  const apiOrigin = new URL(service.getApiOrigin()).origin

  return {
    providerId: 'anthropic',
    endpoint,
    providerSettings: {
      apiKey: SDK_API_KEY_PLACEHOLDER,
      baseURL: new URL('/v1', `${apiOrigin}/`).toString(),
      fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = new Request(input, init)
        const url = new URL(request.url)
        if (url.origin !== apiOrigin || url.pathname !== CHERRY_CLOUD_MESSAGES_PATH) {
          throw new Error('Cherry Cloud requests must stay on the configured Cherry Cloud API origin')
        }

        return service.authenticatedFetch(`${url.pathname}${url.search}`, {
          method: request.method,
          headers: forwardedHeaders(request.headers),
          body: request.body ? await request.text() : undefined,
          signal: request.signal
        })
      }
    }
  }
}
