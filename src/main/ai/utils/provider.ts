import { providerService } from '@data/services/ProviderService'
import { defaultAppHeaders } from '@main/utils/http'
import { ENDPOINT_TYPE, type EndpointType } from '@shared/data/types/model'
import type { EndpointConfig, Provider } from '@shared/data/types/provider'

const ENDPOINT_FALLBACK_ORDER: readonly EndpointType[] = [
  ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
  ENDPOINT_TYPE.ANTHROPIC_MESSAGES,
  ENDPOINT_TYPE.OPENAI_RESPONSES,
  ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT,
  ENDPOINT_TYPE.OLLAMA_CHAT
]

/**
 * Resolve the endpoint config supplying the base URL.
 *
 * When `preferredEndpoint` is set (e.g. from `model.endpointTypes[0]` for relay providers),
 * its config wins over `defaultChatEndpoint` so per-model routing matches the actual request path.
 */
function resolveEndpointConfig(
  provider: Provider,
  preferredEndpoint?: EndpointType | null
): EndpointConfig | undefined {
  const configs = provider.endpointConfigs
  if (!configs) return undefined

  if (preferredEndpoint && configs[preferredEndpoint]?.baseUrl) {
    return configs[preferredEndpoint]
  }

  const ep = provider.defaultChatEndpoint
  if (ep && configs[ep]?.baseUrl) {
    return configs[ep]
  }

  for (const candidate of ENDPOINT_FALLBACK_ORDER) {
    if (configs[candidate]?.baseUrl) return configs[candidate]
  }

  // Last-resort: any remaining config with a baseUrl (audio / embeddings /
  // rerank / image / video endpoints).
  for (const config of Object.values(configs)) {
    if (config?.baseUrl) return config
  }
  return undefined
}

/** Resolve base URL from provider endpoint configs. */
export function getBaseUrl(provider: Provider, preferredEndpoint?: EndpointType | null): string {
  return resolveEndpointConfig(provider, preferredEndpoint)?.baseUrl ?? ''
}

/** Whether the config supplying the base URL declares the API to serve no version segment. */
export function ignoresApiVersion(provider: Provider, preferredEndpoint?: EndpointType | null): boolean {
  return resolveEndpointConfig(provider, preferredEndpoint)?.ignoreApiVersion === true
}

export function getExtraHeaders(provider: Provider): Record<string, string> {
  const headers = { ...provider.settings?.extraHeaders }
  if (provider.id !== 'radeon-cloud' && provider.presetProviderId !== 'radeon-cloud') {
    return headers
  }

  for (const name of Object.keys(headers)) {
    if (name.toLowerCase() === 'x-source') {
      delete headers[name]
    }
  }
  return { ...headers, 'X-Source': 'cherry-studio' }
}

export function defaultHeaders(provider: Provider): Record<string, string> {
  const apiKey = providerService.getRotatedApiKey(provider.id)
  return {
    ...defaultAppHeaders(),
    ...(apiKey ? { Authorization: `Bearer ${apiKey}`, 'X-Api-Key': apiKey } : {}),
    ...getExtraHeaders(provider)
  }
}
