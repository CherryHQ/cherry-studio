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
import type { SharedCacheKey, SharedCacheSchema } from '@shared/data/cache/cacheSchemas'
import type { CacheEntry, CacheSyncMessage } from '@shared/data/cache/cacheTypes'
import { IpcChannel } from '@shared/IpcChannel'
import { BrowserWindow, ipcMain } from 'electron'

const logger = loggerService.withContext('CacheService')

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
export class CacheService {
  private static instance: CacheService
  private initialized = false

  // Main process internal cache
  private cache = new Map<string, CacheEntry>()

  // Shared cache (synchronized with renderer windows)
  private sharedCache = new Map<string, CacheEntry>()

  // GC timer reference and interval time (e.g., every 10 minutes)
  private gcInterval: NodeJS.Timeout | null = null
  private readonly GC_INTERVAL_MS = 10 * 60 * 1000

  private constructor() {
    // Private constructor for singleton pattern
  }

  public async initialize(): Promise<void> {
    if (this.initialized) {
      logger.warn('CacheService already initialized')
      return
    }

    this.setupIpcHandlers()
    // Start garbage collection
    this.startGarbageCollection()

    logger.info('CacheService initialized')
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

  // ============ Main Process Cache (Internal) ============

  /**
   * Garbage collection logic for both internal and shared cache
   */
  private startGarbageCollection() {
    if (this.gcInterval) return

    this.gcInterval = setInterval(() => {
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

    // unref allows the process to exit if there are no other activities
    this.gcInterval.unref()
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
    const entry: CacheEntry<T> = {
      value,
      expireAt: ttl ? Date.now() + ttl : undefined
    }

    this.cache.set(key, entry)
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
    return this.cache.delete(key)
  }

  // ============ Shared Cache (Cross-window via IPC) ============

  /**
   * Get value from shared cache with TTL validation (type-safe)
   * @param key - Schema-defined shared cache key
   * @returns Cached value or undefined if not found or expired
   */
  getShared<K extends SharedCacheKey>(key: K): SharedCacheSchema[K] | undefined {
    const entry = this.sharedCache.get(key)
    if (!entry) return undefined

    // Check TTL (lazy cleanup)
    if (entry.expireAt && Date.now() > entry.expireAt) {
      this.sharedCache.delete(key)
      return undefined
    }

    return entry.value as SharedCacheSchema[K]
  }

  /**
   * Set value in shared cache with cross-window broadcast (type-safe)
   * @param key - Schema-defined shared cache key
   * @param value - Value to cache (type inferred from schema)
   * @param ttl - Time to live in milliseconds (optional)
   */
  setShared<K extends SharedCacheKey>(key: K, value: SharedCacheSchema[K], ttl?: number): void {
    const expireAt = ttl ? Date.now() + ttl : undefined
    const entry: CacheEntry = { value, expireAt }

    this.sharedCache.set(key, entry)

    // Broadcast to all renderer windows
    this.broadcastSync({
      type: 'shared',
      key,
      value,
      expireAt
    })

    logger.verbose(`Set shared cache key "${key}"`)
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
    if (!this.sharedCache.has(key)) {
      return true
    }

    this.sharedCache.delete(key)

    // Broadcast deletion to all renderer windows
    this.broadcastSync({
      type: 'shared',
      key,
      value: undefined // undefined means deletion
    })

    logger.verbose(`Deleted shared cache key "${key}"`)
    return true
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
  private setupIpcHandlers(): void {
    // Handle cache sync broadcast from renderer
    ipcMain.on(IpcChannel.Cache_Sync, (event, message: CacheSyncMessage) => {
      const senderWindowId = BrowserWindow.fromWebContents(event.sender)?.id

      // Update Main's sharedCache when receiving shared type sync
      if (message.type === 'shared') {
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
      }

      // Broadcast to other windows
      this.broadcastSync(message, senderWindowId)
      logger.verbose(`Broadcasted cache sync: ${message.type}:${message.key}`)
    })

    // Handle getAllShared request for renderer initialization
    ipcMain.handle(IpcChannel.Cache_GetAllShared, () => {
      return this.getAllShared()
    })

    logger.debug('Cache sync IPC handlers registered')
  }

  /**
   * Cleanup resources
   */
  public cleanup(): void {
    // Clear the garbage collection interval
    if (this.gcInterval) {
      clearInterval(this.gcInterval)
      this.gcInterval = null
    }

    // Clear caches
    this.cache.clear()
    this.sharedCache.clear()

    // Remove IPC handlers
    ipcMain.removeAllListeners(IpcChannel.Cache_Sync)
    ipcMain.removeHandler(IpcChannel.Cache_GetAllShared)

    logger.debug('CacheService cleanup completed')
  }
}

// Export singleton instance for main process use
export const cacheService = CacheService.getInstance()
export default cacheService
