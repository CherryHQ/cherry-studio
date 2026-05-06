import type { WebSearchCapability } from '@shared/data/preference/preferenceTypes'
import type { ResolvedWebSearchProvider } from '@shared/data/types/webSearch'

const lastUsedKeyByProvider = new Map<ResolvedWebSearchProvider['id'], string>()

export function resolveProviderApiHost(provider: ResolvedWebSearchProvider, capability: WebSearchCapability): string {
  const host = provider.capabilities.find((item) => item.feature === capability)?.apiHost?.trim()
  if (!host) {
    throw new Error(`API host is required for provider ${provider.id} capability ${capability}`)
  }
  return host
}

export function resolveProviderApiKey(provider: ResolvedWebSearchProvider, required: boolean = true): string {
  const keys = provider.apiKeys.map((key) => key.trim()).filter(Boolean)

  if (keys.length === 0) {
    if (required) {
      throw new Error(`API key is required for provider ${provider.id}`)
    }
    return ''
  }

  if (keys.length === 1) {
    return keys[0]
  }

  const lastUsedKey = lastUsedKeyByProvider.get(provider.id)
  const currentIndex = lastUsedKey ? keys.indexOf(lastUsedKey) : -1
  const nextIndex = (currentIndex + 1) % keys.length
  const nextKey = keys[nextIndex]

  lastUsedKeyByProvider.set(provider.id, nextKey)
  return nextKey
}
