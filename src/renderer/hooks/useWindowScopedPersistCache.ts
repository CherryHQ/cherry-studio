import type { CacheSetStateAction } from '@data/CacheService'
import { useCache, usePersistCache } from '@data/hooks/useCache'
import type {
  InferUseCacheValue,
  RendererPersistCacheKey,
  RendererPersistCacheSchema,
  UseCacheKey
} from '@shared/data/cache/cacheSchemas'

import { useWindowFrame } from './useWindowFrame'

type WindowScopedCachePair<K extends RendererPersistCacheKey> = readonly [
  RendererPersistCacheSchema[K],
  (value: CacheSetStateAction<RendererPersistCacheSchema[K]>) => void
]

type IsAny<T> = 0 extends 1 & T ? true : false
type CompatibleWindowCacheKey<K extends RendererPersistCacheKey, W extends UseCacheKey> = IsAny<
  InferUseCacheValue<W>
> extends true
  ? never
  : [RendererPersistCacheSchema[K]] extends [InferUseCacheValue<W>]
    ? [InferUseCacheValue<W>] extends [RendererPersistCacheSchema[K]]
      ? W
      : never
    : never

/** Uses persisted state in the main window and renderer-local state in detached windows. */
export function useWindowScopedPersistCache<K extends RendererPersistCacheKey, W extends UseCacheKey>(
  persistCacheKey: K,
  windowCacheKey: W & CompatibleWindowCacheKey<K, W>
): WindowScopedCachePair<K> {
  const persistedPair = usePersistCache(persistCacheKey)
  const windowPair = useCache(windowCacheKey, persistedPair[0] as unknown as InferUseCacheValue<typeof windowCacheKey>)
  const isWindowFrame = useWindowFrame().mode === 'window'

  return (isWindowFrame ? windowPair : persistedPair) as WindowScopedCachePair<K>
}
