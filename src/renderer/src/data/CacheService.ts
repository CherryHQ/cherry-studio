/**
 * @fileoverview CacheService - Infrastructure component for multi-tier caching (Renderer)
 *
 * NAMING NOTE:
 * This component is named "CacheService" for management consistency, but it is
 * actually an infrastructure component (cache manager) rather than a business service.
 *
 * True Nature: Cache Manager / Infrastructure Utility
 * - Provides 3-tier caching system (memory/shared/persist)
 * - Manages synchronization with Main process and other windows
 * - Contains zero business logic - purely technical functionality
 * - Used by React components via hooks (useCache, useSharedCache, usePersistCache)
 *
 * The "Service" suffix is kept for consistency with existing codebase conventions,
 * but developers should understand this is infrastructure, not business logic.
 *
 * @see {@link CacheService} For implementation details
 */

import { loggerService } from '@logger'
import type {
  InferUseCacheValue,
  RendererPersistCacheKey,
  RendererPersistCacheSchema,
  SharedCacheKey,
  SharedCacheSchema,
  UseCacheKey
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

  // Shared cache ready state for initialization sync
  private sharedCacheReady = false
  private sharedCacheReadyCallbacks: Array<() => void> = []

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

  /**
   * Initialize the cache service with persist cache loading and IPC listeners
   */
  public initialize(): void {
    this.loadPersistCache()
    this.setupIpcListeners()
    this.setupWindowUnloadHandler()

    // Async sync SharedCache from Main (does not block initialization)
    this.syncSharedCacheFromMain()

    logger.debug('CacheService initialized')
  }

  // ============ Memory Cache (Cross-component) ============

  /**
   * Get value from memory cache with TTL validation (type-safe)
   *
   * Supports both fixed keys and template keys:
   * - Fixed keys: `get('app.user.avatar')`
   * - Template keys: `get('scroll.position.topic123')` (matches schema `'scroll.position.${id}'`)
   *
   * Template keys follow the same dot-separated pattern as fixed keys.
   * When ${xxx} is treated as a literal string, the key matches: xxx.yyy.zzz_www
   *
   * DESIGN NOTE: Returns `undefined` when cache miss or TTL expired.
   * This is intentional - developers need to know when a value doesn't exist
   * (e.g., after explicit deletion) and handle it appropriately.
   * For UI components that always need a value, use `useCache` hook instead,
   * which provides automatic default value fallback.
   *
   * @template K - The cache key type (inferred from UseCacheKey, supports template patterns)
   * @param key - Schema-defined cache key (fixed or matching template pattern)
   * @returns Cached value or undefined if not found or expired
   *
   * @example
   * ```typescript
   * // Fixed key - handle undefined explicitly
   * const avatar = cacheService.get('app.user.avatar') ?? ''
   *
   * // Template key (schema: 'scroll.position.${id}': number)
   * const scrollPos = cacheService.get('scroll.position.topic123') ?? 0
   * ```
   */
  get<K extends UseCacheKey>(key: K): InferUseCacheValue<K> | undefined {
    return this.getInternal(key)
  }

  /**
   * Get value from memory cache with TTL validation (casual, dynamic key)
   *
   * Use this for fully dynamic keys that don't match any schema pattern.
   * For keys matching schema patterns (including templates), use `get()` instead.
   *
   * Note: Due to TypeScript limitations with template literal types, compile-time
   * blocking of schema keys works best with literal string arguments. Variable
   * keys are accepted but may not trigger compile errors.
   *
   * @template T - The expected value type (must be specified manually)
   * @param key - Dynamic cache key that doesn't match any schema pattern
   * @returns Cached value or undefined if not found or expired
   *
   * @example
   * ```typescript
   * // Dynamic key with manual type specification
   * const data = cacheService.getCasual<MyDataType>('custom.dynamic.key')
   *
   * // Schema keys should use type-safe methods:
   * // Use: cacheService.get('app.user.avatar')
   * // Instead of: cacheService.getCasual('app.user.avatar')
   * ```
   */
  getCasual<T>(key: Exclude<string, UseCacheKey>): T | undefined {
    return this.getInternal(key)
  }

  /**
   * Internal implementation for memory cache get
   */
  private getInternal(key: string): any {
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
   * Set value in memory cache with optional TTL (type-safe)
   *
   * Supports both fixed keys and template keys:
   * - Fixed keys: `set('app.user.avatar', 'url')`
   * - Template keys: `set('scroll.position.topic123', 100)`
   *
   * Template keys follow the same dot-separated pattern as fixed keys.
   *
   * @template K - The cache key type (inferred from UseCacheKey, supports template patterns)
   * @param key - Schema-defined cache key (fixed or matching template pattern)
   * @param value - Value to cache (type inferred from schema via template matching)
   * @param ttl - Time to live in milliseconds (optional)
   *
   * @example
   * ```typescript
   * // Fixed key
   * cacheService.set('app.user.avatar', 'https://example.com/avatar.png')
   *
   * // Template key (schema: 'scroll.position.${id}': number)
   * cacheService.set('scroll.position.topic123', 150)
   *
   * // With TTL (expires after 30 seconds)
   * cacheService.set('chat.generating', true, 30000)
   * ```
   */
  set<K extends UseCacheKey>(key: K, value: InferUseCacheValue<K>, ttl?: number): void {
    this.setInternal(key, value, ttl)
  }

  /**
   * Set value in memory cache with optional TTL (casual, dynamic key)
   *
   * Use this for fully dynamic keys that don't match any schema pattern.
   * For keys matching schema patterns (including templates), use `set()` instead.
   *
   * @template T - The value type to cache
   * @param key - Dynamic cache key that doesn't match any schema pattern
   * @param value - Value to cache
   * @param ttl - Time to live in milliseconds (optional)
   *
   * @example
   * ```typescript
   * // Dynamic key usage
   * cacheService.setCasual('my.custom.key', { data: 'value' })
   *
   * // With TTL (expires after 60 seconds)
   * cacheService.setCasual('temp.data', result, 60000)
   *
   * // Schema keys should use type-safe methods:
   * // Use: cacheService.set('app.user.avatar', 'url')
   * ```
   */
  setCasual<T>(key: Exclude<string, UseCacheKey>, value: T, ttl?: number): void {
    this.setInternal(key, value, ttl)
  }

  /**
   * Internal implementation for memory cache set
   */
  private setInternal(key: string, value: any, ttl?: number): void {
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
   * Check if key exists in memory cache and is not expired (type-safe)
   * @param key - Schema-defined cache key
   * @returns True if key exists and is valid, false otherwise
   */
  has<K extends UseCacheKey>(key: K): boolean {
    return this.hasInternal(key)
  }

  /**
   * Check if key exists in memory cache and is not expired (casual, dynamic key)
   *
   * Use this for fully dynamic keys that don't match any schema pattern.
   * For keys matching schema patterns (including templates), use `has()` instead.
   *
   * @param key - Dynamic cache key that doesn't match any schema pattern
   * @returns True if key exists and is valid, false otherwise
   *
   * @example
   * ```typescript
   * if (cacheService.hasCasual('my.custom.key')) {
   *   const data = cacheService.getCasual<MyType>('my.custom.key')
   * }
   * ```
   */
  hasCasual(key: Exclude<string, UseCacheKey>): boolean {
    return this.hasInternal(key)
  }

  /**
   * Internal implementation for memory cache has
   */
  private hasInternal(key: string): boolean {
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
   * Delete from memory cache with hook protection (type-safe)
   * @param key - Schema-defined cache key
   * @returns True if deletion succeeded, false if key is protected by active hooks
   */
  delete<K extends UseCacheKey>(key: K): boolean {
    return this.deleteInternal(key)
  }

  /**
   * Delete from memory cache with hook protection (casual, dynamic key)
   *
   * Use this for fully dynamic keys that don't match any schema pattern.
   * For keys matching schema patterns (including templates), use `delete()` instead.
   *
   * @param key - Dynamic cache key that doesn't match any schema pattern
   * @returns True if deletion succeeded, false if key is protected by active hooks
   *
   * @example
   * ```typescript
   * // Delete dynamic cache entry
   * cacheService.deleteCasual('my.custom.key')
   * ```
   */
  deleteCasual(key: Exclude<string, UseCacheKey>): boolean {
    return this.deleteInternal(key)
  }

  /**
   * Internal implementation for memory cache delete
   */
  private deleteInternal(key: string): boolean {
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
   * Check if a key has TTL set in memory cache (type-safe)
   * @param key - Schema-defined cache key
   * @returns True if key has TTL configured
   */
  hasTTL<K extends UseCacheKey>(key: K): boolean {
    const entry = this.memoryCache.get(key)
    return entry?.expireAt !== undefined
  }

  /**
   * Check if a key has TTL set in memory cache (casual, dynamic key)
   *
   * Use this for fully dynamic keys that don't match any schema pattern.
   * For keys matching schema patterns (including templates), use `hasTTL()` instead.
   *
   * @param key - Dynamic cache key that doesn't match any schema pattern
   * @returns True if key has TTL configured
   *
   * @example
   * ```typescript
   * if (cacheService.hasTTLCasual('my.custom.key')) {
   *   console.log('This cache entry will expire')
   * }
   * ```
   */
  hasTTLCasual(key: Exclude<string, UseCacheKey>): boolean {
    const entry = this.memoryCache.get(key)
    return entry?.expireAt !== undefined
  }

  /**
   * Check if a shared cache key has TTL set (type-safe)
   * @param key - Schema-defined shared cache key
   * @returns True if key has TTL configured
   */
  hasSharedTTL<K extends SharedCacheKey>(key: K): boolean {
    const entry = this.sharedCache.get(key)
    return entry?.expireAt !== undefined
  }

  /**
   * Check if a shared cache key has TTL set (casual, dynamic key)
   * @param key - Dynamic shared cache key
   * @returns True if key has TTL configured
   */
  hasSharedTTLCasual(key: Exclude<string, SharedCacheKey>): boolean {
    const entry = this.sharedCache.get(key)
    return entry?.expireAt !== undefined
  }

  // ============ Shared Cache (Cross-window) ============

  /**
   * Get value from shared cache with TTL validation (type-safe)
   * @param key - Schema-defined shared cache key
   * @returns Cached value or undefined if not found or expired
   */
  getShared<K extends SharedCacheKey>(key: K): SharedCacheSchema[K] | undefined {
    return this.getSharedInternal(key)
  }

  /**
   * Get value from shared cache with TTL validation (casual, dynamic key)
   * @param key - Dynamic shared cache key (e.g., `window:${id}`)
   * @returns Cached value or undefined if not found or expired
   */
  getSharedCasual<T>(key: Exclude<string, SharedCacheKey>): T | undefined {
    return this.getSharedInternal(key)
  }

  /**
   * Internal implementation for shared cache get
   */
  private getSharedInternal(key: string): any {
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
   * Set value in shared cache with cross-window synchronization (type-safe)
   * @param key - Schema-defined shared cache key
   * @param value - Value to cache (type inferred from schema)
   * @param ttl - Time to live in milliseconds (optional)
   */
  setShared<K extends SharedCacheKey>(key: K, value: SharedCacheSchema[K], ttl?: number): void {
    this.setSharedInternal(key, value, ttl)
  }

  /**
   * Set value in shared cache with cross-window synchronization (casual, dynamic key)
   * @param key - Dynamic shared cache key (e.g., `window:${id}`)
   * @param value - Value to cache
   * @param ttl - Time to live in milliseconds (optional)
   */
  setSharedCasual<T>(key: Exclude<string, SharedCacheKey>, value: T, ttl?: number): void {
    this.setSharedInternal(key, value, ttl)
  }

  /**
   * Internal implementation for shared cache set
   */
  private setSharedInternal(key: string, value: any, ttl?: number): void {
    const existingEntry = this.sharedCache.get(key)
    const newExpireAt = ttl ? Date.now() + ttl : undefined

    // Value comparison optimization
    if (existingEntry && Object.is(existingEntry.value, value)) {
      // Value is same, only update TTL if needed
      if (!Object.is(existingEntry.expireAt, newExpireAt)) {
        existingEntry.expireAt = newExpireAt
        logger.verbose(`Updated TTL for shared cache key "${key}"`)
        // TTL change still needs broadcast for consistency
        this.broadcastSync({
          type: 'shared',
          key,
          value,
          expireAt: newExpireAt // Use absolute timestamp for precise sync
        })
      } else {
        logger.verbose(`Skipped shared cache update for key "${key}" - value and TTL unchanged`)
      }
      return // Skip local update and notification
    }

    const entry: CacheEntry = {
      value,
      expireAt: newExpireAt
    }

    // Update local copy first
    this.sharedCache.set(key, entry)
    this.notifySubscribers(key)

    // Broadcast to other windows via Main
    this.broadcastSync({
      type: 'shared',
      key,
      value,
      expireAt: newExpireAt // Use absolute timestamp for precise sync
    })
    logger.verbose(`Updated shared cache for key "${key}"`)
  }

  /**
   * Check if key exists in shared cache and is not expired (type-safe)
   * @param key - Schema-defined shared cache key
   * @returns True if key exists and is valid, false otherwise
   */
  hasShared<K extends SharedCacheKey>(key: K): boolean {
    return this.hasSharedInternal(key)
  }

  /**
   * Check if key exists in shared cache and is not expired (casual, dynamic key)
   * @param key - Dynamic shared cache key
   * @returns True if key exists and is valid, false otherwise
   */
  hasSharedCasual(key: Exclude<string, SharedCacheKey>): boolean {
    return this.hasSharedInternal(key)
  }

  /**
   * Internal implementation for shared cache has
   */
  private hasSharedInternal(key: string): boolean {
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
   * Delete from shared cache with cross-window synchronization and hook protection (type-safe)
   * @param key - Schema-defined shared cache key
   * @returns True if deletion succeeded, false if key is protected by active hooks
   */
  deleteShared<K extends SharedCacheKey>(key: K): boolean {
    return this.deleteSharedInternal(key)
  }

  /**
   * Delete from shared cache with cross-window synchronization and hook protection (casual, dynamic key)
   * @param key - Dynamic shared cache key
   * @returns True if deletion succeeded, false if key is protected by active hooks
   */
  deleteSharedCasual(key: Exclude<string, SharedCacheKey>): boolean {
    return this.deleteSharedInternal(key)
  }

  /**
   * Internal implementation for shared cache delete
   */
  private deleteSharedInternal(key: string): boolean {
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
   * Get value from persist cache with automatic default value fallback
   * @param key - Persist cache key to retrieve
   * @returns Cached value or default value if not found
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
   * Set value in persist cache with cross-window sync and localStorage persistence
   * @param key - Persist cache key to store
   * @param value - Value to cache (must match schema type)
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
   * @param key - Persist cache key to check
   * @returns True if key exists in cache
   */
  hasPersist(key: RendererPersistCacheKey): boolean {
    return this.persistCache.has(key)
  }

  // Note: No deletePersist method as discussed

  // ============ Hook Reference Management ============

  /**
   * Register a hook as using a specific cache key to prevent deletion
   * @param key - Cache key being used by the hook
   */
  registerHook(key: string): void {
    this.activeHooks.add(key)
  }

  /**
   * Unregister a hook from using a specific cache key
   * @param key - Cache key no longer being used by the hook
   */
  unregisterHook(key: string): void {
    this.activeHooks.delete(key)
  }

  // ============ Shared Cache Ready State Management ============

  /**
   * Check if shared cache has finished initial sync from Main
   * @returns True if shared cache is ready
   */
  isSharedCacheReady(): boolean {
    return this.sharedCacheReady
  }

  /**
   * Register a callback to be called when shared cache is ready
   * If already ready, callback is invoked immediately
   * @param callback - Function to call when ready
   * @returns Unsubscribe function
   */
  onSharedCacheReady(callback: () => void): () => void {
    if (this.sharedCacheReady) {
      callback()
      return () => {}
    }

    this.sharedCacheReadyCallbacks.push(callback)
    return () => {
      const idx = this.sharedCacheReadyCallbacks.indexOf(callback)
      if (idx >= 0) {
        this.sharedCacheReadyCallbacks.splice(idx, 1)
      }
    }
  }

  /**
   * Mark shared cache as ready and notify all waiting callbacks
   */
  private markSharedCacheReady(): void {
    this.sharedCacheReady = true
    this.sharedCacheReadyCallbacks.forEach((cb) => cb())
    this.sharedCacheReadyCallbacks = []
  }

  /**
   * Sync shared cache from Main process during initialization
   * Uses Main-priority override strategy for conflict resolution
   */
  private async syncSharedCacheFromMain(): Promise<void> {
    if (!window.api?.cache?.getAllShared) {
      logger.warn('Cache getAllShared API not available')
      this.markSharedCacheReady()
      return
    }

    try {
      const allShared = await window.api.cache.getAllShared()
      let syncedCount = 0

      for (const [key, entry] of Object.entries(allShared)) {
        // Skip expired entries
        if (entry.expireAt && Date.now() > entry.expireAt) {
          continue
        }

        const existingEntry = this.sharedCache.get(key)

        // Compare value and expireAt to determine if update is needed
        const valueChanged = !existingEntry || !Object.is(existingEntry.value, entry.value)
        const ttlChanged = !existingEntry || !Object.is(existingEntry.expireAt, entry.expireAt)

        if (valueChanged || ttlChanged) {
          // Main-priority override: always use Main's value
          this.sharedCache.set(key, entry)
          this.notifySubscribers(key) // Only notify on actual change
          syncedCount++
        }
      }

      logger.debug(
        `Synced ${syncedCount} changed shared cache entries from Main (total: ${Object.keys(allShared).length})`
      )
    } catch (error) {
      logger.error('Failed to sync shared cache from Main:', error as Error)
    } finally {
      this.markSharedCacheReady()
    }
  }

  // ============ Subscription Management ============

  /**
   * Subscribe to cache changes for a specific key
   * @param key - Cache key to watch for changes
   * @param callback - Function to call when key changes
   * @returns Unsubscribe function
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
   * Notify all subscribers when a cache key changes
   * @param key - Cache key that changed
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
   * Perform deep equality comparison for cache values
   * @param a - First value to compare
   * @param b - Second value to compare
   * @returns True if values are deeply equal
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
   * Load persist cache from localStorage with default value initialization
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
   * Save persist cache to localStorage with size validation
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
   * Schedule persist cache save with 200ms debounce to avoid excessive writes
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
   * Broadcast cache sync message to other windows via IPC
   * @param message - Cache sync message to broadcast
   */
  private broadcastSync(message: CacheSyncMessage): void {
    if (window.api?.cache?.broadcastSync) {
      window.api.cache.broadcastSync(message)
    }
  }

  /**
   * Setup IPC listeners for receiving cache sync messages from other windows
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
          // Handle set - use expireAt directly (absolute timestamp from sender)
          const entry: CacheEntry = {
            value: message.value,
            expireAt: message.expireAt
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
   * Setup window unload handler to ensure persist cache is saved before exit
   */
  private setupWindowUnloadHandler(): void {
    window.addEventListener('beforeunload', () => {
      if (this.persistDirty) {
        this.savePersistCache()
      }
    })
  }

  /**
   * Cleanup service resources including timers, caches, and event listeners
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
