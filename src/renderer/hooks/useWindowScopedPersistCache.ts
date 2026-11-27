import { useState } from 'react'

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
type CompatibleWindowCacheKey<K extends RendererPersistCacheKey, W extends UseCacheKey> =
  IsAny<InferUseCacheValue<W>> extends true
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
  // Seed the window tier from a snapshot taken when the key binds: a live persisted binding would
  // re-seed a nullish local value whenever another window broadcasts the persisted key.
  const [seed, setSeed] = useState(() => ({ key: persistCacheKey, value: persistedPair[0] }))
  if (seed.key !== persistCacheKey) setSeed({ key: persistCacheKey, value: persistedPair[0] })
  const windowPair = useCache(windowCacheKey, seed.value as InferUseCacheValue<typeof windowCacheKey>)
  const isWindowFrame = useWindowFrame().mode === 'window'

  return (isWindowFrame ? windowPair : persistedPair) as WindowScopedCachePair<K>
}
