import type { InferSharedCacheValue, SharedCacheKey } from '@shared/data/cache/cacheSchemas'

interface Entry {
  value: unknown
  expireAt?: number
}

/**
 * The memory and shared tiers of the desktop `CacheService`, with its TTL semantics. The
 * Worker serves one page, so the shared tier is not relayed anywhere yet.
 */
export class WebCacheService {
  readonly #entries = new Map<string, Entry>()

  get<T>(key: string): T | undefined {
    const entry = this.#entries.get(key)
    if (entry?.expireAt && Date.now() > entry.expireAt) {
      this.#entries.delete(key)
      return undefined
    }
    return entry?.value as T | undefined
  }

  set<T>(key: string, value: T, ttl?: number): void {
    this.#entries.set(key, { value, expireAt: ttl ? Date.now() + ttl : undefined })
  }

  getShared<K extends SharedCacheKey>(key: K): InferSharedCacheValue<K> | undefined {
    return this.get(`shared:${key}`)
  }

  setShared<K extends SharedCacheKey>(key: K, value: InferSharedCacheValue<K>, ttl?: number): void {
    this.set(`shared:${key}`, value, ttl)
  }

  deleteShared<K extends SharedCacheKey>(key: K): boolean {
    return this.#entries.delete(`shared:${key}`)
  }
}
