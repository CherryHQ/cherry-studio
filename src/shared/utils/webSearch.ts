import type {
  WebSearchCapability,
  WebSearchProvider,
  WebSearchProviderId
} from '@shared/data/preference/preferenceTypes'
import { WEB_SEARCH_FALLBACK_PROVIDER_IDS_BY_CAPABILITY } from '@shared/data/presets/webSearchProviders'

export type WebSearchProviderReadiness =
  | { ready: true }
  | {
      ready: false
      reason:
        | 'provider_not_configured'
        | 'capability_unsupported'
        | 'api_key_missing'
        | 'api_host_missing'
        | 'api_host_invalid'
    }

/** The provider fallback order for a capability, excluding the selected provider. */
export function getWebSearchFallbackProviderIds(
  primaryProviderId: WebSearchProviderId,
  capability: WebSearchCapability
): WebSearchProviderId[] {
  return WEB_SEARCH_FALLBACK_PROVIDER_IDS_BY_CAPABILITY[capability].filter(
    (providerId) => providerId !== primaryProviderId
  )
}

/** The shared configuration contract used by renderer routing and main-process execution. */
export function getWebSearchProviderReadiness(
  provider: WebSearchProvider | undefined,
  feature: WebSearchCapability
): WebSearchProviderReadiness {
  if (!provider) return { ready: false, reason: 'provider_not_configured' }

  const capability = provider.capabilities.find((candidate) => candidate.feature === feature)
  if (!capability) return { ready: false, reason: 'capability_unsupported' }

  if (capability.requiresApiHost) {
    const apiHost = capability.apiHost?.trim()
    if (!apiHost) return { ready: false, reason: 'api_host_missing' }

    try {
      const protocol = new URL(apiHost).protocol
      if (protocol !== 'http:' && protocol !== 'https:') return { ready: false, reason: 'api_host_invalid' }
    } catch {
      return { ready: false, reason: 'api_host_invalid' }
    }
  }

  if (capability.requiresApiKey && !provider.apiKeys.some((apiKey) => apiKey.trim().length > 0)) {
    return { ready: false, reason: 'api_key_missing' }
  }

  return { ready: true }
}

/** Whether the selected client provider has enough local configuration to execute a capability. */
export function isWebSearchProviderReady(
  provider: WebSearchProvider | undefined,
  feature: WebSearchCapability
): boolean {
  return getWebSearchProviderReadiness(provider, feature).ready
}

export function resolveReadyWebSearchProvider(
  providers: readonly WebSearchProvider[],
  primary: WebSearchProvider | undefined,
  capability: WebSearchCapability
): WebSearchProvider | undefined {
  if (!primary) return undefined

  const candidateIds = [primary.id, ...getWebSearchFallbackProviderIds(primary.id, capability)]
  return candidateIds
    .map((providerId) => providers.find((provider) => provider.id === providerId))
    .find((provider) => isWebSearchProviderReady(provider, capability))
}
