import { cacheService } from '@data/CacheService'
import { loggerService } from '@logger'
import type { PersistCacheKey, PersistCacheSchema } from '@shared/data/cache/cacheSchemas'
import { useCallback, useEffect, useSyncExternalStore } from 'react'

const logger = loggerService.withContext('useCache')

/**
 * React hook for cross-component memory cache
 *
 * Features:
 * - Synchronous API with useSyncExternalStore
 * - Automatic default value setting
 * - Hook lifecycle management
 * - TTL support with warning when used
 *
 * @param key - Cache key
 * @param defaultValue - Default value (set automatically if not exists)
 * @returns [value, setValue]
 */
export function useCache<T>(key: string, defaultValue?: T): [T | undefined, (value: T) => void] {
  // Subscribe to cache changes
  const value = useSyncExternalStore(
    useCallback((callback) => cacheService.subscribe(key, callback), [key]),
    useCallback(() => cacheService.get<T>(key), [key]),
    useCallback(() => cacheService.get<T>(key), [key]) // SSR snapshot
  )

  // Set default value if not exists
  useEffect(() => {
    if (defaultValue !== undefined && !cacheService.has(key)) {
      cacheService.set(key, defaultValue)
    }
  }, [key, defaultValue])

  // Register hook lifecycle
  useEffect(() => {
    cacheService.registerHook(key)
    return () => cacheService.unregisterHook(key)
  }, [key])

  // Check for TTL warning
  useEffect(() => {
    if (cacheService.hasTTL(key)) {
      logger.warn(
        `useCache hook for key "${key}" is using a cache with TTL. This may cause unstable behavior as the value can expire between renders.`
      )
    }
  }, [key])

  const setValue = useCallback(
    (newValue: T) => {
      cacheService.set(key, newValue)
    },
    [key]
  )

  return [value ?? defaultValue, setValue]
}

/**
 * React hook for cross-window shared cache
 *
 * Features:
 * - Synchronous API (uses local copy)
 * - Cross-window synchronization via IPC
 * - Automatic default value setting
 * - Hook lifecycle management
 *
 * @param key - Cache key
 * @param defaultValue - Default value (set automatically if not exists)
 * @returns [value, setValue]
 */
export function useSharedCache<T>(key: string, defaultValue?: T): [T | undefined, (value: T) => void] {
  // Subscribe to cache changes
  const value = useSyncExternalStore(
    useCallback((callback) => cacheService.subscribe(key, callback), [key]),
    useCallback(() => cacheService.getShared<T>(key), [key]),
    useCallback(() => cacheService.getShared<T>(key), [key]) // SSR snapshot
  )

  // Set default value if not exists
  useEffect(() => {
    if (defaultValue !== undefined && !cacheService.hasShared(key)) {
      cacheService.setShared(key, defaultValue)
    }
  }, [key, defaultValue])

  // Register hook lifecycle
  useEffect(() => {
    cacheService.registerHook(key)
    return () => cacheService.unregisterHook(key)
  }, [key])

  // Check for TTL warning
  useEffect(() => {
    if (cacheService.hasSharedTTL(key)) {
      logger.warn(
        `useSharedCache hook for key "${key}" is using a cache with TTL. This may cause unstable behavior as the value can expire between renders.`
      )
    }
  }, [key])

  const setValue = useCallback(
    (newValue: T) => {
      cacheService.setShared(key, newValue)
    },
    [key]
  )

  return [value ?? defaultValue, setValue]
}

/**
 * React hook for persistent cache with localStorage
 *
 * Features:
 * - Type-safe with predefined schema
 * - Cross-window synchronization
 * - Automatic default value setting
 * - No TTL support (as discussed)
 *
 * @param key - Predefined persist cache key
 * @returns [value, setValue]
 */
export function usePersistCache<K extends PersistCacheKey>(
  key: K
): [PersistCacheSchema[K], (value: PersistCacheSchema[K]) => void] {
  // Subscribe to cache changes
  const value = useSyncExternalStore(
    useCallback((callback) => cacheService.subscribe(key, callback), [key]),
    useCallback(() => cacheService.getPersist(key), [key]),
    useCallback(() => cacheService.getPersist(key), [key]) // SSR snapshot
  )

  // Register hook lifecycle (using string key for tracking)
  useEffect(() => {
    cacheService.registerHook(key)
    return () => cacheService.unregisterHook(key)
  }, [key])

  const setValue = useCallback(
    (newValue: PersistCacheSchema[K]) => {
      cacheService.setPersist(key, newValue)
    },
    [key]
  )

  return [value, setValue]
}
