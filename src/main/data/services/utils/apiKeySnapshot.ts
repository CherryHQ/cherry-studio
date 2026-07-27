import { maskApiKey } from '@shared/utils/api'

/**
 * Mask an API key for durable snapshots. The UI helper intentionally leaves
 * short keys unchanged, but persisted snapshots must never contain raw keys.
 */
export function maskApiKeyForSnapshot(key: string): string {
  const masked = maskApiKey(key)
  return masked === key ? '****' : masked
}
