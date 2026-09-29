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
  expireAt?: number // Absolute Unix timestamp for precise cross-window sync
}

/**
 * Batch cache synchronization message
 */
export interface CacheSyncBatchMessage {
  type: 'shared' | 'persist'
  entries: Array<{
    key: string
    value: any
    expireAt?: number // Absolute Unix timestamp for precise cross-window sync
  }>
}

/**
 * Cache subscription callback
 */
export type CacheSubscriber = () => void

// ============ Cache Statistics Types ============

/**
 * Summary statistics for a single cache tier
 */
export interface CacheTierSummary {
  /** Total number of entries in this tier */
  totalCount: number
  /** Number of valid (non-expired) entries */
  validCount: number
  /** Number of expired entries (lazy cleanup pending) */
  expiredCount: number
  /** Number of entries with TTL configured */
  withTTLCount: number
  /** Total hook reference count for this tier */
  hookReferences: number
  /** Estimated memory size in bytes (rough estimate via JSON serialization) */
  estimatedBytes: number
}

/**
 * Detailed information for a single cache entry
 */
export interface CacheEntryDetail {
  /** Cache key */
  key: string
  /** Whether the entry has a value */
  hasValue: boolean
  /** Whether TTL is configured */
  hasTTL: boolean
  /** Whether the entry is expired */
  isExpired: boolean
  /** Absolute expiration timestamp (ms since epoch) */
  expireAt?: number
  /** Remaining time until expiration (ms), undefined if no TTL */
  remainingTTL?: number
  /** Number of hooks currently referencing this key */
  hookCount: number
}

/**
 * Complete cache statistics
 */
export interface CacheStats {
  /** Timestamp when stats were collected */
  collectedAt: number

  /** Summary statistics */
  summary: {
    memory: CacheTierSummary
    shared: CacheTierSummary
    persist: CacheTierSummary
    /** Aggregated totals across all tiers */
    total: {
      totalCount: number
      validCount: number
      expiredCount: number
      withTTLCount: number
      hookReferences: number
      /** Total estimated memory in bytes */
      estimatedBytes: number
      /** Human-readable memory size (e.g., "1.5 KB", "2.3 MB") */
      estimatedSize: string
    }
  }

  /** Detailed per-entry information (optional, for debugging) */
  details: {
    memory: CacheEntryDetail[]
    shared: CacheEntryDetail[]
    persist: CacheEntryDetail[]
  }
}
