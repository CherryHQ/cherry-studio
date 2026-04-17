import { loggerService } from '@main/services/LoggerService'
import type { Provider } from '@types'

const logger = loggerService.withContext('ApiServerKeyRotation')

const lastUsedKeyByProvider = new Map<string, string>()

/**
 * Mirrors renderer `getRotatedApiKey` (src/renderer/src/services/ApiService.ts)
 * for the local API server. Splits comma-separated keys, trims, filters empties,
 * and round-robins across calls keyed by provider id.
 *
 * Why: providers configured with "key1,key2,key3" are rotated on the UI path but
 * were previously forwarded verbatim from the API server, causing upstream 403s.
 */
export function getRotatedApiKey(provider: Provider): string {
  if (!provider.apiKey || provider.apiKey.trim() === '') {
    return ''
  }

  const keys = provider.apiKey
    .split(',')
    .map((key) => key.trim())
    .filter(Boolean)

  if (keys.length === 0) {
    return ''
  }

  if (keys.length === 1) {
    return keys[0]
  }

  const lastUsedKey = lastUsedKeyByProvider.get(provider.id)
  if (!lastUsedKey) {
    lastUsedKeyByProvider.set(provider.id, keys[0])
    return keys[0]
  }

  const currentIndex = keys.indexOf(lastUsedKey)

  if (currentIndex === -1) {
    logger.debug('Last used API key no longer found in provider keys, falling back to first key', {
      providerId: provider.id,
      lastUsedKey: lastUsedKey.substring(0, 8) + '...'
    })
  }

  const nextIndex = (currentIndex + 1) % keys.length
  const nextKey = keys[nextIndex]
  lastUsedKeyByProvider.set(provider.id, nextKey)

  return nextKey
}

/** Test-only helper to reset the in-memory rotation state. */
export function __resetRotationStateForTests(): void {
  lastUsedKeyByProvider.clear()
}
