import { loggerService } from '@logger'
import { isDev } from '@main/constant'
import { application } from '@main/core/application'
import { BaseService, DependsOn, Injectable, ServicePhase } from '@main/core/lifecycle'
import { Phase } from '@main/core/lifecycle'
import { bootConfigService } from '@main/data/bootConfig'
import type { BootConfigPreferenceKeys } from '@shared/data/bootConfig/bootConfigTypes'
import { DefaultPreferences } from '@shared/data/preference/preferenceSchemas'
import type {
  PreferenceDefaultScopeType,
  PreferenceKeyType,
  UnifiedPreferenceKeyType,
  UnifiedPreferenceMultipleResultType,
  UnifiedPreferenceType
} from '@shared/data/preference/preferenceTypes'
import {
  BOOT_CONFIG_PREFIX,
  isBootConfigKey,
  isPreferenceKey,
  toBootConfigKey
} from '@shared/data/preference/preferenceUtils'
import { IpcChannel } from '@shared/IpcChannel'
import { and, eq } from 'drizzle-orm'
import { BrowserWindow } from 'electron'

import { preferenceTable } from './db/schemas/preference'
import type { DbType } from './db/types'

const logger = loggerService.withContext('PreferenceService')

/**
 * Preference statistics summary
 */
interface PreferenceStatsSummary {
  /** Timestamp when statistics were collected */
  collectedAt: number
  /** Total number of preference keys */
  totalKeys: number
  /** Number of keys with main process subscriptions */
  mainProcessSubscribedKeys: number
  /** Total main process subscription count */
  mainProcessTotalSubscriptions: number
  /** Number of keys with window subscriptions */
  windowSubscribedKeys: number
  /** Total window subscription count (one window subscribing to one key counts as one) */
  windowTotalSubscriptions: number
  /** Number of active windows with subscriptions */
  activeWindowCount: number
}

/**
 * Statistics for a single preference key
 */
interface PreferenceKeyStats {
  /** Preference key */
  key: string
  /** Main process subscription count */
  mainProcessSubscriptions: number
  /** Window subscription count */
  windowSubscriptions: number
  /** List of window IDs subscribed to this key */
  subscribedWindowIds: number[]
}

/**
 * Complete statistics result
 */
interface PreferenceStats {
  /** Summary statistics */
  summary: PreferenceStatsSummary
  /** Detailed per-key statistics (only when details=true) */
  details?: PreferenceKeyStats[]
}

/**
 * Custom observer pattern implementation for preference change notifications
 * Replaces EventEmitter to avoid listener limits and improve performance
 * Optimized for memory efficiency and this binding safety
 */
class PreferenceNotifier {
  private subscriptions = new Map<string, Set<(key: string, newValue: any, oldValue?: any) => void>>()

  /**
   * Subscribe to preference changes for a specific key
   * @param key - The preference key to watch
   * @param callback - Function to call when the preference changes
   * @returns Unsubscribe function
   */
  subscribe = (key: string, callback: (key: string, newValue: any, oldValue?: any) => void): (() => void) => {
    if (!this.subscriptions.has(key)) {
      this.subscriptions.set(key, new Set())
    }

    const keySubscriptions = this.subscriptions.get(key)!
    keySubscriptions.add(callback)

    return () => {
      const currentKeySubscriptions = this.subscriptions.get(key)
      if (currentKeySubscriptions) {
        currentKeySubscriptions.delete(callback)
        if (currentKeySubscriptions.size === 0) {
          this.subscriptions.delete(key)
        }
      }
    }
  }

  /**
   * Notify all subscribers of a preference change
   * Uses arrow function to ensure proper this binding
   * @param key - The preference key that changed
   * @param newValue - The new value
   * @param oldValue - The previous value
   */
  notify = (key: string, newValue: any, oldValue?: any): void => {
    const keySubscriptions = this.subscriptions.get(key)
    if (keySubscriptions && keySubscriptions.size > 0) {
      keySubscriptions.forEach((callback) => {
        try {
          callback(key, newValue, oldValue)
        } catch (error) {
          logger.error(`Error in preference subscription callback for ${key}:`, error as Error)
        }
      })
    }
  }

  /**
   * Get the total number of subscriptions across all keys
   */
  getTotalSubscriptionCount = (): number => {
    let total = 0
    for (const keySubscriptions of this.subscriptions.values()) {
      total += keySubscriptions.size
    }
    return total
  }

  /**
   * Get the number of subscriptions for a specific key
   */
  getKeySubscriptionCount = (key: string): number => {
    return this.subscriptions.get(key)?.size || 0
  }

  /**
   * Get all subscribed keys
   */
  getSubscribedKeys = (): string[] => {
    return Array.from(this.subscriptions.keys())
  }

  /**
   * Remove all subscriptions for cleanup
   */
  removeAllSubscriptions = (): void => {
    const totalCount = this.getTotalSubscriptionCount()
    this.subscriptions.clear()
    logger.debug(`Removed all ${totalCount} preference subscriptions`)
  }

  /**
   * Get subscription statistics for debugging
   */
  getSubscriptionStats = (): Record<string, number> => {
    const stats: Record<string, number> = {}
    for (const [key, keySubscriptions] of this.subscriptions.entries()) {
      stats[key] = keySubscriptions.size
    }
    return stats
  }
}

const DefaultScope = 'default'
/**
 * PreferenceService manages preference data storage and synchronization across multiple windows
 *
 * Features:
 * - Memory-cached preferences for high performance
 * - SQLite database persistence using Drizzle ORM
 * - Multi-window subscription and synchronization
 * - Main process change notification support
 * - Type-safe preference operations
 * - Batch operations support
 * - Unified change notification broadcasting
 */
@Injectable('PreferenceService')
@ServicePhase(Phase.BeforeReady)
@DependsOn(['DbService'])
export class PreferenceService extends BaseService {
  private windowSubscriptions = new Map<number, Set<string>>() // windowId -> Set<keys>
  private cache: PreferenceDefaultScopeType = DefaultPreferences.default

  // Custom notifier for main process change notifications
  private notifier = new PreferenceNotifier()

  // Saves the reference to the cleanup interval
  private cleanupInterval: NodeJS.Timeout | null = null

  // Database reference, set during onInit
  private db!: DbType

  constructor() {
    super()
  }

  /**
   * Lifecycle: Load preferences from database into memory cache
   */
  protected async onInit(): Promise<void> {
    try {
      const dbService = application.get('DbService')
      this.db = dbService.getDb()
      const results = await this.db.select().from(preferenceTable).where(eq(preferenceTable.scope, DefaultScope))

      // Update cache with database values, keeping defaults for missing keys
      for (const result of results) {
        const key = result.key
        if (key in this.cache) {
          this.cache[key] = result.value
        }
      }

      this.setupWindowCleanup()
      logger.info(`Preference cache initialized with ${results.length} values`)
    } catch (error) {
      logger.error('Failed to initialize preference cache:', error as Error)
      throw error
    }
  }

  /**
   * Lifecycle: Register IPC handlers after initialization is complete
   */
  protected onReady(): void {
    this.registerIpcHandlers()
  }

  /**
   * Lifecycle: Cleanup resources and remove IPC handlers
   */
  protected async onStop(): Promise<void> {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval)
      this.cleanupInterval = null
    }

    this.notifier.removeAllSubscriptions()
    this.windowSubscriptions.clear()

    logger.debug('PreferenceService cleanup completed')
  }

  /**
   * Register IPC handlers for preference operations
   * Provides communication interface between main and renderer processes
   */
  private registerIpcHandlers(): void {
    this.ipcHandle(IpcChannel.Preference_Get, (_, key: UnifiedPreferenceKeyType) => {
      return this.get(key)
    })

    this.ipcHandle(
      IpcChannel.Preference_Set,
      async (_, key: UnifiedPreferenceKeyType, value: UnifiedPreferenceType[UnifiedPreferenceKeyType]) => {
        await this.set(key, value)
      }
    )

    this.ipcHandle(IpcChannel.Preference_GetMultipleRaw, (_, keys: UnifiedPreferenceKeyType[]) => {
      return this.getMultipleRaw(keys)
    })

    this.ipcHandle(IpcChannel.Preference_SetMultiple, async (_, updates: Partial<UnifiedPreferenceType>) => {
      await this.setMultiple(updates)
    })

    this.ipcHandle(IpcChannel.Preference_GetAll, () => {
      return this.getAll()
    })

    this.ipcHandle(IpcChannel.Preference_Subscribe, async (event, keys: string[]) => {
      const windowId = BrowserWindow.fromWebContents(event.sender)?.id
      if (windowId) {
        this.subscribeForWindow(windowId, keys)
      }
    })

    logger.info('PreferenceService IPC handlers registered')
  }

  /**
   * Get a single preference value from memory cache
   * Fast synchronous access - no database queries after initialization
   * @param key The preference key to retrieve
   * @returns The preference value with defaults applied
   */
  public get<K extends UnifiedPreferenceKeyType>(key: K): UnifiedPreferenceType[K] {
    if (!isPreferenceKey(key)) {
      return bootConfigService.get(toBootConfigKey(key)) as UnifiedPreferenceType[K]
    }

    if (!this.isReady) {
      logger.warn(`Preference cache not initialized, returning default for ${key}`)
      return DefaultPreferences.default[key] as UnifiedPreferenceType[K]
    }

    return (this.cache[key] ?? DefaultPreferences.default[key]) as UnifiedPreferenceType[K]
  }

  /**
   * Set a single preference value
   * Updates both database and memory cache, then broadcasts changes to all listeners
   * Optimized to skip database writes and notifications when value hasn't changed
   * @param key The preference key to update
   * @param value The new value to set
   * @returns Promise that resolves when update completes
   */
  public async set<K extends UnifiedPreferenceKeyType>(key: K, value: UnifiedPreferenceType[K]): Promise<void> {
    if (!isPreferenceKey(key)) {
      const configKey = toBootConfigKey(key)
      const oldValue = bootConfigService.get(configKey) as UnifiedPreferenceType[K]
      if (this.isEqual(oldValue, value)) {
        return
      }
      // TS cannot correlate UnifiedPreferenceType[K] with BootConfigSchema via prefix stripping
      bootConfigService.set(configKey, value as any)
      await this.notifyChange(key, value, oldValue)
      return
    }

    try {
      if (!(key in this.cache)) {
        throw new Error(`Preference ${key} not found in cache`)
      }

      const oldValue = this.cache[key]

      // Performance optimization: skip update if value hasn't changed
      if (this.isEqual(oldValue, value)) {
        return
      }

      await this.db
        .update(preferenceTable)
        .set({
          value: value as any
        })
        .where(and(eq(preferenceTable.scope, DefaultScope), eq(preferenceTable.key, key)))

      // Update memory cache immediately — safe after type guard + cache key check
      ;(this.cache as Record<string, unknown>)[key] = value

      // Unified notification to both main and renderer processes
      await this.notifyChange(key, value, oldValue)
    } catch (error) {
      logger.error(`Failed to set preference ${key}:`, error as Error)
      throw error
    }
  }

  /**
   * Get multiple preferences at once from memory cache
   * Fast synchronous access - no database queries
   * @param keys Array of preference keys to retrieve
   * @returns Object with preference values for requested keys
   */
  public getMultipleRaw<K extends UnifiedPreferenceKeyType>(keys: K[]): UnifiedPreferenceMultipleResultType<K> {
    if (!this.isReady) {
      logger.warn('Preference cache not initialized, returning defaults for multiple keys')
    }

    const output = {} as UnifiedPreferenceMultipleResultType<K>
    for (const key of keys) {
      output[key] = this.get(key)
    }

    return output
  }

  /**
   * Get multiple preferences with custom key mapping
   * @param keys Object mapping local names to preference keys
   * @returns Object with mapped preference values
   * @example
   * ```typescript
   * const preferenceService = application.get('PreferenceService')
   * const { host, port } = preferenceService.getMultiple({
   *   host: 'feature.csaas.host',
   *   port: 'feature.csaas.port'
   * })
   * ```
   */
  public getMultiple<T extends Record<string, UnifiedPreferenceKeyType>>(
    keys: T
  ): { [P in keyof T]: UnifiedPreferenceType[T[P]] } {
    const preferenceKeys = Object.values(keys)
    const values = this.getMultipleRaw(preferenceKeys)
    const result = {} as { [P in keyof T]: UnifiedPreferenceType[T[P]] }

    for (const key in keys) {
      result[key] = values[keys[key]]
    }

    return result
  }

  /**
   * Set multiple preferences at once
   * Updates both database and memory cache in a transaction, then broadcasts changes
   * Optimized to skip unchanged values and reduce database operations
   * @param updates Object containing preference key-value pairs to update
   * @returns Promise that resolves when all updates complete
   */
  public async setMultiple(updates: Partial<UnifiedPreferenceType>): Promise<void> {
    try {
      // Separate BootConfig updates from preference updates
      const entries = Object.entries(updates)
      const bootConfigUpdates = Object.fromEntries(
        entries.filter(([key]) => isBootConfigKey(key))
      ) as Partial<BootConfigPreferenceKeys>
      const preferenceUpdates = Object.fromEntries(
        entries.filter(([key]) => !isBootConfigKey(key))
      ) as Partial<PreferenceDefaultScopeType>

      // Collect all changes for unified notification at the end
      const allChanges: Array<[string, unknown, unknown]> = []

      // Handle BootConfig updates
      for (const [key, value] of Object.entries(bootConfigUpdates)) {
        const configKey = toBootConfigKey(key)
        const oldValue = bootConfigService.get(configKey)
        if (!this.isEqual(oldValue, value)) {
          // TS cannot correlate UnifiedPreferenceType with BootConfigSchema via prefix stripping
          bootConfigService.set(configKey, value as any)
          allChanges.push([key, value, oldValue])
        }
      }

      // Performance optimization: filter out unchanged preference values
      const actualUpdates: Record<string, any> = {}
      const oldValues: Record<string, any> = {}
      let skippedCount = 0

      for (const [key, value] of Object.entries(preferenceUpdates)) {
        if (!(key in this.cache) || value === undefined || value === null) {
          throw new Error(`Preference ${key} not found in cache or value is undefined or null`)
        }

        const oldValue = this.cache[key as PreferenceKeyType]

        // Only include keys that actually changed
        if (!this.isEqual(oldValue, value)) {
          actualUpdates[key] = value
          oldValues[key] = oldValue
        } else {
          skippedCount++
        }
      }

      // Write changed preference values to DB
      if (Object.keys(actualUpdates).length > 0) {
        await this.db.transaction(async (tx) => {
          for (const [key, value] of Object.entries(actualUpdates)) {
            await tx
              .update(preferenceTable)
              .set({
                value
              })
              .where(and(eq(preferenceTable.scope, DefaultScope), eq(preferenceTable.key, key)))
          }
        })

        // Update memory cache for changed keys only
        for (const [key, value] of Object.entries(actualUpdates)) {
          if (key in this.cache) {
            ;(this.cache as Record<string, unknown>)[key] = value
          }
        }

        // Collect preference changes for notification
        for (const [key, value] of Object.entries(actualUpdates)) {
          allChanges.push([key, value, oldValues[key]])
        }
      }

      // Unified notification for all changes (BootConfig + Preference)
      if (allChanges.length > 0) {
        await Promise.all(allChanges.map(([key, value, oldValue]) => this.notifyChange(key, value, oldValue)))
      }

      if (Object.keys(actualUpdates).length === 0 && Object.keys(bootConfigUpdates).length === 0) {
        logger.debug(`All ${Object.keys(updates).length} preference values unchanged, skipping batch update`)
      } else {
        logger.debug(
          `Updated ${allChanges.length}/${Object.keys(updates).length} preferences successfully (${skippedCount} unchanged)`
        )
      }
    } catch (error) {
      logger.error('Failed to set multiple preferences:', error as Error)
      throw error
    }
  }

  /**
   * Subscribe a window to preference changes
   * @param windowId The ID of the BrowserWindow to subscribe
   * @param keys Array of preference keys to subscribe to
   */
  public subscribeForWindow(windowId: number, keys: string[]): void {
    if (!this.windowSubscriptions.has(windowId)) {
      this.windowSubscriptions.set(windowId, new Set())
    }

    const windowKeys = this.windowSubscriptions.get(windowId)!
    keys.forEach((key) => windowKeys.add(key))
  }

  /**
   * Unsubscribe a window from preference changes
   * @param windowId The ID of the BrowserWindow to unsubscribe
   */
  public unsubscribeForWindow(windowId: number): void {
    this.windowSubscriptions.delete(windowId)
  }

  /**
   * Subscribe to preference changes in main process
   * @param key The preference key to watch for changes
   * @param callback Function to call when the preference changes
   * @returns Unsubscribe function for cleanup
   */
  public subscribeChange<K extends UnifiedPreferenceKeyType>(
    key: K,
    callback: (newValue: UnifiedPreferenceType[K], oldValue?: UnifiedPreferenceType[K]) => void
  ): () => void {
    const listener = (changedKey: string, newValue: any, oldValue: any) => {
      if (changedKey === key) {
        callback(newValue as UnifiedPreferenceType[K], oldValue as UnifiedPreferenceType[K])
      }
    }

    return this.notifier.subscribe(key, listener)
  }

  /**
   * Subscribe to multiple preference changes in main process
   * @param keys Array of preference keys to watch for changes
   * @param callback Function to call when any of the preferences change
   * @returns Unsubscribe function for cleanup
   */
  public subscribeMultipleChanges(
    keys: UnifiedPreferenceKeyType[],
    callback: (key: UnifiedPreferenceKeyType, newValue: any, oldValue: any) => void
  ): () => void {
    const listener = (changedKey: string, newValue: any, oldValue: any) => {
      if (keys.includes(changedKey as UnifiedPreferenceKeyType)) {
        callback(changedKey as UnifiedPreferenceKeyType, newValue, oldValue)
      }
    }

    const unsubscribeFunctions = keys.map((key) => this.notifier.subscribe(key, listener))

    return () => {
      unsubscribeFunctions.forEach((unsubscribe) => unsubscribe())
    }
  }

  /**
   * Remove all main process listeners for cleanup
   */
  public removeAllChangeListeners(): void {
    this.notifier.removeAllSubscriptions()
    logger.debug('Removed all main process preference listeners')
  }

  /**
   * Get main process listener count for debugging
   */
  public getChangeListenerCount(): number {
    return this.notifier.getTotalSubscriptionCount()
  }

  /**
   * Get subscription count for a specific preference key
   */
  public getKeyListenerCount(key: UnifiedPreferenceKeyType): number {
    return this.notifier.getKeySubscriptionCount(key)
  }

  /**
   * Get all subscribed preference keys
   */
  public getSubscribedKeys(): string[] {
    return this.notifier.getSubscribedKeys()
  }

  /**
   * Get detailed subscription statistics for debugging
   */
  public getSubscriptionStats(): Record<string, number> {
    return this.notifier.getSubscriptionStats()
  }

  /**
   * Get preference statistics
   * @param details Whether to include per-key detailed statistics
   */
  public getStats(details: boolean = false): PreferenceStats {
    if (!isDev) {
      logger.warn('getStats() is resource-intensive and should be used in development environment only')
    }

    const summary = this.collectStatsSummary()

    if (!details) {
      return { summary }
    }

    return {
      summary,
      details: this.collectStatsDetails()
    }
  }

  private collectStatsSummary(): PreferenceStatsSummary {
    const mainProcessStats = this.notifier.getSubscriptionStats()
    const mainProcessSubscribedKeys = Object.keys(mainProcessStats).length
    const mainProcessTotalSubscriptions = this.notifier.getTotalSubscriptionCount()

    const { windowSubscribedKeys, windowTotalSubscriptions, activeWindowCount } = this.collectWindowSubscriptionStats()

    return {
      collectedAt: Date.now(),
      totalKeys: Object.keys(this.cache).length,
      mainProcessSubscribedKeys,
      mainProcessTotalSubscriptions,
      windowSubscribedKeys,
      windowTotalSubscriptions,
      activeWindowCount
    }
  }

  private collectWindowSubscriptionStats(): {
    windowSubscribedKeys: number
    windowTotalSubscriptions: number
    activeWindowCount: number
  } {
    const keyToWindows = new Map<string, Set<number>>()
    let totalSubscriptions = 0

    for (const [windowId, keys] of this.windowSubscriptions.entries()) {
      for (const key of keys) {
        if (!keyToWindows.has(key)) {
          keyToWindows.set(key, new Set())
        }
        keyToWindows.get(key)!.add(windowId)
        totalSubscriptions++
      }
    }

    return {
      windowSubscribedKeys: keyToWindows.size,
      windowTotalSubscriptions: totalSubscriptions,
      activeWindowCount: this.windowSubscriptions.size
    }
  }

  /**
   * Collect per-key detailed statistics
   */
  private collectStatsDetails(): PreferenceKeyStats[] {
    const mainProcessStats = this.notifier.getSubscriptionStats()

    const keyToWindowIds = new Map<string, number[]>()
    for (const [windowId, keys] of this.windowSubscriptions.entries()) {
      for (const key of keys) {
        if (!keyToWindowIds.has(key)) {
          keyToWindowIds.set(key, [])
        }
        keyToWindowIds.get(key)!.push(windowId)
      }
    }

    const allSubscribedKeys = new Set<string>([...Object.keys(mainProcessStats), ...keyToWindowIds.keys()])

    const details: PreferenceKeyStats[] = []
    for (const key of allSubscribedKeys) {
      details.push({
        key,
        mainProcessSubscriptions: mainProcessStats[key] || 0,
        windowSubscriptions: keyToWindowIds.get(key)?.length || 0,
        subscribedWindowIds: keyToWindowIds.get(key) || []
      })
    }

    details.sort(
      (a, b) =>
        b.mainProcessSubscriptions + b.windowSubscriptions - (a.mainProcessSubscriptions + a.windowSubscriptions)
    )

    return details
  }

  /**
   * Unified notification method for both main and renderer processes
   * Broadcasts preference changes to main process listeners and subscribed renderer windows
   * @param key The preference key that changed
   * @param value The new value
   * @param oldValue The previous value
   */
  private async notifyChange(key: string, value: any, oldValue?: any): Promise<void> {
    // 1. Notify main process listeners
    this.notifier.notify(key, value, oldValue)

    // 2. Notify renderer process windows
    const affectedWindows: number[] = []

    for (const [windowId, subscribedKeys] of this.windowSubscriptions.entries()) {
      if (subscribedKeys.has(key)) {
        affectedWindows.push(windowId)
      }
    }

    if (affectedWindows.length === 0) {
      return
    }

    // Send to all affected renderer windows
    for (const windowId of affectedWindows) {
      try {
        const window = BrowserWindow.fromId(windowId)
        if (window && !window.isDestroyed()) {
          window.webContents.send(IpcChannel.Preference_Changed, key, value, DefaultScope)
        } else {
          this.windowSubscriptions.delete(windowId)
        }
      } catch (error) {
        logger.error(`Failed to notify window ${windowId}:`, error as Error)
        this.windowSubscriptions.delete(windowId)
      }
    }

    logger.debug(`Preference ${key} changed, notified ${affectedWindows.length} renderer windows`)
  }

  /**
   * Setup automatic cleanup of closed window subscriptions
   */
  private setupWindowCleanup(): void {
    const cleanup = () => {
      const validWindowIds = BrowserWindow.getAllWindows()
        .filter((w) => !w.isDestroyed())
        .map((w) => w.id)

      const subscribedWindowIds = Array.from(this.windowSubscriptions.keys())
      const invalidWindowIds = subscribedWindowIds.filter((id) => !validWindowIds.includes(id))

      invalidWindowIds.forEach((id) => this.windowSubscriptions.delete(id))

      if (invalidWindowIds.length > 0) {
        logger.debug(`Cleaned up ${invalidWindowIds.length} invalid window subscriptions`)
      }
    }

    // Run cleanup periodically (every 5 minutes)
    this.cleanupInterval = setInterval(cleanup, 300 * 1000)
    this.cleanupInterval.unref()
  }

  /**
   * Get all preferences from memory cache
   * Returns complete preference object for bulk operations
   * @returns Complete preference object with all values
   */
  public getAll(): UnifiedPreferenceType {
    const cachedValues = this.isReady ? this.cache : DefaultPreferences.default
    if (!this.isReady) {
      logger.warn('Preference cache not initialized, returning defaults')
    }

    // Merge preferences with BootConfig values
    const bootConfigAll = bootConfigService.getAll()
    const bootConfigEntries = Object.entries(bootConfigAll).map(([k, v]) => [`${BOOT_CONFIG_PREFIX}${k}`, v] as const)

    return { ...cachedValues, ...Object.fromEntries(bootConfigEntries) } as UnifiedPreferenceType
  }

  /**
   * Get all current window subscriptions (for debugging)
   * @returns Map of window IDs to their subscribed preference keys
   */
  public getSubscriptions(): Map<number, Set<string>> {
    return new Map(this.windowSubscriptions)
  }

  /**
   * Deep equality check for preference values
   * Handles primitives, arrays, and plain objects
   * @param a First value to compare
   * @param b Second value to compare
   * @returns True if values are deeply equal, false otherwise
   */
  private isEqual(a: any, b: any): boolean {
    // Handle strict equality (primitives, same reference)
    if (a === b) return true

    // Handle null/undefined
    if (a == null || b == null) return a === b

    // Handle different types
    if (typeof a !== typeof b) return false

    // Handle arrays
    if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length !== b.length) return false
      return a.every((item, index) => this.isEqual(item, b[index]))
    }

    // Handle objects (plain objects only)
    if (typeof a === 'object' && typeof b === 'object') {
      // Check if both are plain objects
      if (Object.getPrototypeOf(a) !== Object.prototype || Object.getPrototypeOf(b) !== Object.prototype) {
        return false
      }

      const keysA = Object.keys(a)
      const keysB = Object.keys(b)

      if (keysA.length !== keysB.length) return false

      return keysA.every((key) => keysB.includes(key) && this.isEqual(a[key], b[key]))
    }

    return false
  }
}
