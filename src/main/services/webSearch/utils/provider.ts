import type { WebSearchCapability, WebSearchProvider } from '@shared/data/preference/preferenceTypes'

import { WebSearchConfigError } from '../WebSearchConfigError'

export function resolveProviderApiHost(provider: WebSearchProvider, capability: WebSearchCapability): string {
  const host = provider.capabilities.find((item) => item.feature === capability)?.apiHost?.trim()
  if (!host) {
    throw new WebSearchConfigError(
      'api_host_missing',
      `API host is required for provider ${provider.id} capability ${capability}`
    )
  }

  let protocol: string
  try {
    protocol = new URL(host).protocol
  } catch (cause) {
    throw new WebSearchConfigError(
      'api_host_invalid',
      `API host must be a valid HTTP(S) URL for provider ${provider.id} capability ${capability}`,
      { cause }
    )
  }

  if (protocol !== 'http:' && protocol !== 'https:') {
    throw new WebSearchConfigError(
      'api_host_invalid',
      `API host must be a valid HTTP(S) URL for provider ${provider.id} capability ${capability}`
    )
  }

  return host
}

export class ApiKeyRotationState {
  private readonly lastUsedKeyByProvider = new Map<WebSearchProvider['id'], string>()

  resolve(provider: WebSearchProvider, required: boolean = true): string {
    const keys = provider.apiKeys.map((key) => key.trim()).filter(Boolean)

    if (keys.length === 0) {
      if (required) {
        throw new WebSearchConfigError('api_key_missing', `API key is required for provider ${provider.id}`)
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
