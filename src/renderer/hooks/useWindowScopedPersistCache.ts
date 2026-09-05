import type { CacheSetStateAction } from '@data/CacheService'
import { useCache, usePersistCache } from '@data/hooks/useCache'
import type { InferUseCacheValue, RendererPersistCacheSchema, UseCacheKey } from '@shared/data/cache/cacheSchemas'

import { useWindowFrame } from './useWindowFrame'

interface WindowScopedCacheMap {
  'ui.chat.sidebar.width': 'ui.window.chat.sidebar.width'
  'ui.chat.artifact_pane.width': 'ui.window.chat.artifact_pane.width'
  'ui.chat.resource_pane.width': 'ui.window.chat.resource_pane.width'
  'ui.chat.right_pane_open_override': 'ui.window.chat.right_pane_open_override'
  'ui.agent.right_pane_open_override': 'ui.window.agent.right_pane_open_override'
}

type WindowScopedPersistCacheKey = keyof WindowScopedCacheMap
type WindowScopedCachePair<K extends WindowScopedPersistCacheKey> = readonly [
  RendererPersistCacheSchema[K],
  (value: CacheSetStateAction<RendererPersistCacheSchema[K]>) => void
]

const WINDOW_CACHE_KEY_BY_PERSIST_KEY: WindowScopedCacheMap = {
  'ui.chat.sidebar.width': 'ui.window.chat.sidebar.width',
  'ui.chat.artifact_pane.width': 'ui.window.chat.artifact_pane.width',
  'ui.chat.resource_pane.width': 'ui.window.chat.resource_pane.width',
  'ui.chat.right_pane_open_override': 'ui.window.chat.right_pane_open_override',
  'ui.agent.right_pane_open_override': 'ui.window.agent.right_pane_open_override'
}

/** Uses persisted state in the main window and renderer-local state in detached windows. */
export function useWindowScopedPersistCache<K extends WindowScopedPersistCacheKey>(key: K): WindowScopedCachePair<K> {
  const persistedPair = usePersistCache(key)
  const windowCacheKey = WINDOW_CACHE_KEY_BY_PERSIST_KEY[key] as WindowScopedCacheMap[K] & UseCacheKey
  const windowPair = useCache(windowCacheKey, persistedPair[0] as unknown as InferUseCacheValue<typeof windowCacheKey>)
  const isWindowFrame = useWindowFrame().mode === 'window'

  return (isWindowFrame ? windowPair : persistedPair) as WindowScopedCachePair<K>
}
