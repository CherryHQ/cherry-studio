import { cacheService } from '@data/CacheService'
import { loggerService } from '@logger'
import type {
  RendererPersistCacheKey,
  RendererPersistCacheSchema,
  UseCacheKey,
  UseCacheSchema,
  UseSharedCacheKey,
  UseSharedCacheSchema
} from '@shared/data/cache/cacheSchemas'
import { DefaultUseCache, DefaultUseSharedCache } from '@shared/data/cache/cacheSchemas'
import { useCallback, useEffect, useSyncExternalStore } from 'react'
const logger = loggerService.withContext('useCache')

/**
 * React hook for component-level memory cache
 *
 * Use this for data that needs to be shared between components in the same window.
 * Data is lost when the app restarts.
 *
 * @param key - Cache key from the predefined schema
 * @param initValue - Initial value (optional, uses schema default if not provided)
 * @returns [value, setValue] - Similar to useState but shared across components
 *
 * @example
 * ```typescript
 * // Basic usage
 * const [theme, setTheme] = useCache('ui.theme')
 *
 * // With custom initial value
 * const [count, setCount] = useCache('counter', 0)
 *
 * // Update the value
 * setTheme('dark')
 * ```
 */
export function useCache<K extends UseCacheKey>(
  key: K,
  initValue?: UseCacheSchema[K]
): [UseCacheSchema[K], (value: UseCacheSchema[K]) => void] {
  /**
   * Subscribe to cache changes using React's useSyncExternalStore
   * This ensures the component re-renders when the cache value changes
   */
  const value = useSyncExternalStore(
    useCallback((callback) => cacheService.subscribe(key, callback), [key]),
    useCallback(() => cacheService.get<UseCacheSchema[K]>(key), [key]),
    useCallback(() => cacheService.get<UseCacheSchema[K]>(key), [key]) // SSR snapshot
  )

  /**
   * Initialize cache with default value if it doesn't exist
   * Priority: existing cache value > custom initValue > schema default
   */
  useEffect(() => {
    if (cacheService.has(key)) {
      return
    }

    if (initValue === undefined) {
      cacheService.set(key, DefaultUseCache[key])
    } else {
      cacheService.set(key, initValue)
    }
  }, [key, initValue])

  /**
   * Register this hook as actively using the cache key
   * This prevents the cache service from deleting the key while the hook is active
   */
  useEffect(() => {
    cacheService.registerHook(key)
    return () => cacheService.unregisterHook(key)
  }, [key])

  /**
   * Warn developers when using TTL with hooks
   * TTL can cause values to expire between renders, leading to unstable behavior
   */
  useEffect(() => {
    if (cacheService.hasTTL(key)) {
      logger.warn(
        `useCache hook for key "${key}" is using a cache with TTL. This may cause unstable behavior as the value can expire between renders.`
      )
    }
  }, [key])

  /**
   * Memoized setter function for updating the cache value
   * @param newValue - New value to store in cache
   */
  const setValue = useCallback(
    (newValue: UseCacheSchema[K]) => {
      cacheService.set(key, newValue)
    },
    [key]
  )

  return [value ?? initValue ?? DefaultUseCache[key], setValue]
}

/**
 * React hook for cross-window shared cache
 *
 * Use this for data that needs to be shared between all app windows.
 * Data is lost when the app restarts.
 *
 * @param key - Cache key from the predefined schema
 * @param initValue - Initial value (optional, uses schema default if not provided)
 * @returns [value, setValue] - Similar to useState but shared across all windows
 *
 * @example
 * ```typescript
 * // Shared across all windows
 * const [windowCount, setWindowCount] = useSharedCache('app.windowCount')
 *
 * // With custom initial value
 * const [sharedState, setSharedState] = useSharedCache('app.state', { loaded: false })
 *
 * // Changes automatically sync to all open windows
 * setWindowCount(3)
 * ```
 */
export function useSharedCache<K extends UseSharedCacheKey>(
  key: K,
  initValue?: UseSharedCacheSchema[K]
): [UseSharedCacheSchema[K], (value: UseSharedCacheSchema[K]) => void] {
  /**
   * Subscribe to shared cache changes using React's useSyncExternalStore
   * This ensures the component re-renders when the shared cache value changes
   */
  const value = useSyncExternalStore(
    useCallback((callback) => cacheService.subscribe(key, callback), [key]),
    useCallback(() => cacheService.getShared<UseSharedCacheSchema[K]>(key), [key]),
    useCallback(() => cacheService.getShared<UseSharedCacheSchema[K]>(key), [key]) // SSR snapshot
  )

  /**
   * Initialize shared cache with default value if it doesn't exist
   * Priority: existing shared cache value > custom initValue > schema default
   */
  useEffect(() => {
    if (cacheService.hasShared(key)) {
      return
    }

    if (initValue === undefined) {
      cacheService.setShared(key, DefaultUseSharedCache[key])
    } else {
      cacheService.setShared(key, initValue)
    }
  }, [key, initValue])

  /**
   * Register this hook as actively using the shared cache key
   * This prevents the cache service from deleting the key while the hook is active
   */
  useEffect(() => {
    cacheService.registerHook(key)
    return () => cacheService.unregisterHook(key)
  }, [key])

  /**
   * Warn developers when using TTL with shared cache hooks
   * TTL can cause values to expire between renders, leading to unstable behavior
   */
  useEffect(() => {
    if (cacheService.hasSharedTTL(key)) {
      logger.warn(
        `useSharedCache hook for key "${key}" is using a cache with TTL. This may cause unstable behavior as the value can expire between renders.`
      )
    }
  }, [key])

  /**
   * Memoized setter function for updating the shared cache value
   * Changes will be synchronized across all renderer windows
   * @param newValue - New value to store in shared cache
   */
  const setValue = useCallback(
    (newValue: UseSharedCacheSchema[K]) => {
      cacheService.setShared(key, newValue)
    },
    [key]
  )

  return [value ?? initValue ?? DefaultUseSharedCache[key], setValue]
}

/**
 * React hook for persistent cache with localStorage
 *
 * Use this for data that needs to persist across app restarts and be shared between all windows.
 * Data is automatically saved to localStorage.
 *
 * @param key - Cache key from the predefined schema
 * @returns [value, setValue] - Similar to useState but persisted and shared across all windows
 *
 * @example
 * ```typescript
 * // Persisted across app restarts
 * const [userPrefs, setUserPrefs] = usePersistCache('user.preferences')
 *
 * // Automatically saved and synced across all windows
 * const [appSettings, setAppSettings] = usePersistCache('app.settings')
 *
 * // Changes are automatically saved
 * setUserPrefs({ theme: 'dark', language: 'en' })
 * ```
 */
export function usePersistCache<K extends RendererPersistCacheKey>(
  key: K
): [RendererPersistCacheSchema[K], (value: RendererPersistCacheSchema[K]) => void] {
  /**
   * Subscribe to persist cache changes using React's useSyncExternalStore
   * This ensures the component re-renders when the persist cache value changes
   */
  const value = useSyncExternalStore(
    useCallback((callback) => cacheService.subscribe(key, callback), [key]),
    useCallback(() => cacheService.getPersist(key), [key]),
    useCallback(() => cacheService.getPersist(key), [key]) // SSR snapshot
  )

  /**
   * Register this hook as actively using the persist cache key
   * This prevents the cache service from deleting the key while the hook is active
   * Note: Persist cache keys are predefined and generally not deleted
   */
  useEffect(() => {
    cacheService.registerHook(key)
    return () => cacheService.unregisterHook(key)
  }, [key])

  /**
   * Memoized setter function for updating the persist cache value
   * Changes will be synchronized across all windows and persisted to localStorage
   * @param newValue - New value to store in persist cache (must match schema type)
   */
  const setValue = useCallback(
    (newValue: RendererPersistCacheSchema[K]) => {
      cacheService.setPersist(key, newValue)
    },
    [key]
  )

  return [value, setValue]
}
