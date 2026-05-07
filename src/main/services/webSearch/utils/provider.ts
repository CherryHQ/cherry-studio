import type { WebSearchCapability } from '@shared/data/preference/preferenceTypes'
import type { ResolvedWebSearchProvider } from '@shared/data/types/webSearch'

export function resolveProviderApiHost(provider: ResolvedWebSearchProvider, capability: WebSearchCapability): string {
  const host = provider.capabilities.find((item) => item.feature === capability)?.apiHost?.trim()
  if (!host) {
    throw new Error(`API host is required for provider ${provider.id} capability ${capability}`)
  }
  return host
}

export class ApiKeyRotationState {
  private readonly lastUsedKeyByProvider = new Map<ResolvedWebSearchProvider['id'], string>()

  resolve(provider: ResolvedWebSearchProvider, required: boolean = true): string {
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

    const lastUsedKey = this.lastUsedKeyByProvider.get(provider.id)
    const currentIndex = lastUsedKey ? keys.indexOf(lastUsedKey) : -1
    const nextIndex = (currentIndex + 1) % keys.length
    const nextKey = keys[nextIndex]

    this.lastUsedKeyByProvider.set(provider.id, nextKey)
    return nextKey
  }

  clear(): void {
    this.lastUsedKeyByProvider.clear()
  }
}
