import type { ApiKeyEntry } from '@shared/data/types/provider'
import { maskApiKey } from '@shared/utils/api'

/** Safe identity snapshot for the API key selected for one provider request. */
export interface ProviderApiKeySnapshot {
  id: string
  label?: string
  masked: string
}

/**
 * Non-secret result of ProviderService's API-key selection.
 *
 * ProviderService owns stored-key selection only. Provider SDK configuration
 * owns the final serving-credential receipt because a builder may replace this
 * selection with OAuth, IAM, or another provider-level credential.
 */
export type ProviderApiKeySelection =
  | ({ attribution: 'explicit' | 'matched' } & ProviderApiKeySnapshot)
  | { attribution: 'unknown' }

/** The selected API-key value and its safe identity, resolved atomically. */
export interface ResolvedProviderApiKey {
  value: string
  apiKeySelection: ProviderApiKeySelection
}

/**
 * Pluggable round-robin state so the selection policy stays pure: the service
 * wires it to CacheService in production, tests pin it to a no-op store.
 */
export interface ApiKeyRotationState {
  getLastUsedKeyId(): string | undefined
  setLastUsedKeyId(keyId: string): void
}

/**
 * Persisted credential receipts must never retain a raw short key, even
 * though the transient display helper intentionally leaves it recognizable.
 */
function maskApiKeyForSnapshot(key: string): string {
  const masked = maskApiKey(key)
  return masked === key ? '****' : masked
}

function toResolvedProviderApiKey(
  value: string,
  attribution: 'explicit' | 'matched',
  entry: ApiKeyEntry
): ResolvedProviderApiKey {
  return {
    value,
    apiKeySelection: {
      attribution,
      id: entry.id,
      ...(entry.label ? { label: entry.label } : {}),
      masked: maskApiKeyForSnapshot(entry.key)
    }
  }
}

function unknownCredential(value: string): ResolvedProviderApiKey {
  return {
    value,
    apiKeySelection: { attribution: 'unknown' }
  }
}

/**
 * Stored-key selection policy shared by production and tests: an explicit
 * override wins (matched back to a stored key when possible), then the
 * preferred key id, then round-robin over the enabled keys.
 */
export function selectProviderApiKey(
  entries: ApiKeyEntry[],
  override: string | undefined,
  preferredKeyId: string | undefined | null,
  rotation: ApiKeyRotationState
): ResolvedProviderApiKey {
  if (override !== undefined) {
    const matched = entries.find((entry) => entry.key === override)
    return matched ? toResolvedProviderApiKey(override, 'matched', matched) : unknownCredential(override)
  }

  if (preferredKeyId) {
    const preferred = entries.find((entry) => entry.id === preferredKeyId)
    if (preferred?.isEnabled) {
      return toResolvedProviderApiKey(preferred.key, 'explicit', preferred)
    }
  }

  const enabledKeys = entries.filter((k) => k.isEnabled)

  if (enabledKeys.length === 0) {
    return unknownCredential('')
  }

  if (enabledKeys.length === 1) {
    return toResolvedProviderApiKey(enabledKeys[0].key, 'explicit', enabledKeys[0])
  }

  // Round-robin using the injected rotation state
  const lastUsedKeyId = rotation.getLastUsedKeyId()

  if (!lastUsedKeyId) {
    rotation.setLastUsedKeyId(enabledKeys[0].id)
    return toResolvedProviderApiKey(enabledKeys[0].key, 'explicit', enabledKeys[0])
  }

  const currentIndex = enabledKeys.findIndex((k) => k.id === lastUsedKeyId)
  const nextIndex = (currentIndex + 1) % enabledKeys.length
  const nextKey = enabledKeys[nextIndex]
  rotation.setLastUsedKeyId(nextKey.id)

  return toResolvedProviderApiKey(nextKey.key, 'explicit', nextKey)
}
