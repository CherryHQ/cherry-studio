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

  // Main process cache
  private cache = new Map<string, CacheEntry>()

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
   * Garbage collection logic
   */
  private startGarbageCollection() {
    if (this.gcInterval) return

    this.gcInterval = setInterval(() => {
      const now = Date.now()
      let removedCount = 0

      for (const [key, entry] of this.cache.entries()) {
        if (entry.expireAt && now > entry.expireAt) {
          this.cache.delete(key)
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
      this.broadcastSync(message, senderWindowId)
      logger.verbose(`Broadcasted cache sync: ${message.type}:${message.key}`)
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

    // Clear cache
    this.cache.clear()

    // Remove IPC handlers
    ipcMain.removeAllListeners(IpcChannel.Cache_Sync)

    logger.debug('CacheService cleanup completed')
  }
}

// Export singleton instance for main process use
export const cacheService = CacheService.getInstance()
export default cacheService
