import { providerService } from '@data/services/ProviderService'
import { ENDPOINT_TYPE, type EndpointType } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { defaultAppHeaders } from '@shared/utils'

const ENDPOINT_FALLBACK_ORDER: readonly EndpointType[] = [
  ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
  ENDPOINT_TYPE.ANTHROPIC_MESSAGES,
  ENDPOINT_TYPE.OPENAI_RESPONSES,
  ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT,
  ENDPOINT_TYPE.OLLAMA_CHAT
]

/**
 * Resolve base URL from provider endpoint configs.
 *
 * When `preferredEndpoint` is set (e.g. from `model.endpointTypes[0]` for relay providers),
 * its config wins over `defaultChatEndpoint` so per-model routing matches the actual request path.
 */
export function getBaseUrl(provider: Provider, preferredEndpoint?: EndpointType | null): string {
  const configs = provider.endpointConfigs
  if (!configs) return ''

  if (preferredEndpoint && configs[preferredEndpoint]?.baseUrl) {
    return configs[preferredEndpoint].baseUrl
  }

  const ep = provider.defaultChatEndpoint
  if (ep && configs[ep]?.baseUrl) {
    return configs[ep].baseUrl
  }

  for (const candidate of ENDPOINT_FALLBACK_ORDER) {
    if (configs[candidate]?.baseUrl) return configs[candidate].baseUrl
  }

  // Last-resort: any remaining config with a baseUrl (audio / embeddings /
  // rerank / image / video endpoints).
  for (const config of Object.values(configs)) {
    if (config?.baseUrl) return config.baseUrl
  }
  return ''
}

export function getExtraHeaders(provider: Provider): Record<string, string> {
  return provider.settings?.extraHeaders ?? {}
}

export async function defaultHeaders(provider: Provider, apiKeyOverride?: string): Promise<Record<string, string>> {
  const apiKey = apiKeyOverride ?? (await providerService.getRotatedApiKey(provider.id))
  return {
    ...defaultAppHeaders(),
    ...(apiKey ? { Authorization: `Bearer ${apiKey}`, 'X-Api-Key': apiKey } : {}),
    ...getExtraHeaders(provider)
  }
}

export function routeToEndpoint(apiHost: string): { baseURL: string; endpoint: string } {
  const trimmedHost = (apiHost || '').trim()
  if (!trimmedHost.endsWith('#')) {
    return { baseURL: trimmedHost.replace(/\/+$/, ''), endpoint: '' }
  }
  const host = trimmedHost.slice(0, -1)
  const SUPPORTED_ENDPOINTS = [
    'chat/completions',
    'responses',
    'messages',
    'generateContent',
    'streamGenerateContent',
    'images/generations',
    'images/edits',
    'predict'
  ]
  const endpointMatch = SUPPORTED_ENDPOINTS.find((ep) => host.endsWith(ep))
  if (!endpointMatch) {
    return { baseURL: host.replace(/\/+$/, ''), endpoint: '' }
  }
  const baseSegment = host.slice(0, host.length - endpointMatch.length)
  const baseURL = baseSegment.replace(/\/+$/, '').replace(/:$/, '')
  return { baseURL, endpoint: endpointMatch }
}
