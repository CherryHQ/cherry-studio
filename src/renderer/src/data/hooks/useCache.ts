import { cacheService } from '@data/CacheService'
import { loggerService } from '@logger'
import type {
  InferUseCacheValue,
  RendererPersistCacheKey,
  RendererPersistCacheSchema,
  SharedCacheKey,
  SharedCacheSchema,
  UseCacheKey,
  UseCacheSchema
} from '@shared/data/cache/cacheSchemas'
import { DefaultSharedCache, DefaultUseCache } from '@shared/data/cache/cacheSchemas'
import { useCallback, useEffect, useSyncExternalStore } from 'react'

const logger = loggerService.withContext('useCache')

// ============================================================================
// Template Matching Utilities
// ============================================================================

/**
 * Checks if a schema key is a template key (contains ${...} placeholder).
 *
 * @param key - The schema key to check
 * @returns true if the key contains template placeholder syntax
 *
 * @example
 * ```typescript
 * isTemplateKey('scroll.position:${id}')  // true
 * isTemplateKey('app.user.avatar')       // false
 * ```
 */
function isTemplateKey(key: string): boolean {
  return key.includes('${') && key.includes('}')
}

/**
 * Converts a template key pattern into a RegExp for matching concrete keys.
 *
 * Each `${variable}` placeholder is replaced with a pattern that matches
 * any non-empty string of word characters, dots, and hyphens.
 *
 * @param template - The template key pattern (e.g., 'scroll.position:${id}')
 * @returns A RegExp that matches concrete keys for this template
 *
 * @example
 * ```typescript
 * const regex = templateToRegex('scroll.position:${id}')
 * regex.test('scroll.position:topic-123')  // true
 * regex.test('scroll.position:')           // false
 * regex.test('other.key:123')              // false
 * ```
 */
function templateToRegex(template: string): RegExp {
  // Escape special regex characters except for ${...} placeholders
  const escaped = template.replace(/[.*+?^${}()|[\]\\]/g, (match) => {
    // Don't escape the ${...} syntax, we'll handle it specially
    if (match === '$' || match === '{' || match === '}') {
      return match
    }
    return '\\' + match
  })

  // Replace ${...} placeholders with a pattern matching non-empty strings
  // Allows: word chars, dots, hyphens, underscores, colons
  const pattern = escaped.replace(/\$\{[^}]+\}/g, '([\\w.\\-_:]+)')

  return new RegExp(`^${pattern}$`)
}

/**
 * Finds the schema key that matches a given concrete key.
 *
 * First checks for exact match (fixed keys), then checks template patterns.
 * This is used to look up default values for template keys.
 *
 * @param key - The concrete key to find a match for
 * @returns The matching schema key, or undefined if no match found
 *
 * @example
 * ```typescript
 * // Given schema has 'app.user.avatar' and 'scroll.position:${id}'
 *
 * findMatchingUseCacheSchemaKey('app.user.avatar')       // 'app.user.avatar'
 * findMatchingUseCacheSchemaKey('scroll.position:123')   // 'scroll.position:${id}'
 * findMatchingUseCacheSchemaKey('unknown.key')           // undefined
 * ```
 */
function findMatchingUseCacheSchemaKey(key: string): keyof UseCacheSchema | undefined {
  // First, check for exact match (fixed keys)
  if (key in DefaultUseCache) {
    return key as keyof UseCacheSchema
  }

  // Then, check template patterns
  const schemaKeys = Object.keys(DefaultUseCache) as Array<keyof UseCacheSchema>
  for (const schemaKey of schemaKeys) {
    if (isTemplateKey(schemaKey as string)) {
      const regex = templateToRegex(schemaKey as string)
      if (regex.test(key)) {
        return schemaKey
      }
    }
  }

  return undefined
}

/**
 * Gets the default value for a cache key from the schema.
 *
 * Works with both fixed keys (direct lookup) and concrete keys that
 * match template patterns (finds template, returns its default).
 *
 * @param key - The cache key (fixed or concrete template instance)
 * @returns The default value from schema, or undefined if not found
 *
 * @example
 * ```typescript
 * // Given schema:
 * // 'app.user.avatar': '' (default)
 * // 'scroll.position:${id}': 0 (default)
 *
 * getUseCacheDefaultValue('app.user.avatar')       // ''
 * getUseCacheDefaultValue('scroll.position:123')   // 0
 * getUseCacheDefaultValue('unknown.key')           // undefined
 * ```
 */
function getUseCacheDefaultValue<K extends UseCacheKey>(key: K): InferUseCacheValue<K> | undefined {
  const schemaKey = findMatchingUseCacheSchemaKey(key)
  if (schemaKey) {
    return DefaultUseCache[schemaKey] as InferUseCacheValue<K>
  }
  return undefined
}

/**
 * React hook for component-level memory cache
 *
 * Use this for data that needs to be shared between components in the same window.
 * Data is lost when the app restarts.
 *
 * Supports both fixed keys and template keys:
 * - Fixed keys: `useCache('app.user.avatar')`
 * - Template keys: `useCache('scroll.position:topic-123')` (matches schema `'scroll.position:${id}'`)
 *
 * @template K - The cache key type (inferred from UseCacheKey)
 * @param key - Cache key from the predefined schema (fixed or matching template pattern)
 * @param initValue - Initial value (optional, uses schema default if not provided)
 * @returns [value, setValue] - Similar to useState but shared across components
 *
 * @example
 * ```typescript
 * // Fixed key usage
 * const [avatar, setAvatar] = useCache('app.user.avatar')
 *
 * // Template key usage (schema: 'scroll.position:${id}': number)
 * const [scrollPos, setScrollPos] = useCache('scroll.position:topic-123')
 * // TypeScript infers scrollPos as number
 *
 * // With custom initial value
 * const [generating, setGenerating] = useCache('chat.generating', true)
 *
 * // Update the value
 * setAvatar('new-avatar-url')
 * ```
 */
export function useCache<K extends UseCacheKey>(
  key: K,
  initValue?: InferUseCacheValue<K>
): [InferUseCacheValue<K>, (value: InferUseCacheValue<K>) => void] {
  // Get the default value for this key (works with both fixed and template keys)
  const defaultValue = getUseCacheDefaultValue(key)

  /**
   * Subscribe to cache changes using React's useSyncExternalStore
   * This ensures the component re-renders when the cache value changes
   */
  const value = useSyncExternalStore(
    useCallback((callback) => cacheService.subscribe(key, callback), [key]),
    useCallback(() => cacheService.get(key) as InferUseCacheValue<K> | undefined, [key]),
    useCallback(() => cacheService.get(key) as InferUseCacheValue<K> | undefined, [key]) // SSR snapshot
  )

  /**
   * Initialize cache with default value if it doesn't exist
   * Priority: existing cache value > custom initValue > schema default (via template matching)
   */
  useEffect(() => {
    if (cacheService.has(key)) {
      return
    }

    if (initValue !== undefined) {
      cacheService.set(key, initValue)
    } else if (defaultValue !== undefined) {
      cacheService.set(key, defaultValue)
    }
  }, [key, initValue, defaultValue])

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
    (newValue: InferUseCacheValue<K>) => {
      cacheService.set(key, newValue)
    },
    [key]
  )

  return [value ?? initValue ?? defaultValue!, setValue]
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
export function useSharedCache<K extends SharedCacheKey>(
  key: K,
  initValue?: SharedCacheSchema[K]
): [SharedCacheSchema[K], (value: SharedCacheSchema[K]) => void] {
  /**
   * Subscribe to shared cache changes using React's useSyncExternalStore
   * This ensures the component re-renders when the shared cache value changes
   */
  const value = useSyncExternalStore(
    useCallback((callback) => cacheService.subscribe(key, callback), [key]),
    useCallback(() => cacheService.getShared(key), [key]),
    useCallback(() => cacheService.getShared(key), [key]) // SSR snapshot
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
      cacheService.setShared(key, DefaultSharedCache[key])
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
    (newValue: SharedCacheSchema[K]) => {
      cacheService.setShared(key, newValue)
    },
    [key]
  )

  return [value ?? initValue ?? DefaultSharedCache[key], setValue]
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
