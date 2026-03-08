export const MOONSHOT_PROVIDER_ID = 'moonshot'
export const MOONSHOT_DEFAULT_BASE_URL = 'https://api.moonshot.cn/v1'

type ProviderLike = {
  id?: unknown
  apiHost?: unknown
}

function isMoonshotHostname(hostname: string): boolean {
  return hostname === 'moonshot.cn' || hostname.endsWith('.moonshot.cn')
}

function parseHostname(apiHost: string): string | null {
  try {
    return new URL(apiHost).hostname.toLowerCase()
  } catch {
    // Fallback for legacy host values that may omit protocol (e.g. api.moonshot.cn/v1).
    try {
      return new URL(`https://${apiHost}`).hostname.toLowerCase()
    } catch {
      return null
    }
  }
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

  const hostname = parseHostname(provider.apiHost)
  if (!hostname) {
    return false
  }

  return isMoonshotHostname(hostname)
}
