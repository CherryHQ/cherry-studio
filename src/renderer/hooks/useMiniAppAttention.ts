import { useSharedCacheSelector, useSharedCacheValue } from '@data/hooks/useCache'
import type { CacheMiniAppAttention } from '@shared/data/cache/cacheValueTypes'
import { isEqual } from 'es-toolkit/compat'

/** Module-level, per the `useSharedCacheValue` contract: an inline `[]` is a new identity each render. */
const NO_ATTENTION: CacheMiniAppAttention[] = []

/**
 * Read-only. Main publishes the shared snapshot; every list item and detail entry reads it.
 */
export function useMiniAppAttention(): CacheMiniAppAttention[] {
  return useSharedCacheValue('mini_app.attention') ?? NO_ATTENTION
}

/** This app's dot and its reasons, or `undefined` when it has none. */
export function useMiniAppAttentionFor(appId: string): CacheMiniAppAttention | undefined {
  return useSharedCacheSelector(
    ['mini_app.attention'],
    ([attention]) => (attention ?? NO_ATTENTION).find((entry) => entry.appId === appId),
    isEqual
  )
}
