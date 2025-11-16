import { loggerService } from '@logger'
import { DefaultPreferences } from '@shared/data/preference/preferenceSchemas'
import type {
  PreferenceDefaultScopeType,
  PreferenceKeyType,
  PreferenceUpdateOptions
} from '@shared/data/preference/preferenceTypes'

const logger = loggerService.withContext('PreferenceService')

/**
 * Renderer-side PreferenceService providing cached access to preferences with real-time synchronization
 *
 * Features:
 * - Caching system for fast access to frequently used preferences
 * - Optimistic and pessimistic update strategies
 * - Real-time synchronization across windows via IPC
 * - Race condition handling for concurrent updates
 * - Batch operations for multiple preferences
 * - Integration with React's useSyncExternalStore
 */
export class PreferenceService {
  private static instance: PreferenceService

  private cache: Record<string, any> = {}

  private allChangesListeners = new Set<() => void>()
  private keyChangeListeners = new Map<string, Set<() => void>>()
  private changeListenerCleanup: (() => void) | null = null

  private subscribedKeys = new Set<string>()

  private fullCacheLoaded = false

  // Optimistic update tracking
  private optimisticValues = new Map<
    PreferenceKeyType,
    {
      value: any
      originalValue: any
      timestamp: number
      requestId: string
      isFirst: boolean
    }
  >()

  // Request queues for managing concurrent updates to the same key
  private requestQueues = new Map<
    PreferenceKeyType,
    Array<{
      requestId: string
      value: any
      resolve: (value: void | PromiseLike<void>) => void
      reject: (reason?: any) => void
    }>
  >()

  private constructor() {
    this.setupChangeListeners()
  }

  /**
   * Get the singleton instance of PreferenceService
   * @returns The singleton PreferenceService instance
   */
  public static getInstance(): PreferenceService {
    if (!PreferenceService.instance) {
      PreferenceService.instance = new PreferenceService()
    }
    return PreferenceService.instance
  }

  /**
   * Setup IPC change listener for preference updates from main process
   * Establishes communication channel for real-time preference synchronization
   */
  private setupChangeListeners() {
    if (!window.api?.preference?.onChanged) {
      logger.error('Preference API not available in preload context')
      return
    }

    this.changeListenerCleanup = window.api.preference.onChanged((key, value) => {
      const oldValue = this.cache[key]

      if (oldValue !== value) {
        this.cache[key] = value
        this.notifyChangeListeners(key)
        logger.debug(`Preference ${key} updated to:`, { value })
      }
    })
  }

  /**
   * Notify all relevant listeners about preference changes
   * @param key The preference key that changed
   */
  private notifyChangeListeners(key: string) {
    // Notify global listeners
    this.allChangesListeners.forEach((listener) => listener())

    // Notify specific key listeners
    const keyListeners = this.keyChangeListeners.get(key)
    if (keyListeners) {
      keyListeners.forEach((listener) => listener())
    }
  }

  /**
   * Get a single preference value with caching and auto-subscription
   * @param key The preference key to retrieve
   * @returns Promise resolving to the preference value with defaults applied
   */
  public async get<K extends PreferenceKeyType>(key: K): Promise<PreferenceDefaultScopeType[K]> {
    // Check cache first
    if (key in this.cache && this.cache[key] !== undefined) {
      return this.cache[key] as PreferenceDefaultScopeType[K]
    }

    logger.verbose(`get: ${key} not found in cache`)

    try {
      // Fetch from main process if not cached
      const value = await window.api.preference.get(key)
      this.cache[key] = value

      // since not cached, notify change listeners to receive the value
      this.notifyChangeListeners(key)

      // Auto-subscribe to this key for future updates
      await this.subscribeToKeyInternal([key])

      return value
    } catch (error) {
      logger.error(`Failed to get preference ${key}:`, error as Error)
      // Return default value on error
      return DefaultPreferences.default[key] as PreferenceDefaultScopeType[K]
    }
  }

  /**
   * Set a single preference value with configurable update strategy
   * @param key The preference key to update
   * @param value The new value to set
   * @param options Update strategy options (optimistic by default)
   * @returns Promise that resolves when update completes
   */
  public async set<K extends PreferenceKeyType>(
    key: K,
    value: PreferenceDefaultScopeType[K],
    options: PreferenceUpdateOptions = { optimistic: true }
  ): Promise<void> {
    if (options.optimistic) {
      return this.setOptimistic(key, value)
    } else {
      return this.setPessimistic(key, value)
    }
  }

  /**
   * Optimistic update: Queue request to prevent race conditions
   * Updates UI immediately, then syncs to database with rollback on failure
   * @param key The preference key to update
   * @param value The new value to set
   * @returns Promise that resolves when update completes
   */
  private async setOptimistic<K extends PreferenceKeyType>(
    key: K,
    value: PreferenceDefaultScopeType[K]
  ): Promise<void> {
    const requestId = this.generateRequestId()
    return this.enqueueRequest(key, requestId, value)
  }

  /**
   * Execute optimistic update with proper race condition handling
   * @param key The preference key to update
   * @param value The new value to set
   * @param requestId Unique identifier for this update request
   * @returns Promise that resolves when update completes
   */
  private async executeOptimisticUpdate(key: PreferenceKeyType, value: any, requestId: string): Promise<void> {
    const existingState = this.optimisticValues.get(key)
    const isFirst = !existingState
    const originalValue = isFirst ? this.cache[key] : existingState.originalValue

    // Update cache immediately for responsive UI
    this.cache[key] = value
    this.notifyChangeListeners(key)

    // Track optimistic state with proper original value protection
    this.optimisticValues.set(key, {
      value,
      originalValue, // Use real original value (from first request) or current if first
      timestamp: Date.now(),
      requestId,
      isFirst
    })

    logger.debug(`Optimistic update for ${key} (${requestId})${isFirst ? ' [FIRST]' : ''}`)

    // Attempt to persist to main process
    try {
      await window.api.preference.set(key, value)
      // Success: confirm optimistic update
      this.confirmOptimistic(key, requestId)
      logger.debug(`Optimistic update for ${key} (${requestId}) confirmed`)
    } catch (error) {
      // Failure: rollback optimistic update
      this.rollbackOptimistic(key, requestId)
      logger.error(`Optimistic update failed for ${key} (${requestId}), rolling back:`, error as Error)
      throw error
    }
  }

  /**
   * Pessimistic update: Wait for database confirmation before updating UI
   * Updates database first, then UI on success
   * @param key The preference key to update
   * @param value The new value to set
   * @returns Promise that resolves when update completes
   */
  private async setPessimistic<K extends PreferenceKeyType>(
    key: K,
    value: PreferenceDefaultScopeType[K]
  ): Promise<void> {
    try {
      await window.api.preference.set(key, value)

      // Update local cache after successful database update
      this.cache[key] = value
      this.notifyChangeListeners(key)

      logger.debug(`Pessimistic update for ${key} completed`)
    } catch (error) {
      logger.error(`Pessimistic update failed for ${key}:`, error as Error)
      throw error
    }
  }

  /**
   * Get multiple preferences at once with caching and auto-subscription
   * @param keys Array of preference keys to retrieve
   * @returns Promise resolving to partial object with preference values
   */
  public async getMultipleRaw(keys: PreferenceKeyType[]): Promise<Partial<PreferenceDefaultScopeType>> {
    // Check which keys are already cached
    const cachedResults: Partial<PreferenceDefaultScopeType> = {}
    const uncachedKeys: PreferenceKeyType[] = []

    for (const key of keys) {
      if (key in this.cache && this.cache[key] !== undefined) {
        cachedResults[key] = this.cache[key]
      } else {
        logger.verbose(`getMultiple: ${key} not found in cache`)
        uncachedKeys.push(key)
      }
    }

    // Fetch uncached keys from main process
    if (uncachedKeys.length > 0) {
      try {
        const uncachedResults = await window.api.preference.getMultiple(uncachedKeys)

        // Update cache with new results
        for (const [key, value] of Object.entries(uncachedResults)) {
          this.cache[key as PreferenceKeyType] = value

          this.notifyChangeListeners(key)

          await this.subscribeToKeyInternal([key as PreferenceKeyType])
        }

        return { ...cachedResults, ...uncachedResults }
      } catch (error) {
        logger.error('Failed to get multiple preferences:', error as Error)

        // Fill in default values for failed keys
        const defaultResults: Partial<PreferenceDefaultScopeType> = {}
        for (const key of uncachedKeys) {
          if (key in DefaultPreferences.default) {
            ;(defaultResults as any)[key] = DefaultPreferences.default[key]
          }
        }

        return { ...cachedResults, ...defaultResults }
      }
    }

    return cachedResults
  }

  /**
   * Get multiple preferences at once and return them as a record of key-value pairs
   * @param keys Object mapping local names to preference keys
   * @returns Promise resolving to object with mapped preference values
   */
  public async getMultiple<T extends Record<string, PreferenceKeyType>>(
    keys: T
  ): Promise<{ [P in keyof T]: PreferenceDefaultScopeType[T[P]] }> {
    const values = await this.getMultipleRaw(Object.values(keys))
    const result = {} as { [P in keyof T]: PreferenceDefaultScopeType[T[P]] }

    for (const key in keys) {
      result[key] = values[keys[key]]!
    }

    return result
  }

  /**
   * Set multiple preferences at once with configurable update strategy
   * @param updates Object containing preference key-value pairs to update
   * @param options Update strategy options (optimistic by default)
   * @returns Promise that resolves when all updates complete
   */
  public async setMultiple(
    updates: Partial<PreferenceDefaultScopeType>,
    options: PreferenceUpdateOptions = { optimistic: true }
  ): Promise<void> {
    if (options.optimistic) {
      return this.setMultipleOptimistic(updates)
    } else {
      return this.setMultiplePessimistic(updates)
    }
  }

  /**
   * Optimistic batch update: Update UI immediately, then sync to database
   * @param updates Object containing preference key-value pairs to update
   * @returns Promise that resolves when batch update completes
   */
  private async setMultipleOptimistic(updates: Partial<PreferenceDefaultScopeType>): Promise<void> {
    const batchRequestId = this.generateRequestId()
    const originalValues: Record<string, any> = {}
    const keysToUpdate = Object.keys(updates) as PreferenceKeyType[]

    // For batch updates, we need to check for existing optimistic states
    // and preserve the original values from first requests
    for (const key of keysToUpdate) {
      const existingState = this.optimisticValues.get(key)
      originalValues[key] = existingState ? existingState.originalValue : this.cache[key as PreferenceKeyType]
    }

    // Update cache immediately and track original values
    for (const [key, value] of Object.entries(updates)) {
      this.cache[key as PreferenceKeyType] = value
      this.notifyChangeListeners(key)
    }

    // Track optimistic states for all keys with proper original value protection
    const timestamp = Date.now()
    keysToUpdate.forEach((key) => {
      const existingState = this.optimisticValues.get(key)
      const isFirst = !existingState

      this.optimisticValues.set(key, {
        value: updates[key as PreferenceKeyType],
        originalValue: originalValues[key], // Use protected original value
        timestamp,
        requestId: `${batchRequestId}_${key}`, // Unique ID per key in batch
        isFirst
      })
    })

    logger.debug(`Optimistic batch update for ${keysToUpdate.length} preferences (${batchRequestId})`)

    // Attempt to persist to main process
    try {
      await window.api.preference.setMultiple(updates)
      // Success: confirm all optimistic updates
      keysToUpdate.forEach((key) => this.confirmOptimistic(key, `${batchRequestId}_${key}`))
      logger.debug(`Optimistic batch update confirmed for ${keysToUpdate.length} preferences (${batchRequestId})`)
    } catch (error) {
      // Failure: rollback all optimistic updates
      keysToUpdate.forEach((key) => this.rollbackOptimistic(key, `${batchRequestId}_${key}`))
      logger.error(
        `Optimistic batch update failed, rolling back ${keysToUpdate.length} preferences (${batchRequestId}):`,
        error as Error
      )
      throw error
    }
  }

  /**
   * Pessimistic batch update: Wait for database confirmation before updating UI
   * @param updates Object containing preference key-value pairs to update
   * @returns Promise that resolves when batch update completes
   */
  private async setMultiplePessimistic(updates: Partial<PreferenceDefaultScopeType>): Promise<void> {
    try {
      await window.api.preference.setMultiple(updates)

      // Update local cache for all updated values after successful database update
      for (const [key, value] of Object.entries(updates)) {
        this.cache[key as PreferenceKeyType] = value
        this.notifyChangeListeners(key)
      }

      logger.debug(`Pessimistic batch update completed for ${Object.keys(updates).length} preferences`)
    } catch (error) {
      logger.error(`Pessimistic batch update failed:`, error as Error)
      throw error
    }
  }

  /**
   * Subscribe to specific keys for change notifications from main process
   * @param keys Array of preference keys to subscribe to
   * @returns Promise that resolves when subscription is established
   */
  private async subscribeToKeyInternal(keys: PreferenceKeyType[]): Promise<void> {
    const keysToSubscribe = keys.filter((key) => !this.subscribedKeys.has(key))
    if (keysToSubscribe.length === 0) return

    try {
      await window.api.preference.subscribe(keysToSubscribe)
      keysToSubscribe.forEach((key) => this.subscribedKeys.add(key))
      logger.verbose(`Subscribed to preference keys: ${keysToSubscribe.join(', ')}`)
    } catch (error) {
      logger.error(`Failed to subscribe to preference keys ${keysToSubscribe.join(', ')}:`, error as Error)
    }
  }

  /**
   * Subscribe to global preference changes (for useSyncExternalStore)
   * @param callback Function to call when any preference changes
   * @returns Unsubscribe function
   */
  public subscribeAllChanges = (callback: () => void): (() => void) => {
    this.allChangesListeners.add(callback)
    return () => {
      this.allChangesListeners.delete(callback)
    }
  }

  /**
   * Subscribe to specific key changes (for useSyncExternalStore)
   * @param key The preference key to watch for changes
   * @returns Function that takes a callback and returns an unsubscribe function
   */
  public subscribeChange =
    (key: PreferenceKeyType) =>
    (callback: () => void): (() => void) => {
      if (!this.keyChangeListeners.has(key)) {
        this.keyChangeListeners.set(key, new Set())
      }

      const keyListeners = this.keyChangeListeners.get(key)!
      keyListeners.add(callback)

      // Auto-subscribe to this key for updates
      this.subscribeToKeyInternal([key])

      return () => {
        keyListeners.delete(callback)
        if (keyListeners.size === 0) {
          this.keyChangeListeners.delete(key)
        }
      }
    }

  /**
   * Get cached value without async fetch
   * @param key The preference key to retrieve from cache
   * @returns The cached value or undefined if not cached
   */
  public getCachedValue<K extends PreferenceKeyType>(key: K): PreferenceDefaultScopeType[K] | undefined {
    return this.cache[key]
  }

  /**
   * Check if a preference is cached
   * @param key The preference key to check
   * @returns True if the key is cached, false otherwise
   */
  public isCached(key: PreferenceKeyType): boolean {
    return key in this.cache && this.cache[key] !== undefined
  }

  /**
   * Load all preferences from main process at once for optimal performance
   * @returns Promise resolving to all preference values
   */
  public async preloadAll(): Promise<PreferenceDefaultScopeType> {
    try {
      const allPreferences = await window.api.preference.getAll()

      // Update local cache with all preferences
      for (const [key, value] of Object.entries(allPreferences)) {
        this.cache[key as PreferenceKeyType] = value

        // Notify change listeners for the loaded value
        this.notifyChangeListeners(key)
      }

      await this.subscribeToKeyInternal(Object.keys(allPreferences) as PreferenceKeyType[])

      this.fullCacheLoaded = true
      logger.info(`Loaded all ${Object.keys(allPreferences).length} preferences into cache`)

      return allPreferences
    } catch (error) {
      logger.error('Failed to load all preferences:', error as Error)
      throw error
    }
  }

  /**
   * Check if all preferences are loaded in cache
   * @returns True if full cache has been loaded, false otherwise
   */
  public isFullyCached(): boolean {
    return this.fullCacheLoaded
  }

  /**
   * Preload specific preferences into cache
   * @param keys Array of preference keys to preload
   * @returns Promise that resolves when preloading completes
   */
  public async preload(keys: PreferenceKeyType[]): Promise<void> {
    const uncachedKeys = keys.filter((key) => !this.isCached(key))

    if (uncachedKeys.length > 0) {
      try {
        const values = await this.getMultipleRaw(uncachedKeys)
        logger.debug(`Preloaded ${Object.keys(values).length} preferences`)
      } catch (error) {
        logger.error('Failed to preload preferences:', error as Error)
      }
    }
  }

  /**
   * Confirm an optimistic update when main process confirms the update
   * @param key The preference key that was updated
   * @param requestId The unique identifier for the update request
   */
  private confirmOptimistic(key: PreferenceKeyType, requestId: string): void {
    const optimisticState = this.optimisticValues.get(key)
    if (optimisticState && optimisticState.requestId === requestId) {
      this.optimisticValues.delete(key)
      logger.debug(`Optimistic update confirmed for ${key} (${requestId})`)

      // Process next queued request
      this.completeQueuedRequest(key)
    } else {
      logger.warn(
        `Attempted to confirm mismatched request for ${key}: expected ${optimisticState?.requestId}, got ${requestId}`
      )
    }
  }

  /**
   * Rollback an optimistic update when main process update fails
   * @param key The preference key to rollback
   * @param requestId The unique identifier for the failed update request
   */
  private rollbackOptimistic(key: PreferenceKeyType, requestId: string): void {
    const optimisticState = this.optimisticValues.get(key)
    if (optimisticState && optimisticState.requestId === requestId) {
      // Restore original value (the real original value from first request)
      this.cache[key] = optimisticState.originalValue
      this.notifyChangeListeners(key)

      // Clear optimistic state
      this.optimisticValues.delete(key)

      const duration = Date.now() - optimisticState.timestamp
      logger.warn(`Optimistic update rolled back for ${key} (${requestId}) after ${duration}ms to original value`)

      // Process next queued request
      this.completeQueuedRequest(key)
    } else {
      logger.warn(
        `Attempted to rollback mismatched request for ${key}: expected ${optimisticState?.requestId}, got ${requestId}`
      )
    }
  }

  /**
   * Get all pending optimistic updates for debugging purposes
   * @returns Array of pending optimistic update information
   */
  public getPendingOptimisticUpdates(): Array<{
    key: string
    value: any
    originalValue: any
    timestamp: number
    requestId: string
    isFirst: boolean
  }> {
    return Array.from(this.optimisticValues.entries()).map(([key, state]) => ({
      key,
      value: state.value,
      originalValue: state.originalValue,
      timestamp: state.timestamp,
      requestId: state.requestId,
      isFirst: state.isFirst
    }))
  }

  /**
   * Generate unique request ID for tracking concurrent requests
   * @returns Unique request identifier string
   */
  private generateRequestId(): string {
    return `req_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`
  }

  /**
   * Add request to queue for a specific key to prevent race conditions
   * @param key The preference key to update
   * @param requestId Unique identifier for this request
   * @param value The value to set
   * @returns Promise that resolves when the request is processed
   */
  private enqueueRequest(key: PreferenceKeyType, requestId: string, value: any): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (!this.requestQueues.has(key)) {
        this.requestQueues.set(key, [])
      }

      const queue = this.requestQueues.get(key)!
      queue.push({ requestId, value, resolve, reject })

      // If this is the first request in queue, process it immediately
      if (queue.length === 1) {
        this.processNextQueuedRequest(key)
      }
    })
  }

  /**
   * Process the next queued request for a key
   * @param key The preference key to process requests for
   * @returns Promise that resolves when processing completes
   */
  private async processNextQueuedRequest(key: PreferenceKeyType): Promise<void> {
    const queue = this.requestQueues.get(key)
    if (!queue || queue.length === 0) {
      return
    }

    const currentRequest = queue[0]
    try {
      await this.executeOptimisticUpdate(key, currentRequest.value, currentRequest.requestId)
      currentRequest.resolve()
    } catch (error) {
      currentRequest.reject(error)
    }
  }

  /**
   * Complete current request and process next in queue
   * @param key The preference key to complete processing for
   */
  private completeQueuedRequest(key: PreferenceKeyType): void {
    const queue = this.requestQueues.get(key)
    if (queue && queue.length > 0) {
      queue.shift() // Remove completed request

      // Process next request if any
      if (queue.length > 0) {
        this.processNextQueuedRequest(key)
      } else {
        // Clean up empty queue
        this.requestQueues.delete(key)
      }
    }
  }

  /**
   * Clear all cached preferences for testing/debugging
   */
  public clearCache(): void {
    this.cache = {}
    this.fullCacheLoaded = false
    logger.debug('Preference cache cleared')
  }

  /**
   * Cleanup service resources - call when shutting down
   */
  public cleanup(): void {
    if (this.changeListenerCleanup) {
      this.changeListenerCleanup()
      this.changeListenerCleanup = null
    }

    // Clear all optimistic states and request queues
    this.optimisticValues.clear()
    this.requestQueues.clear()

    this.clearCache()
    this.allChangesListeners.clear()
    this.keyChangeListeners.clear()
    this.subscribedKeys.clear()
  }
}

// Export singleton instance
export const preferenceService = PreferenceService.getInstance()
export default preferenceService
