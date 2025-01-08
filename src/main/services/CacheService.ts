interface CacheItem<T> {
  data: T
  timestamp: number
  duration: number
}

export class CacheService {
  private static cache: Map<string, CacheItem<any>> = new Map()

  /**
   * Set cache
   * @param key Cache key
   * @param data Cache data
   * @param duration Cache duration (in milliseconds)
   */
  static set<T>(key: string, data: T, duration: number): void {
    this.cache.set(key, {
      data,
      timestamp: Date.now(),
      duration
    })
  }

  /**
   * Get cache
   * @param key Cache key
   * @returns Returns data if cache exists and not expired, otherwise returns null
   */
  static get<T>(key: string): T | null {
    const item = this.cache.get(key)
    if (!item) return null

    const now = Date.now()
    if (now - item.timestamp > item.duration) {
      this.remove(key)
      return null
    }

    return item.data
  }

  /**
   * Remove specific cache
   * @param key Cache key
   */
  static remove(key: string): void {
    this.cache.delete(key)
  }

  /**
   * Clear all cache
   */
  static clear(): void {
    this.cache.clear()
  }

  /**
   * Check if cache exists and is valid
   * @param key Cache key
   * @returns boolean
   */
  static has(key: string): boolean {
    const item = this.cache.get(key)
    if (!item) return false

    const now = Date.now()
    if (now - item.timestamp > item.duration) {
      this.remove(key)
      return false
    }

    return true
  }
}
