import { loggerService } from '@logger'
import type { JSONValue } from 'ai'

const logger = loggerService.withContext('Cache')
/**
 * Cache entry with TTL support
 */
interface CacheEntry<T> {
  details: T
  timestamp: number
}

/**
 * In-memory cache for reasoning details
 * Key: signature
 * Value: reasoning array with timestamp
 */
export class ReasoningCache<T> {
  private cache = new Map<string, CacheEntry<T>>()
  private readonly ttlMs: number
  private cleanupInterval: ReturnType<typeof setInterval> | null = null

  constructor(ttlMs: number = 30 * 60 * 1000) {
    // Default 30 minutes TTL
    this.ttlMs = ttlMs
    this.startCleanup()
  }

  /**
   * Store reasoning details by signature
   */
  set(signature: string, details: T): void {
    if (!signature || !details) return

    this.cache.set(signature, {
      details,
      timestamp: Date.now()
    })
  }

  /**
   * Retrieve reasoning details by signature
   */
  get(signature: string): T | undefined {
    const entry = this.cache.get(signature)
    if (!entry) return undefined

    // Check TTL
    if (Date.now() - entry.timestamp > this.ttlMs) {
      this.cache.delete(signature)
      return undefined
    }

    return entry.details
  }

  /**
   * Clear expired entries
   */
  cleanup(): void {
    const now = Date.now()
    let cleaned = 0

    for (const [key, entry] of this.cache) {
      if (now - entry.timestamp > this.ttlMs) {
        this.cache.delete(key)
        cleaned++
      }
    }

    if (cleaned > 0) {
      logger.debug('Cleaned up expired reasoning cache entries', { cleaned, remaining: this.cache.size })
    }
  }

  /**
   * Start periodic cleanup
   */
  private startCleanup(): void {
    // Cleanup every 5 minutes
    this.cleanupInterval = setInterval(() => this.cleanup(), 5 * 60 * 1000)
  }

  /**
   * Stop cleanup and clear cache
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval)
      this.cleanupInterval = null
    }
    this.cache.clear()
  }

  /**
   * Get cache stats for debugging
   */
  stats(): { size: number; ttlMs: number } {
    return {
      size: this.cache.size,
      ttlMs: this.ttlMs
    }
  }
}

// Singleton cache instance
export const reasoningCache = new ReasoningCache<JSONValue>()
