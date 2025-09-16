import type {
  RendererPersistCacheKey,
  RendererPersistCacheSchema,
  UseCacheKey,
  UseSharedCacheKey
} from '@shared/data/cache/cacheSchemas'
import { DefaultRendererPersistCache, DefaultUseCache, DefaultUseSharedCache } from '@shared/data/cache/cacheSchemas'
import type { CacheSubscriber } from '@shared/data/cache/cacheTypes'
import { vi } from 'vitest'

/**
 * Mock CacheService for testing
 * Provides a comprehensive mock of the three-layer cache system
 */

/**
 * Create a mock CacheService with realistic behavior
 */
export const createMockCacheService = (
  options: {
    initialMemoryCache?: Map<string, any>
    initialSharedCache?: Map<string, any>
    initialPersistCache?: Map<RendererPersistCacheKey, any>
  } = {}
) => {
  // Mock cache storage
  const memoryCache = new Map<string, any>(options.initialMemoryCache || [])
  const sharedCache = new Map<string, any>(options.initialSharedCache || [])
  const persistCache = new Map<RendererPersistCacheKey, any>(options.initialPersistCache || [])

  // Mock subscribers
  const subscribers = new Map<string, Set<CacheSubscriber>>()

  // Helper function to notify subscribers
  const notifySubscribers = (key: string) => {
    const keySubscribers = subscribers.get(key)
    if (keySubscribers) {
      keySubscribers.forEach((callback) => {
        try {
          callback()
        } catch (error) {
          console.warn('Mock CacheService: Subscriber callback error:', error)
        }
      })
    }
  }

  const mockCacheService = {
    // Memory cache methods
    get: vi.fn(<T>(key: string): T | null => {
      if (memoryCache.has(key)) {
        return memoryCache.get(key) as T
      }
      // Return default values for known cache keys
      const defaultValue = getDefaultValueForKey(key)
      return defaultValue !== undefined ? defaultValue : null
    }),

    set: vi.fn(<T>(key: string, value: T): void => {
      const oldValue = memoryCache.get(key)
      memoryCache.set(key, value)
      if (oldValue !== value) {
        notifySubscribers(key)
      }
    }),

    delete: vi.fn((key: string): boolean => {
      const existed = memoryCache.has(key)
      memoryCache.delete(key)
      if (existed) {
        notifySubscribers(key)
      }
      return existed
    }),

    clear: vi.fn((): void => {
      const keys = Array.from(memoryCache.keys())
      memoryCache.clear()
      keys.forEach((key) => notifySubscribers(key))
    }),

    has: vi.fn((key: string): boolean => {
      return memoryCache.has(key)
    }),

    size: vi.fn((): number => {
      return memoryCache.size
    }),

    // Shared cache methods
    getShared: vi.fn(<T>(key: string): T | null => {
      if (sharedCache.has(key)) {
        return sharedCache.get(key) as T
      }
      const defaultValue = getDefaultSharedValueForKey(key)
      return defaultValue !== undefined ? defaultValue : null
    }),

    setShared: vi.fn(<T>(key: string, value: T): void => {
      const oldValue = sharedCache.get(key)
      sharedCache.set(key, value)
      if (oldValue !== value) {
        notifySubscribers(`shared:${key}`)
      }
    }),

    deleteShared: vi.fn((key: string): boolean => {
      const existed = sharedCache.has(key)
      sharedCache.delete(key)
      if (existed) {
        notifySubscribers(`shared:${key}`)
      }
      return existed
    }),

    clearShared: vi.fn((): void => {
      const keys = Array.from(sharedCache.keys())
      sharedCache.clear()
      keys.forEach((key) => notifySubscribers(`shared:${key}`))
    }),

    // Persist cache methods
    getPersist: vi.fn(<K extends RendererPersistCacheKey>(key: K): RendererPersistCacheSchema[K] => {
      if (persistCache.has(key)) {
        return persistCache.get(key) as RendererPersistCacheSchema[K]
      }
      return DefaultRendererPersistCache[key]
    }),

    setPersist: vi.fn(<K extends RendererPersistCacheKey>(key: K, value: RendererPersistCacheSchema[K]): void => {
      const oldValue = persistCache.get(key)
      persistCache.set(key, value)
      if (oldValue !== value) {
        notifySubscribers(`persist:${key}`)
      }
    }),

    deletePersist: vi.fn(<K extends RendererPersistCacheKey>(key: K): boolean => {
      const existed = persistCache.has(key)
      persistCache.delete(key)
      if (existed) {
        notifySubscribers(`persist:${key}`)
      }
      return existed
    }),

    clearPersist: vi.fn((): void => {
      const keys = Array.from(persistCache.keys()) as RendererPersistCacheKey[]
      persistCache.clear()
      keys.forEach((key) => notifySubscribers(`persist:${key}`))
    }),

    // Subscription methods
    subscribe: vi.fn((key: string, callback: CacheSubscriber): (() => void) => {
      if (!subscribers.has(key)) {
        subscribers.set(key, new Set())
      }
      subscribers.get(key)!.add(callback)

      // Return unsubscribe function
      return () => {
        const keySubscribers = subscribers.get(key)
        if (keySubscribers) {
          keySubscribers.delete(callback)
          if (keySubscribers.size === 0) {
            subscribers.delete(key)
          }
        }
      }
    }),

    unsubscribe: vi.fn((key: string, callback?: CacheSubscriber): void => {
      if (callback) {
        const keySubscribers = subscribers.get(key)
        if (keySubscribers) {
          keySubscribers.delete(callback)
          if (keySubscribers.size === 0) {
            subscribers.delete(key)
          }
        }
      } else {
        subscribers.delete(key)
      }
    }),

    // Hook reference tracking (for advanced cache management)
    addHookReference: vi.fn((): void => {
      // Mock implementation - in real service this prevents cache cleanup
    }),

    removeHookReference: vi.fn((): void => {
      // Mock implementation
    }),

    // Utility methods
    getAllKeys: vi.fn((): string[] => {
      return Array.from(memoryCache.keys())
    }),

    getStats: vi.fn(() => ({
      memorySize: memoryCache.size,
      sharedSize: sharedCache.size,
      persistSize: persistCache.size,
      subscriberCount: subscribers.size
    })),

    // Internal state access for testing
    _getMockState: () => ({
      memoryCache: new Map(memoryCache),
      sharedCache: new Map(sharedCache),
      persistCache: new Map(persistCache),
      subscribers: new Map(subscribers)
    }),

    _resetMockState: () => {
      memoryCache.clear()
      sharedCache.clear()
      persistCache.clear()
      subscribers.clear()
    }
  }

  return mockCacheService
}

/**
 * Get default value for cache keys based on schema
 */
function getDefaultValueForKey(key: string): any {
  // Try to match against known cache schemas
  if (key in DefaultUseCache) {
    return DefaultUseCache[key as UseCacheKey]
  }
  return undefined
}

function getDefaultSharedValueForKey(key: string): any {
  if (key in DefaultUseSharedCache) {
    return DefaultUseSharedCache[key as UseSharedCacheKey]
  }
  return undefined
}

// Default mock instance
export const mockCacheService = createMockCacheService()

// Singleton instance mock
export const MockCacheService = {
  CacheService: class MockCacheService {
    static getInstance() {
      return mockCacheService
    }

    // Delegate all methods to the mock
    get<T>(key: string): T | null {
      return mockCacheService.get(key) as T | null
    }

    set<T>(key: string, value: T): void {
      return mockCacheService.set(key, value)
    }

    delete(key: string): boolean {
      return mockCacheService.delete(key)
    }

    clear(): void {
      return mockCacheService.clear()
    }

    has(key: string): boolean {
      return mockCacheService.has(key)
    }

    size(): number {
      return mockCacheService.size()
    }

    getShared<T>(key: string): T | null {
      return mockCacheService.getShared(key) as T | null
    }

    setShared<T>(key: string, value: T): void {
      return mockCacheService.setShared(key, value)
    }

    deleteShared(key: string): boolean {
      return mockCacheService.deleteShared(key)
    }

    clearShared(): void {
      return mockCacheService.clearShared()
    }

    getPersist<K extends RendererPersistCacheKey>(key: K): RendererPersistCacheSchema[K] {
      return mockCacheService.getPersist(key)
    }

    setPersist<K extends RendererPersistCacheKey>(key: K, value: RendererPersistCacheSchema[K]): void {
      return mockCacheService.setPersist(key, value)
    }

    deletePersist<K extends RendererPersistCacheKey>(key: K): boolean {
      return mockCacheService.deletePersist(key)
    }

    clearPersist(): void {
      return mockCacheService.clearPersist()
    }

    subscribe(key: string, callback: CacheSubscriber): () => void {
      return mockCacheService.subscribe(key, callback)
    }

    unsubscribe(key: string, callback?: CacheSubscriber): void {
      return mockCacheService.unsubscribe(key, callback)
    }

    addHookReference(): void {
      return mockCacheService.addHookReference()
    }

    removeHookReference(): void {
      return mockCacheService.removeHookReference()
    }

    getAllKeys(): string[] {
      return mockCacheService.getAllKeys()
    }

    getStats() {
      return mockCacheService.getStats()
    }
  },
  cacheService: mockCacheService
}

/**
 * Utility functions for testing
 */
export const MockCacheUtils = {
  /**
   * Reset all mock function call counts and state
   */
  resetMocks: () => {
    Object.values(mockCacheService).forEach((method) => {
      if (vi.isMockFunction(method)) {
        method.mockClear()
      }
    })
    if ('_resetMockState' in mockCacheService) {
      ;(mockCacheService as any)._resetMockState()
    }
  },

  /**
   * Set initial cache state for testing
   */
  setInitialState: (state: {
    memory?: Array<[string, any]>
    shared?: Array<[string, any]>
    persist?: Array<[RendererPersistCacheKey, any]>
  }) => {
    if ('_resetMockState' in mockCacheService) {
      ;(mockCacheService as any)._resetMockState()
    }

    state.memory?.forEach(([key, value]) => mockCacheService.set(key, value))
    state.shared?.forEach(([key, value]) => mockCacheService.setShared(key, value))
    state.persist?.forEach(([key, value]) => mockCacheService.setPersist(key, value))
  },

  /**
   * Get current mock state for inspection
   */
  getCurrentState: () => {
    if ('_getMockState' in mockCacheService) {
      return (mockCacheService as any)._getMockState()
    }
    return null
  },

  /**
   * Simulate cache events for testing subscribers
   */
  triggerCacheChange: (key: string, value: any) => {
    mockCacheService.set(key, value)
  }
}
