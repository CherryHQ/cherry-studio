export const MOONSHOT_PROVIDER_ID = 'moonshot'
export const MOONSHOT_DEFAULT_BASE_URL = 'https://api.moonshot.cn/v1'

type ProviderLike = {
  id?: unknown
  apiHost?: unknown
}

/**
 * Returns true when provider id or api host indicates Moonshot.
 */
export function isMoonshotProviderLike(
  provider: ProviderLike,
  moonshotProviderId: string = MOONSHOT_PROVIDER_ID
): boolean {
  if (provider.id === moonshotProviderId) {
    return true
  }

  if (typeof provider.apiHost !== 'string' || provider.apiHost.length === 0) {
    return false
  }

  try {
    const hostname = new URL(provider.apiHost).hostname
    return hostname === 'moonshot.cn' || hostname.endsWith('.moonshot.cn')
  } catch {
    // Keep a permissive fallback for legacy host values that are not valid absolute URLs.
    return provider.apiHost.includes('moonshot.cn')
  }
}
