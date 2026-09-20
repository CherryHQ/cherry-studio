import { useRef } from 'react'

import type { CacheSetStateAction } from '@data/CacheService'
import { useCache, usePersistCache } from '@data/hooks/useCache'
import type {
  InferUseCacheValue,
  RendererPersistCacheKey,
  RendererPersistCacheSchema,
  UseCacheKey
} from '@shared/data/cache/cacheSchemas'
import { DefaultUseCache } from '@shared/data/cache/cacheSchemas'

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
  // Seed the window tier from a mount-time snapshot: a live persisted binding would re-seed a
  // nullish local value whenever another window broadcasts the persisted key.
  const seed = useRef(persistedPair[0] as InferUseCacheValue<typeof windowCacheKey>)
  const windowPair = useCache(windowCacheKey, seed.current)
  const isWindowFrame = useWindowFrame().mode === 'window'

  if (!isWindowFrame) return persistedPair

  // useCache's raw snapshot is undefined until its seeding effect lands; the persist tier never
  // returns undefined, so bridge that first frame with the window key's schema default.
  const windowKey: UseCacheKey = windowCacheKey
  const windowValue = windowPair[0] ?? (DefaultUseCache[windowKey] as InferUseCacheValue<W>)
  return [windowValue, windowPair[1]] as unknown as WindowScopedCachePair<K>
}
