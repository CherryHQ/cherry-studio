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

  private constructor() {
    // Private constructor for singleton pattern
  }

  public async initialize(): Promise<void> {
    if (this.initialized) {
      logger.warn('CacheService already initialized')
      return
    }

    this.setupIpcHandlers()
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

  /**
   * Get persist cache value (interface reserved for future)
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  getPersist<T>(_key: string): T | undefined {
    // TODO: Implement persist cache in future
    logger.warn('getPersist not implemented yet')
    return undefined
  }

  /**
   * Set persist cache value (interface reserved for future)
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  setPersist<T>(_key: string, _value: T): void {
    // TODO: Implement persist cache in future
    logger.warn('setPersist not implemented yet')
  }

  /**
   * Check persist cache key (interface reserved for future)
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  hasPersist(_key: string): boolean {
    // TODO: Implement persist cache in future
    return false
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
