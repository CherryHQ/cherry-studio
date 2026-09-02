import type { WebSearchCapability, WebSearchProvider } from '@shared/data/preference/preferenceTypes'
import { WEB_SEARCH_FALLBACK_PROVIDER_ID_BY_CAPABILITY } from '@shared/data/presets/webSearchProviders'

/** Whether the selected client provider has enough local configuration to execute a capability. */
export function isWebSearchProviderReady(
  provider: WebSearchProvider | undefined,
  feature: WebSearchCapability
): boolean {
  if (!provider) return false

  const capability = provider.capabilities.find((candidate) => candidate.feature === feature)
  if (!capability) return false

  if (capability.requiresApiHost) {
    const apiHost = capability.apiHost?.trim()
    if (!apiHost) return false

    try {
      const protocol = new URL(apiHost).protocol
      if (protocol !== 'http:' && protocol !== 'https:') return false
    } catch {
      return false
    }
  }

  return !capability.requiresApiKey || provider.apiKeys.some((apiKey) => apiKey.trim().length > 0)
}

export function resolveReadyWebSearchProvider(
  providers: readonly WebSearchProvider[],
  primary: WebSearchProvider | undefined,
  capability: WebSearchCapability
): WebSearchProvider | undefined {
  if (!primary) return undefined
  if (isWebSearchProviderReady(primary, capability)) return primary

  const fallbackProviderId = WEB_SEARCH_FALLBACK_PROVIDER_ID_BY_CAPABILITY[capability]
  if (fallbackProviderId === primary.id) return undefined

  const fallback = providers.find((provider) => provider.id === fallbackProviderId)
  return isWebSearchProviderReady(fallback, capability) ? fallback : undefined
}
