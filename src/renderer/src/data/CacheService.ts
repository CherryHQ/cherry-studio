import { loggerService } from '@logger'
import type {
  RendererPersistCacheKey,
  RendererPersistCacheSchema,
  UseCacheKey,
  UseCacheSchema,
  UseSharedCacheKey,
  UseSharedCacheSchema
} from '@shared/data/cache/cacheSchemas'
import { DefaultRendererPersistCache } from '@shared/data/cache/cacheSchemas'
import type { CacheEntry, CacheSubscriber, CacheSyncMessage } from '@shared/data/cache/cacheTypes'

const STORAGE_PERSIST_KEY = 'cs_cache_persist'

const logger = loggerService.withContext('CacheService')

/**
 * Renderer process cache service
 *
 * Three-layer caching architecture:
 * 1. Memory cache (cross-component within renderer)
 * 2. Shared cache (cross-window via IPC)
 * 3. Persist cache (cross-window with localStorage persistence)
 *
 * Features:
 * - All APIs are synchronous (including shared cache via local copy)
 * - TTL lazy cleanup (check on get, not timer-based)
 * - Hook reference tracking (prevent deletion of active hooks)
 * - Unified sync mechanism for shared and persist
 * - Type-safe persist cache with predefined schema
 */
export class CacheService {
  private static instance: CacheService

  // Three-layer cache system
  private memoryCache = new Map<string, CacheEntry>() // Cross-component cache
  private sharedCache = new Map<string, CacheEntry>() // Cross-window cache (local copy)
  private persistCache = new Map<RendererPersistCacheKey, any>() // Persistent cache

  // Hook reference tracking
  private activeHooks = new Set<string>()

  // Subscription management
  private subscribers = new Map<string, Set<CacheSubscriber>>()

  // Persist cache debounce
  private persistSaveTimer?: NodeJS.Timeout
  private persistDirty = false

  private constructor() {
    this.initialize()
  }

  /**
   * Get singleton instance
   */
  public static getInstance(): CacheService {
    if (!CacheService.instance) {
      CacheService.instance = new CacheService()
    }
    return CacheService.instance
  }

  public initialize(): void {
    this.loadPersistCache()
    this.setupIpcListeners()
    this.setupWindowUnloadHandler()
    logger.debug('CacheService initialized')
  }

  // ============ Memory Cache (Cross-component) ============

  /**
   * Get value from memory cache
   */
  get<K extends UseCacheKey>(key: K): UseCacheSchema[K]
  get<T>(key: Exclude<string, UseCacheKey>): T | undefined
  get(key: string): any {
    const entry = this.memoryCache.get(key)
    if (entry === undefined) {
      return undefined
    }
    // Check TTL (lazy cleanup)
    if (entry.expireAt && Date.now() > entry.expireAt) {
      this.memoryCache.delete(key)
      this.notifySubscribers(key)
      return undefined
    }

    return entry.value
  }

  /**
   * Set value in memory cache
   */
  set<K extends UseCacheKey>(key: K, value: UseCacheSchema[K]): void
  set<T>(key: Exclude<string, UseCacheKey>, value: T, ttl?: number): void
  set(key: string, value: any, ttl?: number): void {
    const existingEntry = this.memoryCache.get(key)

    // Value comparison optimization
    if (existingEntry && Object.is(existingEntry.value, value)) {
      // Value is same, only update TTL if needed
      const newExpireAt = ttl ? Date.now() + ttl : undefined
      if (!Object.is(existingEntry.expireAt, newExpireAt)) {
        existingEntry.expireAt = newExpireAt
        logger.verbose(`Updated TTL for memory cache key "${key}"`)
      } else {
        logger.verbose(`Skipped memory cache update for key "${key}" - value and TTL unchanged`)
      }
      return // Skip notification
    }

    const entry: CacheEntry = {
      value,
      expireAt: ttl ? Date.now() + ttl : undefined
    }

    this.memoryCache.set(key, entry)
    this.notifySubscribers(key)
    logger.verbose(`Updated memory cache for key "${key}"`)
  }

  /**
   * Check if key exists in memory cache
   */

  has<K extends UseCacheKey>(key: K): boolean
  has(key: Exclude<string, UseCacheKey>): boolean
  has(key: string): boolean {
    const entry = this.memoryCache.get(key)
    if (entry === undefined) {
      return false
    }

    // Check TTL
    if (entry.expireAt && Date.now() > entry.expireAt) {
      this.memoryCache.delete(key)
      this.notifySubscribers(key)
      return false
    }

    return true
  }

  /**
   * Delete from memory cache
   */
  delete<K extends UseCacheKey>(key: K): boolean
  delete(key: Exclude<string, UseCacheKey>): boolean
  delete(key: string): boolean {
    // Check if key is being used by hooks
    if (this.activeHooks.has(key)) {
      logger.error(`Cannot delete key "${key}" as it's being used by useCache hook`)
      return false
    }

    // Check if key exists before attempting deletion
    if (!this.memoryCache.has(key)) {
      logger.verbose(`Skipped memory cache delete for key "${key}" - not exists`)
      return true
    }

    this.memoryCache.delete(key)
    this.notifySubscribers(key)
    logger.verbose(`Deleted memory cache key "${key}"`)
    return true
  }

  /**
   * Check if a key has TTL set (for warning purposes)
   */
  hasTTL<K extends UseCacheKey>(key: K): boolean
  hasTTL(key: Exclude<string, UseCacheKey>): boolean
  hasTTL(key: string): boolean {
    const entry = this.memoryCache.get(key)
    return entry?.expireAt !== undefined
  }

  /**
   * Check if a shared cache key has TTL set (for warning purposes)
   */
  hasSharedTTL<K extends UseSharedCacheKey>(key: K): boolean
  hasSharedTTL(key: Exclude<string, UseSharedCacheKey>): boolean
  hasSharedTTL(key: string): boolean {
    const entry = this.sharedCache.get(key)
    return entry?.expireAt !== undefined
  }

  // ============ Shared Cache (Cross-window) ============

  /**
   * Get value from shared cache
   */
  getShared<K extends UseSharedCacheKey>(key: K): UseSharedCacheSchema[K]
  getShared<T>(key: Exclude<string, UseSharedCacheKey>): T | undefined
  getShared(key: string): any {
    const entry = this.sharedCache.get(key)
    if (!entry) return undefined

    // Check TTL (lazy cleanup)
    if (entry.expireAt && Date.now() > entry.expireAt) {
      this.sharedCache.delete(key)
      this.notifySubscribers(key)
      return undefined
    }

    return entry.value
  }

  /**
   * Set value in shared cache
   */
  setShared<K extends UseSharedCacheKey>(key: K, value: UseSharedCacheSchema[K]): void
  setShared<T>(key: Exclude<string, UseSharedCacheKey>, value: T, ttl?: number): void
  setShared(key: string, value: any, ttl?: number): void {
    const existingEntry = this.sharedCache.get(key)

    // Value comparison optimization
    if (existingEntry && Object.is(existingEntry.value, value)) {
      // Value is same, only update TTL if needed
      const newExpireAt = ttl ? Date.now() + ttl : undefined
      if (!Object.is(existingEntry.expireAt, newExpireAt)) {
        existingEntry.expireAt = newExpireAt
        logger.verbose(`Updated TTL for shared cache key "${key}"`)
        // TTL change still needs broadcast for consistency
        this.broadcastSync({
          type: 'shared',
          key,
          value,
          ttl
        })
      } else {
        logger.verbose(`Skipped shared cache update for key "${key}" - value and TTL unchanged`)
      }
      return // Skip local update and notification
    }

    const entry: CacheEntry = {
      value,
      expireAt: ttl ? Date.now() + ttl : undefined
    }

    // Update local copy first
    this.sharedCache.set(key, entry)
    this.notifySubscribers(key)

    // Broadcast to other windows via Main
    this.broadcastSync({
      type: 'shared',
      key,
      value,
      ttl
    })
    logger.verbose(`Updated shared cache for key "${key}"`)
  }

  /**
   * Check if key exists in shared cache
   */
  hasShared<K extends UseSharedCacheKey>(key: K): boolean
  hasShared(key: Exclude<string, UseSharedCacheKey>): boolean
  hasShared(key: string): boolean {
    const entry = this.sharedCache.get(key)
    if (!entry) return false

    // Check TTL
    if (entry.expireAt && Date.now() > entry.expireAt) {
      this.sharedCache.delete(key)
      this.notifySubscribers(key)
      return false
    }

    return true
  }

  /**
   * Delete from shared cache
   */
  deleteShared<K extends UseSharedCacheKey>(key: K): boolean
  deleteShared(key: Exclude<string, UseSharedCacheKey>): boolean
  deleteShared(key: string): boolean {
    // Check if key is being used by hooks
    if (this.activeHooks.has(key)) {
      logger.error(`Cannot delete key "${key}" as it's being used by useSharedCache hook`)
      return false
    }

    // Check if key exists before attempting deletion
    if (!this.sharedCache.has(key)) {
      logger.verbose(`Skipped shared cache delete for key "${key}" - not exists`)
      return true
    }

    this.sharedCache.delete(key)
    this.notifySubscribers(key)

    // Broadcast deletion to other windows
    this.broadcastSync({
      type: 'shared',
      key,
      value: undefined // undefined means deletion
    })
    logger.verbose(`Deleted shared cache key "${key}"`)
    return true
  }

  // ============ Persist Cache (Cross-window + localStorage) ============

  /**
   * Get value from persist cache
   */
  getPersist<K extends RendererPersistCacheKey>(key: K): RendererPersistCacheSchema[K] {
    const value = this.persistCache.get(key)
    if (value !== undefined) {
      return value
    }

    // Fallback to default value if somehow missing
    const defaultValue = DefaultRendererPersistCache[key]
    this.persistCache.set(key, defaultValue)
    this.schedulePersistSave()
    logger.warn(`Missing persist cache key "${key}", using default value`)
    return defaultValue
  }

  /**
   * Set value in persist cache
   */
  setPersist<K extends RendererPersistCacheKey>(key: K, value: RendererPersistCacheSchema[K]): void {
    const existingValue = this.persistCache.get(key)

    // Use deep comparison for persist cache (usually objects)
    if (this.deepEqual(existingValue, value)) {
      logger.verbose(`Skipped persist cache update for key "${key}" - value unchanged`)
      return // Skip all updates
    }

    this.persistCache.set(key, value)
    this.notifySubscribers(key)

    // Broadcast to other windows
    this.broadcastSync({
      type: 'persist',
      key,
      value
    })

    // Schedule persist save
    this.schedulePersistSave()
    logger.verbose(`Updated persist cache for key "${key}"`)
  }

  /**
   * Check if key exists in persist cache
   */
  hasPersist(key: RendererPersistCacheKey): boolean {
    return this.persistCache.has(key)
  }

  // Note: No deletePersist method as discussed

  // ============ Hook Reference Management ============

  /**
   * Register a hook as using a specific key
   */
  registerHook(key: string): void {
    this.activeHooks.add(key)
  }

  /**
   * Unregister a hook from using a specific key
   */
  unregisterHook(key: string): void {
    this.activeHooks.delete(key)
  }

  // ============ Subscription Management ============

  /**
   * Subscribe to cache changes for specific key
   */
  subscribe(key: string, callback: CacheSubscriber): () => void {
    if (!this.subscribers.has(key)) {
      this.subscribers.set(key, new Set())
    }

    const keySubscribers = this.subscribers.get(key)!
    keySubscribers.add(callback)

    return () => {
      keySubscribers.delete(callback)
      if (keySubscribers.size === 0) {
        this.subscribers.delete(key)
      }
    }
  }

  /**
   * Notify subscribers for specific key
   */
  notifySubscribers(key: string): void {
    const keySubscribers = this.subscribers.get(key)
    if (keySubscribers) {
      keySubscribers.forEach((callback) => {
        try {
          callback()
        } catch (error) {
          logger.error(`Subscriber callback error for key ${key}:`, error as Error)
        }
      })
    }
  }

  // ============ Private Methods ============

  /**
   * Deep equality comparison for cache values
   */
  private deepEqual(a: any, b: any): boolean {
    // Use Object.is for primitive values and same reference
    if (Object.is(a, b)) return true

    // Different types or null/undefined cases
    if (typeof a !== 'object' || typeof b !== 'object') return false
    if (a === null || b === null) return false

    // Array comparison
    if (Array.isArray(a) !== Array.isArray(b)) return false
    if (Array.isArray(a)) {
      if (a.length !== b.length) return false
      for (let i = 0; i < a.length; i++) {
        if (!this.deepEqual(a[i], b[i])) return false
      }
      return true
    }

    // Object comparison
    const keysA = Object.keys(a)
    const keysB = Object.keys(b)

    if (keysA.length !== keysB.length) return false

    for (const key of keysA) {
      if (!keysB.includes(key)) return false
      if (!this.deepEqual(a[key], b[key])) return false
    }

    return true
  }

  /**
   * Load persist cache from localStorage
   */
  private loadPersistCache(): void {
    // First, initialize with default values
    for (const [key, defaultValue] of Object.entries(DefaultRendererPersistCache)) {
      this.persistCache.set(key as RendererPersistCacheKey, defaultValue)
    }

    try {
      const stored = localStorage.getItem(STORAGE_PERSIST_KEY)
      if (!stored) {
        // No stored data, save defaults to localStorage
        this.savePersistCache()
        logger.debug('Initialized persist cache with default values')
        return
      }

      const data = JSON.parse(stored)

      // Only load keys that exist in schema, overriding defaults
      const schemaKeys = Object.keys(DefaultRendererPersistCache) as RendererPersistCacheKey[]
      for (const key of schemaKeys) {
        if (key in data) {
          this.persistCache.set(key, data[key])
        }
      }

      // Clean up localStorage (remove invalid keys and save merged data)
      this.savePersistCache()
      logger.debug('Loaded persist cache from localStorage with defaults')
    } catch (error) {
      logger.error('Failed to load persist cache:', error as Error)
      localStorage.removeItem(STORAGE_PERSIST_KEY)
      // Fallback to defaults only
      logger.debug('Fallback to default persist cache values')
    }
  }

  /**
   * Save persist cache to localStorage
   */
  private savePersistCache(): void {
    try {
      const data: Record<string, any> = {}
      for (const [key, value] of this.persistCache.entries()) {
        data[key] = value
      }

      const jsonData = JSON.stringify(data)
      const size = jsonData.length
      if (size > 1024 * 1024 * 2) {
        logger.warn(
          `Persist cache is too large (${(size / (1024 * 1024)).toFixed(
            2
          )} MB), this may cause performance issues, and may cause data loss, please check your persist cache and reduce the size`
        )
      }

      localStorage.setItem(STORAGE_PERSIST_KEY, jsonData)
      logger.verbose(`Saved persist cache to localStorage, size: ${(size / (1024 * 1024)).toFixed(2)} MB`)
    } catch (error) {
      logger.error('Failed to save persist cache:', error as Error)
    }
  }

  /**
   * Schedule persist cache save with debounce
   */
  private schedulePersistSave(): void {
    this.persistDirty = true

    if (this.persistSaveTimer) {
      clearTimeout(this.persistSaveTimer)
    }

    this.persistSaveTimer = setTimeout(() => {
      this.savePersistCache()
      this.persistDirty = false
    }, 200) // 200ms debounce
  }

  /**
   * Broadcast cache sync message to other windows
   */
  private broadcastSync(message: CacheSyncMessage): void {
    if (window.api?.cache?.broadcastSync) {
      window.api.cache.broadcastSync(message)
    }
  }

  /**
   * Setup IPC listeners for cache synchronization
   */
  private setupIpcListeners(): void {
    if (!window.api?.cache?.onSync) {
      logger.warn('Cache sync API not available')
      return
    }

    // Listen for cache sync messages from other windows
    window.api.cache.onSync((message: CacheSyncMessage) => {
      if (message.type === 'shared') {
        if (message.value === undefined) {
          // Handle deletion
          this.sharedCache.delete(message.key)
        } else {
          // Handle set
          const entry: CacheEntry = {
            value: message.value,
            expireAt: message.ttl ? Date.now() + message.ttl : undefined
          }
          this.sharedCache.set(message.key, entry)
        }
        this.notifySubscribers(message.key)
      } else if (message.type === 'persist') {
        // Update persist cache (other windows only update memory, not localStorage)
        this.persistCache.set(message.key as RendererPersistCacheKey, message.value)
        this.notifySubscribers(message.key)
      }
    })
  }

  /**
   * Setup window unload handler to force save persist cache
   */
  private setupWindowUnloadHandler(): void {
    window.addEventListener('beforeunload', () => {
      if (this.persistDirty) {
        this.savePersistCache()
      }
    })
  }

  /**
   * Cleanup service resources
   */
  public cleanup(): void {
    // Force save persist cache if dirty
    if (this.persistDirty) {
      this.savePersistCache()
    }

    // Clear timers
    if (this.persistSaveTimer) {
      clearTimeout(this.persistSaveTimer)
    }

    // Clear caches
    this.memoryCache.clear()
    this.sharedCache.clear()
    this.persistCache.clear()

    // Clear tracking
    this.activeHooks.clear()
    this.subscribers.clear()

    logger.debug('CacheService cleanup completed')
  }
}

// Export singleton instance
export const cacheService = CacheService.getInstance()
