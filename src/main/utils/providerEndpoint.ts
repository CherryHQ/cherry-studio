import type { Provider } from '@shared/data/types/provider'

/** The base URL chat requests to this provider go to, or `null` when none is configured. */
export function providerChatBaseUrl(provider: Provider): string | null {
  const endpointConfigs = provider.endpointConfigs ?? {}
  const baseUrl =
    (provider.defaultChatEndpoint && endpointConfigs[provider.defaultChatEndpoint]?.baseUrl) ||
    Object.values(endpointConfigs)[0]?.baseUrl
  if (!baseUrl) return null
  return baseUrl.startsWith('http') ? baseUrl : `https://${baseUrl}`
}
