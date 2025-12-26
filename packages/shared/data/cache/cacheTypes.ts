/**
 * Cache types and interfaces for CacheService
 *
 * Supports three-layer caching architecture:
 * 1. Memory cache (cross-component within renderer)
 * 2. Shared cache (cross-window via IPC)
 * 3. Persist cache (cross-window with localStorage persistence)
 */

/**
 * Cache entry with optional TTL support
 */
export interface CacheEntry<T = any> {
  value: T
  expireAt?: number // Unix timestamp
}

/**
 * Cache synchronization message for IPC communication
 */
export interface CacheSyncMessage {
  type: 'shared' | 'persist'
  key: string
  value: any
  ttl?: number
}

/**
 * Batch cache synchronization message
 */
export interface CacheSyncBatchMessage {
  type: 'shared' | 'persist'
  entries: Array<{
    key: string
    value: any
    ttl?: number
  }>
}

/**
 * Cache subscription callback
 */
export type CacheSubscriber = () => void
