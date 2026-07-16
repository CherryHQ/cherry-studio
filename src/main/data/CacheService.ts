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

import fs from 'node:fs'

import { application } from '@application'
import { loggerService } from '@logger'
import { BaseService, type Disposable, Injectable, ServicePhase } from '@main/core/lifecycle'
import { Phase } from '@main/core/lifecycle'
import type {
  InferSharedCacheValue,
  MainPersistCacheKey,
  MainPersistCacheSchema,
  ProcessKey,
  SharedCacheKey
} from '@shared/data/cache/cacheSchemas'
import { DefaultMainPersistCache } from '@shared/data/cache/cacheSchemas'
import type { CacheEntry, CacheSyncMessage } from '@shared/data/cache/cacheTypes'
import { isTemplateKey, templateToRegex } from '@shared/data/cache/templateKey'
import { IpcChannel } from '@shared/IpcChannel'
import { BrowserWindow } from 'electron'
import { isEqual } from 'es-toolkit/compat'

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

  /**
   * Register a callback under a subscription key (exact or `${...}` template).
   * Backed by a Set, so registering the same callback twice collapses to one.
   *
   * @returns an unsubscribe function that removes the callback and drops the
   *   key's entry once its last subscriber is gone.
   */
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

  /**
   * Dispatch a change for a concrete key to every matching subscriber: the
   * exact-key set first (O(1) lookup), then any template subscriptions whose
   * pattern matches the concrete key.
   */
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

  /**
   * Remove all subscriptions. Called on service teardown so no callback fires
   * after the lifecycle ends.
   */
  clear(): void {
    this.subscriptions.clear()
  }

  /**
   * Count registered callbacks — for a single subscription key when one is
   * given, otherwise summed across all keys.
   */
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

  /**
   * Invoke every callback in a set against a snapshot copy, so a callback may
   * (un)subscribe during dispatch without disturbing iteration. Each callback's
   * errors are caught and logged so one failure cannot starve the others.
   */
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
 * - Independent JSON-backed persist cache (separate from the renderer localStorage relay)
 *
 * Responsibilities:
 * 1. Provide cache for Main process services
 * 2. Relay cache sync messages between renderer windows
 * 3. Provide a main-authoritative, JSON-backed persist cache (independent from the renderer persist relay)
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

  // Persist cache (main-authoritative, JSON-backed; independent from renderer persist)
  private persistCache = new Map<string, unknown>()
  private persistSaveTimer: ReturnType<typeof setTimeout> | null = null
  private persistFilePath = ''
  private readonly PERSIST_SAVE_DEBOUNCE_MS = 350
  // Main-local change notifier for the persist tier (never relayed to renderers).
  private persistNotifier = new CacheNotifier()

  constructor() {
    super()
  }

  /**
   * Lifecycle init: register the IPC sync handlers, start the periodic expiry
   * sweep, and load the persist tier from disk. Resource acquisition (resolving
   * the persist file path and reading it) happens here rather than in the
   * constructor, per the lifecycle convention.
   */
  protected async onInit(): Promise<void> {
    this.registerIpcHandlers()
    this.startGarbageCollection()
    this.persistFilePath = application.getPath('app.userdata', 'cache.json')
    this.loadPersist()
    logger.info('CacheService initialized')
  }

  /**
   * Lifecycle teardown: flush any pending persist write, release the GC timer
   * reference, clear all in-memory caches, and tear down the subscription
   * notifiers so nothing fires after stop.
   */
  protected async onStop(): Promise<void> {
    // Flush any pending debounced persist write before tearing down.
    this.flushPersist()

    // GC timer is auto-disposed via registerInterval; just drop the reference.
    this.gcInterval = null

    // Clear caches
    this.cache.clear()
    this.sharedCache.clear()
    this.persistCache.clear()

    // Clear subscription notifiers — lifecycle end, subscribers should not fire
    this.internalNotifier.clear()
    this.sharedNotifier.clear()
    this.persistNotifier.clear()

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

      // Clean shared cache — route through the unified eviction outlet so
      // renderer mirrors receive a deletion tombstone (they have no GC).
      for (const [key, entry] of this.sharedCache.entries()) {
        if (entry.expireAt && now > entry.expireAt) {
          this.evictShared(key)
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
   * Unified outlet for every Main-origin runtime eviction of a shared entry:
   * TTL lazy cleanup (getShared / hasShared / getAllShared), the periodic GC
   * sweep, and deleteShared hitting an already-expired entry. Physically
   * removes the entry and broadcasts a single deletion tombstone so renderer
   * mirrors — which have no GC of their own — drop their physical copy too.
   *
   * Deliberately NOT used by the renderer-origin relay path (it excludes the
   * sender window and keeps its own relay ordering) nor by onStop clearing
   * (process teardown broadcasts nothing). Never fires main value-subscribers:
   * TTL cleanup is not a value change; deleteShared's non-expired branch
   * notifies separately.
   *
   * @returns true if an entry was physically removed (and a tombstone broadcast)
   */
  private evictShared(key: string): boolean {
    if (!this.sharedCache.has(key)) return false

    this.sharedCache.delete(key)
    this.broadcastSync({
      type: 'shared',
      key,
      value: undefined // undefined means deletion
    })
    return true
  }

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
      this.evictShared(key)
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
    // Pre-write entry state, TTL-aware: an expired entry counts as absent, so
    // re-setting it with the same value is an absent → value transition (full
    // broadcast + notify), never mistaken for a TTL-only refresh.
    const oldEntry = this.sharedCache.get(key)
    const oldValue = this.peekShared(key)
    const expireAt = ttl ? Date.now() + ttl : undefined
    const entry: CacheEntry = { value, expireAt }

    this.sharedCache.set(key, entry)

    if (isEqual(oldValue, value)) {
      // Same live value: the entry state may still change through its TTL
      // metadata. Any expireAt transition (add / extend / shorten / remove)
      // must reach renderer mirrors, or an equal-value heartbeat refresh lets
      // the mirror's copy expire out of sync with Main. TTL-only sync never
      // fires main value-subscribers (matching set() semantics).
      if (oldValue !== undefined && !Object.is(oldEntry?.expireAt, expireAt)) {
        this.broadcastSync({
          type: 'shared',
          key,
          value,
          expireAt
        })
      }
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
      this.evictShared(key)
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
      // Key absent or already expired — no main subscriber fire either way,
      // but an expired entry may still be physically mirrored in renderers, so
      // route through the unified eviction outlet (delete + tombstone
      // broadcast). A truly absent key stays a silent no-op.
      this.evictShared(key)
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
   * - Fires on explicit `set` (when value actually differs via isEqual)
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
        this.evictShared(key)
        continue
      }
      result[key] = entry
    }

    return result
  }

  // ============ Persist Cache (Main-authoritative, JSON-backed) ============
  //
  // Independent from the renderer persist cache: this tier is stored in a JSON
  // file owned by the main process, never relayed to or readable by renderers.
  // Fixed keys only, no TTL — values must tolerate a miss at any time (loseable
  // contract; readers fall back to the schema default).
  //
  // Default-relative semantics. Every key ALWAYS has an effective value (stored
  // override, else schema default), so there is no observable "absent" state
  // through the read API. The tier therefore models presence as *deviation from
  // the default* rather than as backing-store membership:
  //
  //   getPersist             → the effective value: stored override ?? default
  //                            (never undefined).
  //   hasPersist             → whether the effective value DIFFERS from the
  //                            default, i.e. "has this key been overridden" —
  //                            NOT "is the key in the Map". loadPersist seeds
  //                            every schema key, so Map membership is always
  //                            true and would carry no information.
  //   setPersist             → install an override; same-value write is a no-op.
  //   deletePersist          → drop the override == reset to the schema default.
  //                            There is no removal-to-absent; "deleted" keys read
  //                            back as their default and hasPersist returns false.
  //   subscribePersistChange → main-local change notifications for OTHER main
  //                            consumers (same model as subscribeChange; never
  //                            crosses to renderers).

  /**
   * Read the effective value for a persist key: the stored override if one has
   * been set, otherwise the schema default. Never returns undefined.
   */
  getPersist<K extends MainPersistCacheKey>(key: K): MainPersistCacheSchema[K] {
    if (this.persistCache.has(key)) {
      return this.persistCache.get(key) as MainPersistCacheSchema[K]
    }
    return DefaultMainPersistCache[key]
  }

  /**
   * Install an override for a persist key and schedule a debounced disk write.
   *
   * Same-value writes are a no-op (deep equality against the current effective
   * value), matching the other tiers — no disk write and no subscriber fire.
   * On an actual change, persist subscribers are notified with (newValue,
   * oldValue) where oldValue is the previous effective value.
   */
  setPersist<K extends MainPersistCacheKey>(key: K, value: MainPersistCacheSchema[K]): void {
    const oldValue = this.getPersist(key)
    if (isEqual(oldValue, value)) {
      return
    }
    this.persistCache.set(key, value)
    this.schedulePersistSave()
    this.persistNotifier.notify(key, value, oldValue)
  }

  /**
   * Whether the key has been overridden — i.e. its effective value DIFFERS from
   * the schema default. This is intentionally NOT "is the key in the backing
   * store": loadPersist seeds every key, so store membership is always true and
   * would be a useless signal. A key whose stored value equals the default (or
   * was never set) reports false.
   */
  hasPersist<K extends MainPersistCacheKey>(key: K): boolean {
    return !isEqual(this.getPersist(key), DefaultMainPersistCache[key])
  }

  /**
   * Reset a persist key to its schema default ("delete" the override).
   *
   * This tier has no absent state — getPersist always returns the default once
   * the override is gone — so deletion is expressed as restoring the default.
   * Delegates to setPersist, inheriting its same-value no-op (resetting an
   * already-default key does nothing: no write, no subscriber fire) and its
   * change notification (subscribers see the default as the new value).
   */
  deletePersist<K extends MainPersistCacheKey>(key: K): void {
    this.setPersist(key, DefaultMainPersistCache[key])
  }

  /**
   * Subscribe to persist changes for an exact key. Main-local: fires only for
   * main-process writes (setPersist / deletePersist), never crosses to renderers
   * — the same model as `subscribeChange` on the internal tier.
   *
   * Fire semantics:
   * - Fires on an actual value change (deep-inequality guard in setPersist) and
   *   on deletePersist when it actually resets away from a non-default value.
   * - Does NOT fire on same-value writes, on the initial loadPersist, or on
   *   onStop teardown.
   * - newValue / oldValue are always concrete schema values (never undefined) —
   *   the tier has no absent state; a reset surfaces the schema default.
   * - Callback errors are isolated per-subscriber (caught and logged).
   *
   * @returns unsubscribe function (compatible with `registerDisposable`)
   */
  subscribePersistChange<K extends MainPersistCacheKey>(
    key: K,
    callback: (newValue: MainPersistCacheSchema[K], oldValue: MainPersistCacheSchema[K]) => void
  ): () => void {
    return this.persistNotifier.subscribe(key, (newValue, oldValue) => {
      callback(newValue as MainPersistCacheSchema[K], oldValue as MainPersistCacheSchema[K])
    })
  }

  /**
   * Load the persisted JSON into memory, layered over schema defaults.
   * A missing or corrupt file falls back to defaults — persist data is loseable.
   */
  private loadPersist(): void {
    this.persistCache.clear()
    for (const key of Object.keys(DefaultMainPersistCache) as MainPersistCacheKey[]) {
      this.persistCache.set(key, DefaultMainPersistCache[key])
    }

    try {
      if (!fs.existsSync(this.persistFilePath)) return

      const parsed = JSON.parse(fs.readFileSync(this.persistFilePath, 'utf-8'))
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        // Adopt known schema keys only — unknown/stale keys are pruned so the
        // "fixed keys only" contract holds and renamed keys don't linger on disk.
        const record = parsed as Record<string, unknown>
        for (const key of Object.keys(DefaultMainPersistCache) as MainPersistCacheKey[]) {
          if (key in record) {
            this.persistCache.set(key, record[key])
          }
        }
      }
    } catch (error) {
      logger.warn(`Failed to load persist cache from ${this.persistFilePath}, using defaults`, error as Error)
    }
  }

  /**
   * Schedule a debounced write; rapid writes coalesce into a single disk flush.
   */
  private schedulePersistSave(): void {
    if (this.persistSaveTimer) {
      clearTimeout(this.persistSaveTimer)
    }
    this.persistSaveTimer = setTimeout(() => {
      this.persistSaveTimer = null
      this.savePersistSync()
    }, this.PERSIST_SAVE_DEBOUNCE_MS)
  }

  /**
   * Synchronously write the whole persist map (atomic temp-file + rename).
   * Failures are logged and swallowed — persist data is non-critical.
   */
  private savePersistSync(): void {
    try {
      const snapshot: Record<string, unknown> = {}
      for (const [key, value] of this.persistCache.entries()) {
        snapshot[key] = value
      }

      const content = JSON.stringify(snapshot, null, 2)
      const tempPath = `${this.persistFilePath}.tmp`
      fs.writeFileSync(tempPath, content, 'utf-8')
      fs.renameSync(tempPath, this.persistFilePath)
    } catch (error) {
      logger.error(`Failed to save persist cache to ${this.persistFilePath}`, error as Error)
    }
  }

  /**
   * Cancel any pending debounced write and flush immediately (used on stop).
   */
  private flushPersist(): void {
    if (this.persistSaveTimer) {
      clearTimeout(this.persistSaveTimer)
      this.persistSaveTimer = null
      this.savePersistSync()
    }
  }

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
