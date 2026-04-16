import type { SharedCacheKey, SharedCacheSchema } from '@shared/data/cache/cacheSchemas'
import type { CacheEntry, CacheSyncMessage } from '@shared/data/cache/cacheTypes'
import { vi } from 'vitest'

/**
 * Mock CacheService for main process testing
 * Simulates the complete main process CacheService functionality
 */

// Mock cache storage
const mockMainCache = new Map<string, CacheEntry>()

// Mock shared cache storage
const mockSharedCache = new Map<string, CacheEntry>()

// Mock broadcast tracking
const mockBroadcastCalls: Array<{ message: CacheSyncMessage; senderWindowId?: number }> = []

/**
 * Mock CacheService class
 */
export class MockMainCacheService {
  private static instance: MockMainCacheService
  private initialized = false

  private constructor() {}

  public static getInstance(): MockMainCacheService {
    if (!MockMainCacheService.instance) {
      MockMainCacheService.instance = new MockMainCacheService()
    }
    return MockMainCacheService.instance
  }

  // Mock initialization
  public initialize = vi.fn(async (): Promise<void> => {
    this.initialized = true
  })

  // Mock main process cache methods
  public get = vi.fn(<T>(key: string): T | undefined => {
    const entry = mockMainCache.get(key)
    if (!entry) return undefined

    // Check TTL (lazy cleanup)
    if (entry.expireAt && Date.now() > entry.expireAt) {
      mockMainCache.delete(key)
      return undefined
    }

    return entry.value as T
  })

  public set = vi.fn(<T>(key: string, value: T, ttl?: number): void => {
    const entry: CacheEntry<T> = {
      value,
      expireAt: ttl ? Date.now() + ttl : undefined
    }
    mockMainCache.set(key, entry)
  })

  public has = vi.fn((key: string): boolean => {
    const entry = mockMainCache.get(key)
    if (!entry) return false

    // Check TTL
    if (entry.expireAt && Date.now() > entry.expireAt) {
      mockMainCache.delete(key)
      return false
    }

    return true
  })

  public delete = vi.fn((key: string): boolean => {
    return mockMainCache.delete(key)
  })

  // ============ Shared Cache Methods ============

  public getShared = vi.fn(<K extends SharedCacheKey>(key: K): SharedCacheSchema[K] | undefined => {
    const entry = mockSharedCache.get(key)
    if (!entry) return undefined

    // Check TTL (lazy cleanup)
    if (entry.expireAt && Date.now() > entry.expireAt) {
      mockSharedCache.delete(key)
      return undefined
    }

    return entry.value as SharedCacheSchema[K]
  })

  public setShared = vi.fn(<K extends SharedCacheKey>(key: K, value: SharedCacheSchema[K], ttl?: number): void => {
    const entry: CacheEntry = {
      value,
      expireAt: ttl ? Date.now() + ttl : undefined
    }
    mockSharedCache.set(key, entry)

    // Track broadcast for testing
    mockBroadcastCalls.push({
      message: {
        type: 'shared',
        key,
        value,
        expireAt: entry.expireAt
      }
    })
  })

  public hasShared = vi.fn(<K extends SharedCacheKey>(key: K): boolean => {
    const entry = mockSharedCache.get(key)
    if (!entry) return false

    // Check TTL
    if (entry.expireAt && Date.now() > entry.expireAt) {
      mockSharedCache.delete(key)
      return false
    }

    return true
  })

  public deleteShared = vi.fn(<K extends SharedCacheKey>(key: K): boolean => {
    if (!mockSharedCache.has(key)) {
      return true
    }

    mockSharedCache.delete(key)

    // Track broadcast for testing
    mockBroadcastCalls.push({
      message: {
        type: 'shared',
        key,
        value: undefined
      }
    })

    return true
  })

  // Mock cleanup
  public cleanup = vi.fn((): void => {
    mockMainCache.clear()
    mockSharedCache.clear()
    mockBroadcastCalls.length = 0
  })

  // Private methods exposed for testing
  // These methods are mocked but not exposed to avoid TypeScript unused warnings
}

// Mock singleton instance
const mockInstance = MockMainCacheService.getInstance()

/**
 * Export mock service
 */
export const MockMainCacheServiceExport = {
  CacheService: MockMainCacheService,
  cacheService: mockInstance
}

/**
 * Utility functions for testing
 */
export const MockMainCacheServiceUtils = {
  /**
   * Reset all mock call counts and state
   */
  resetMocks: () => {
    // Reset all method mocks
    Object.values(mockInstance).forEach((method) => {
      if (vi.isMockFunction(method)) {
        method.mockClear()
      }
    })

    // Reset cache state
    mockMainCache.clear()
    mockSharedCache.clear()
    mockBroadcastCalls.length = 0

    // Reset initialized state
    mockInstance['initialized'] = false
  },

  /**
   * Set cache value for testing
   */
  setCacheValue: <T>(key: string, value: T, ttl?: number) => {
    const entry: CacheEntry<T> = {
      value,
      expireAt: ttl ? Date.now() + ttl : undefined
    }
    mockMainCache.set(key, entry)
  },

  /**
   * Get cache value for testing
   */
  getCacheValue: <T>(key: string): T | undefined => {
    const entry = mockMainCache.get(key)
    if (!entry) return undefined

    // Check TTL
    if (entry.expireAt && Date.now() > entry.expireAt) {
      mockMainCache.delete(key)
      return undefined
    }

    return entry.value as T
  },

  /**
   * Set initialization state for testing
   */
  setInitialized: (initialized: boolean) => {
    mockInstance['initialized'] = initialized
  },

  /**
   * Get current initialization state
   */
  isInitialized: (): boolean => {
    return mockInstance['initialized']
  },

  /**
   * Get all cache entries for testing
   */
  getAllCacheEntries: (): Map<string, CacheEntry> => {
    return new Map(mockMainCache)
  },

  // ============ Shared Cache Utilities ============

  /**
   * Set shared cache value for testing
   */
  setSharedCacheValue: <K extends SharedCacheKey>(key: K, value: SharedCacheSchema[K], ttl?: number) => {
    const entry: CacheEntry = {
      value,
      expireAt: ttl ? Date.now() + ttl : undefined
    }
    mockSharedCache.set(key, entry)
  },

  /**
   * Get shared cache value for testing
   */
  getSharedCacheValue: <K extends SharedCacheKey>(key: K): SharedCacheSchema[K] | undefined => {
    const entry = mockSharedCache.get(key)
    if (!entry) return undefined

    // Check TTL
    if (entry.expireAt && Date.now() > entry.expireAt) {
      mockSharedCache.delete(key)
      return undefined
    }

    return entry.value as SharedCacheSchema[K]
  },

  /**
   * Get all shared cache entries for testing
   */
  getAllSharedCacheEntries: (): Map<string, CacheEntry> => {
    return new Map(mockSharedCache)
  },

  /**
   * Simulate shared cache expiration for testing
   */
  simulateSharedCacheExpiration: (key: string) => {
    const entry = mockSharedCache.get(key)
    if (entry) {
      entry.expireAt = Date.now() - 1000 // Set to expired
    }
  },

  /**
   * Get broadcast call history for testing
   */
  getBroadcastHistory: (): Array<{ message: CacheSyncMessage; senderWindowId?: number }> => {
    return [...mockBroadcastCalls]
  },

  /**
   * Simulate cache sync broadcast
   */
  simulateCacheSync: (message: CacheSyncMessage, senderWindowId?: number) => {
    mockBroadcastCalls.push({ message, senderWindowId })
  },

  /**
   * Set multiple cache values at once
   */
  setMultipleCacheValues: (values: Array<[string, any, number?]>) => {
    values.forEach(([key, value, ttl]) => {
      const entry: CacheEntry = {
        value,
        expireAt: ttl ? Date.now() + ttl : undefined
      }
      mockMainCache.set(key, entry)
    })
  },

  /**
   * Simulate cache expiration for testing
   */
  simulateCacheExpiration: (key: string) => {
    const entry = mockMainCache.get(key)
    if (entry) {
      entry.expireAt = Date.now() - 1000 // Set to expired
    }
  },

  /**
   * Get cache statistics
   */
  getCacheStats: () => ({
    totalEntries: mockMainCache.size,
    sharedEntries: mockSharedCache.size,
    broadcastCalls: mockBroadcastCalls.length,
    keys: Array.from(mockMainCache.keys()),
    sharedKeys: Array.from(mockSharedCache.keys())
  }),

  /**
   * Mock initialization error
   */
  simulateInitializationError: (error: Error) => {
    mockInstance.initialize.mockRejectedValue(error)
  },

  /**
   * Get mock call counts for debugging
   */
  getMockCallCounts: () => ({
    initialize: mockInstance.initialize.mock.calls.length,
    get: mockInstance.get.mock.calls.length,
    set: mockInstance.set.mock.calls.length,
    has: mockInstance.has.mock.calls.length,
    delete: mockInstance.delete.mock.calls.length,
    getShared: mockInstance.getShared.mock.calls.length,
    setShared: mockInstance.setShared.mock.calls.length,
    hasShared: mockInstance.hasShared.mock.calls.length,
    deleteShared: mockInstance.deleteShared.mock.calls.length,
    cleanup: mockInstance.cleanup.mock.calls.length
  })
}
