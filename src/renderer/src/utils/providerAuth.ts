import { cacheService } from '@data/CacheService'
import type { Provider } from '@renderer/types'

export function getRotatedProviderApiKey(provider: Provider, cacheNamespace = 'provider'): string {
  const keys =
    provider.apiKey
      ?.split(',')
      .map((key) => key.trim())
      .filter(Boolean) || []
  if (keys.length === 0) {
    return ''
  }

  const keyName = `${cacheNamespace}:${provider.id}:last_used_key`

  if (keys.length === 1) {
    return keys[0]
  }

  const lastUsedKey = cacheService.getCasual<string>(keyName)
  if (!lastUsedKey) {
    cacheService.setCasual(keyName, keys[0])
    return keys[0]
  }

  const currentIndex = keys.indexOf(lastUsedKey)
  const nextIndex = (currentIndex + 1) % keys.length
  const nextKey = keys[nextIndex]
  cacheService.setCasual(keyName, nextKey)
  return nextKey
}
