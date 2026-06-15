/**
 * @fileoverview CacheService - Infrastructure component for multi-tier caching
 *
 * NAMING NOTE:
 * This component is named "CacheService" for management consistency, but it is
 * actually an infrastructure component (cache manager) rather than a business service.
 *
 * True Nature: Cache Manager / Infrastructure Utility
 * - Provides low-level caching primitives (memory/shared/persist tiers)
 * - Manages TTL, expiration, and cross-window synchronization via IPC
 * - Contains zero business logic - purely technical functionality
 * - Acts as a utility for other services (PreferenceService, business services)
 *
 * The "Service" suffix is kept for consistency with existing codebase conventions,
 * but developers should understand this is infrastructure, not business logic.
 *
 * @see {@link CacheService} For implementation details
 */

import { loggerService } from '@logger'
import { BaseService, type Disposable, Injectable, ServicePhase } from '@main/core/lifecycle'
import { Phase } from '@main/core/lifecycle'
import type { InferSharedCacheValue, ProcessKey, SharedCacheKey } from '@shared/data/cache/cacheSchemas'
import type { CacheEntry, CacheSyncMessage } from '@shared/data/cache/cacheTypes'
import { isTemplateKey, templateToRegex } from '@shared/data/cache/templateKey'
import { IpcChannel } from '@shared/IpcChannel'
import { BrowserWindow } from 'electron'
import { isEqual } from 'lodash'

const logger = loggerService.withContext('CacheService')

/**
 * Callback signature for cache subscriptions. `concreteKey` is the exact key
 * that changed — for template subscriptions it is the matched instance, for
 * exact subscriptions it equals the subscribed key.
 */
type CacheSubscriptionCallback = (newValue: any, oldValue: any, concreteKey: string) => void

/**
 * Observer for cache-change notifications. Supports two subscription shapes:
 * - Exact keys (hash lookup on every notify)
 * - Template keys containing `${...}` (regex-matched against every concrete key)
 *
 * Internal cache subscribers only ever use exact keys; shared cache subscribers
 * may use either. Errors in callbacks are isolated per-subscriber.
 */
class CacheNotifier {
  private subscriptions = new Map<string, Set<CacheSubscriptionCallback>>()

  subscribe(subscriptionKey: string, callback: CacheSubscriptionCallback): () => void {
    let set = this.subscriptions.get(subscriptionKey)
    if (!set) {
      set = new Set()
      this.subscriptions.set(subscriptionKey, set)
    }
    set.add(callback)

    return () => {
      const current = this.subscriptions.get(subscriptionKey)
      if (!current) return
      current.delete(callback)
      if (current.size === 0) {
        this.subscriptions.delete(subscriptionKey)
      }
    }
  }

  notify(concreteKey: string, newValue: unknown, oldValue: unknown): void {
    // Exact match path: O(1) hash lookup
    const exact = this.subscriptions.get(concreteKey)
    if (exact && exact.size > 0) {
      this.invokeAll(exact, concreteKey, newValue, oldValue)
    }

    // Template match path: iterate only keys that contain ${...}
    for (const [subscriptionKey, set] of this.subscriptions) {
      if (subscriptionKey === concreteKey) continue
      if (!isTemplateKey(subscriptionKey)) continue
      const regex = templateToRegex(subscriptionKey)
      if (regex.test(concreteKey)) {
        this.invokeAll(set, concreteKey, newValue, oldValue)
      }
    }
  }

  clear(): void {
    this.subscriptions.clear()
  }

  getListenerCount(subscriptionKey?: string): number {
    if (subscriptionKey) {
      return this.subscriptions.get(subscriptionKey)?.size ?? 0
    }
    let total = 0
    for (const set of this.subscriptions.values()) {
      total += set.size
    }
    return total
  }

  private invokeAll(
    set: Set<CacheSubscriptionCallback>,
    concreteKey: string,
    newValue: unknown,
    oldValue: unknown
  ): void {
    // Snapshot to allow callbacks to (un)subscribe without breaking iteration
    const callbacks = [...set]
    for (const callback of callbacks) {
      try {
        callback(newValue, oldValue, concreteKey)
      } catch (error) {
        logger.error(`Error in cache subscription callback for "${concreteKey}":`, error as Error)
      }
    }
  }
}

/**
 * Main process cache service
 *
 * Features:
 * - Main process internal cache with TTL support
 * - IPC handlers for cross-window cache synchronization
 * - Broadcast mechanism for shared cache sync
 * - Minimal storage (persist cache interface reserved for future)
 *
 * Responsibilities:
 * 1. Provide cache for Main process services
 * 2. Relay cache sync messages between renderer windows
 * 3. Reserve persist cache interface (not implemented yet)
 */
@Injectable('CacheService')
@ServicePhase(Phase.BeforeReady)
export class CacheService extends BaseService {
  // Main process internal cache
  private cache = new Map<string, CacheEntry>()

  // Shared cache (synchronized with renderer windows)
  private sharedCache = new Map<string, CacheEntry>()

  // Subscription notifiers — physically isolated per keyspace for easier debugging
  private internalNotifier = new CacheNotifier()
  private sharedNotifier = new CacheNotifier()

  // GC timer reference and interval time (e.g., every 10 minutes)
  private gcInterval: Disposable | null = null
  private readonly GC_INTERVAL_MS = 10 * 60 * 1000

  constructor() {
    super()
  }

  protected async onInit(): Promise<void> {
    this.registerIpcHandlers()
    this.startGarbageCollection()
    logger.info('CacheService initialized')
  }

  protected async onStop(): Promise<void> {
    // GC timer is auto-disposed via registerInterval; just drop the reference.
    this.gcInterval = null

    // Clear caches
    this.cache.clear()
    this.sharedCache.clear()

    // Clear subscription notifiers — lifecycle end, subscribers should not fire
    this.internalNotifier.clear()
    this.sharedNotifier.clear()

    logger.debug('CacheService cleanup completed')
  }

  // ============ Main Process Cache (Internal) ============

  /**
   * Garbage collection logic for both internal and shared cache
   */
  private startGarbageCollection() {
    if (this.gcInterval) return

    this.gcInterval = this.registerInterval(() => {
      const now = Date.now()
      let removedCount = 0

      // Clean internal cache
      for (const [key, entry] of this.cache.entries()) {
        if (entry.expireAt && now > entry.expireAt) {
          this.cache.delete(key)
          removedCount++
        }
      }

      // Clean shared cache
      for (const [key, entry] of this.sharedCache.entries()) {
        if (entry.expireAt && now > entry.expireAt) {
          this.sharedCache.delete(key)
          removedCount++
        }
      }

      if (removedCount > 0) {
        logger.debug(`Garbage collection removed ${removedCount} expired items`)
      }
    }, this.GC_INTERVAL_MS)
  }

  /**
   * Read the current (non-expired) value for an internal cache key.
   * Does NOT mutate the cache — use `get`/`has` if lazy cleanup is desired.
   */
  private peekInternal(key: string): unknown {
    const entry = this.cache.get(key)
    if (!entry) return undefined
    if (entry.expireAt && Date.now() > entry.expireAt) return undefined
    return entry.value
  }

  /**
   * Read the current (non-expired) value for a shared cache key.
   * Does NOT mutate the cache.
   */
  private peekShared(key: string): unknown {
    const entry = this.sharedCache.get(key)
    if (!entry) return undefined
    if (entry.expireAt && Date.now() > entry.expireAt) return undefined
    return entry.value
  }

  /**
   * Get value from main process cache
   */
  get<T>(key: string): T | undefined {
    const entry = this.cache.get(key)
    if (!entry) return undefined

    // Check TTL (lazy cleanup)
    if (entry.expireAt && Date.now() > entry.expireAt) {
      this.cache.delete(key)
      return undefined
    }

    return entry.value as T
  }

  /**
   * Set value in main process cache
   */
  set<T>(key: string, value: T, ttl?: number): void {
    const oldValue = this.peekInternal(key)
    const entry: CacheEntry<T> = {
      value,
      expireAt: ttl ? Date.now() + ttl : undefined
    }

    this.cache.set(key, entry)

    // Fire subscribers only when the value actually changed.
    // TTL-only refresh (same value, new expireAt) intentionally does not fire.
    if (!isEqual(oldValue, value)) {
      this.internalNotifier.notify(key, value, oldValue)
    }
  }

  /**
   * Check if key exists in main process cache
   */
  has(key: string): boolean {
    const entry = this.cache.get(key)
    if (!entry) return false

    // Check TTL
    if (entry.expireAt && Date.now() > entry.expireAt) {
      this.cache.delete(key)
      return false
    }

    return true
  }

  /**
   * Delete from main process cache
   */
  delete(key: string): boolean {
    const oldValue = this.peekInternal(key)
    const removed = this.cache.delete(key)

    // Only fire if an actual non-expired value was present before.
    if (oldValue !== undefined) {
      this.internalNotifier.notify(key, undefined, oldValue)
    }

    return removed
  }

  // ============ Shared Cache (Cross-window via IPC) ============

  /**
   * Get value from shared cache with TTL validation (type-safe)
   * @param key - Schema-defined shared cache key
   * @returns Cached value or undefined if not found or expired
   */
  getShared<K extends SharedCacheKey>(key: K): InferSharedCacheValue<K> | undefined {
    const entry = this.sharedCache.get(key)
    if (!entry) return undefined

    // Check TTL (lazy cleanup)
    if (entry.expireAt && Date.now() > entry.expireAt) {
      this.sharedCache.delete(key)
      return undefined
    }

    return entry.value as InferSharedCacheValue<K>
  }

  /**
   * Set value in shared cache with cross-window broadcast (type-safe)
   * @param key - Schema-defined shared cache key
   * @param value - Value to cache (type inferred from schema)
   * @param ttl - Time to live in milliseconds (optional)
   */
  setShared<K extends SharedCacheKey>(key: K, value: InferSharedCacheValue<K>, ttl?: number): void {
    const oldValue = this.peekShared(key)
    const expireAt = ttl ? Date.now() + ttl : undefined
    const entry: CacheEntry = { value, expireAt }

    this.sharedCache.set(key, entry)

    // Skip broadcast + notify when value hasn't changed.
    // TTL-only refresh updates the entry silently (aligned with set() semantics).
    if (isEqual(oldValue, value)) {
      return
    }

    // Broadcast to all renderer windows
    this.broadcastSync({
      type: 'shared',
      key,
      value,
      expireAt
    })

    this.sharedNotifier.notify(key, value, oldValue)
  }

  /**
   * Check if key exists in shared cache and is not expired (type-safe)
   * @param key - Schema-defined shared cache key
   * @returns True if key exists and is valid, false otherwise
   */
  hasShared<K extends SharedCacheKey>(key: K): boolean {
    const entry = this.sharedCache.get(key)
    if (!entry) return false

    // Check TTL
    if (entry.expireAt && Date.now() > entry.expireAt) {
      this.sharedCache.delete(key)
      return false
    }

    return true
  }

  /**
   * Delete from shared cache with cross-window broadcast (type-safe)
   * @param key - Schema-defined shared cache key
   * @returns True if deletion succeeded
   */
  deleteShared<K extends SharedCacheKey>(key: K): boolean {
    const oldValue = this.peekShared(key)

    if (oldValue === undefined) {
      // Key absent or already expired — no-op, no broadcast, no fire.
      // Still clear any tombstone entry to match previous best-effort behavior.
      this.sharedCache.delete(key)
      return true
    }

    this.sharedCache.delete(key)

    // Broadcast deletion to all renderer windows
    this.broadcastSync({
      type: 'shared',
      key,
      value: undefined // undefined means deletion
    })

    this.sharedNotifier.notify(key, undefined, oldValue)

    return true
  }

  /**
   * Subscribe to internal cache changes for an exact key.
   *
   * Fire semantics:
   * - Fires on explicit `set` (when value actually differs via lodash.isEqual)
   *   and on `delete` (when a non-expired value existed).
   * - Does NOT fire on TTL-only refresh (same value, new expireAt).
   * - Does NOT fire on lazy TTL cleanup, GC sweeps, or onStop clearing.
   * - Does NOT fire immediately with the current value upon subscription —
   *   consumers should call `get()` themselves if they need initial state.
   * - Re-entrance is allowed: callbacks may call `set()` on the same key.
   *   Infinite loops are naturally terminated by the isEqual short-circuit.
   * - Callback errors are caught and logged; other subscribers still fire.
   *
   * @returns unsubscribe function (compatible with `registerDisposable`)
   */
  subscribeChange<T = unknown>(
    key: string,
    callback: (newValue: T | undefined, oldValue: T | undefined) => void
  ): () => void {
    return this.internalNotifier.subscribe(key, (newValue, oldValue) => {
      callback(newValue as T | undefined, oldValue as T | undefined)
    })
  }

  /**
   * Subscribe to shared cache changes. Supports both exact keys and template
   * keys (e.g. `'web_search.provider.last_used_key.${providerId}'`).
   *
   * Fire semantics are identical to `subscribeChange` plus:
   * - Fires for both main-origin writes (`setShared`/`deleteShared`) and
   *   renderer-origin writes arriving via the IPC relay.
   * - For template subscriptions, the third callback argument is the actual
   *   concrete key that changed; placeholder names are not used for matching.
   * - Concrete dynamic segments must satisfy `[A-Za-z0-9_\-]+` — this mirrors
   *   the cache key naming convention enforced by ESLint rule
   *   `data-schema-key/valid-key`.
   *
   * @returns unsubscribe function (compatible with `registerDisposable`)
   */
  subscribeSharedChange<K extends SharedCacheKey>(
    key: K,
    callback: (
      newValue: InferSharedCacheValue<K> | undefined,
      oldValue: InferSharedCacheValue<K> | undefined,
      concreteKey: ProcessKey<K & string>
    ) => void
  ): () => void {
    return this.sharedNotifier.subscribe(key, (newValue, oldValue, concreteKey) => {
      callback(
        newValue as InferSharedCacheValue<K> | undefined,
        oldValue as InferSharedCacheValue<K> | undefined,
        concreteKey as ProcessKey<K & string>
      )
    })
  }

  /**
   * Get all shared cache entries (for renderer initialization sync)
   * @returns Record of all shared cache entries with their metadata
   */
  private getAllShared(): Record<string, CacheEntry> {
    const now = Date.now()
    const result: Record<string, CacheEntry> = {}

    for (const [key, entry] of this.sharedCache.entries()) {
      // Skip expired entries
      if (entry.expireAt && now > entry.expireAt) {
        this.sharedCache.delete(key)
        continue
      }
      result[key] = entry
    }

    return result
  }

  // ============ Persist Cache Interface (Reserved) ============

  // TODO: Implement persist cache in future

  // ============ IPC Handlers for Cache Synchronization ============

  /**
   * Broadcast sync message to all renderer windows
   */
  private broadcastSync(message: CacheSyncMessage, senderWindowId?: number): void {
    const windows = BrowserWindow.getAllWindows()
    for (const window of windows) {
      if (!window.isDestroyed() && window.id !== senderWindowId) {
        window.webContents.send(IpcChannel.Cache_Sync, message)
      }
    }
  }

  /**
   * Setup IPC handlers for cache synchronization
   */
  private registerIpcHandlers(): void {
    // Handle cache sync broadcast from renderer
    this.ipcOn(IpcChannel.Cache_Sync, (event, message: CacheSyncMessage) => {
      const senderWindowId = BrowserWindow.fromWebContents(event.sender)?.id

      // Update Main's sharedCache when receiving shared type sync
      if (message.type === 'shared') {
        // Capture pre-change value (TTL-aware) so subscribers see a consistent oldValue.
        // This path bypasses setShared/deleteShared and must notify independently.
        const oldValue = this.peekShared(message.key)

        if (message.value === undefined) {
          // Handle deletion
          this.sharedCache.delete(message.key)
        } else {
          // Handle set - use expireAt directly (absolute timestamp)
          const entry: CacheEntry = {
            value: message.value,
            expireAt: message.expireAt
          }
          this.sharedCache.set(message.key, entry)
        }

        // Relay to other windows first so cross-window state is coherent before
        // main-process subscribers observe the change.
        this.broadcastSync(message, senderWindowId)

        // Only fire when the value actually changed, matching main-origin paths.
        if (!isEqual(oldValue, message.value)) {
          this.sharedNotifier.notify(message.key, message.value, oldValue)
        }
        return
      }

      // Non-shared message types: relay only.
      this.broadcastSync(message, senderWindowId)
    })

    // Handle getAllShared request for renderer initialization
    this.ipcHandle(IpcChannel.Cache_GetAllShared, () => {
      return this.getAllShared()
    })

    logger.debug('Cache sync IPC handlers registered')
  }
}
