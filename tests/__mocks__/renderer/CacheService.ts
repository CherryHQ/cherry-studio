import type {
  RendererPersistCacheKey,
  RendererPersistCacheSchema,
  UseCacheKey,
  UseCacheSchema,
  SharedCacheKey,
  SharedCacheSchema
} from '@shared/data/cache/cacheSchemas'
import { DefaultRendererPersistCache, DefaultUseCache, DefaultSharedCache } from '@shared/data/cache/cacheSchemas'
import type { CacheEntry, CacheSubscriber } from '@shared/data/cache/cacheTypes'
import { vi } from 'vitest'

/**
 * Mock CacheService for testing
 * Provides a comprehensive mock of the three-layer cache system
 * Matches the actual CacheService interface from src/renderer/src/data/CacheService.ts
 */

/**
 * Create a mock CacheService with realistic behavior
 */
export const createMockCacheService = (
  options: {
    initialMemoryCache?: Map<string, CacheEntry>
    initialSharedCache?: Map<string, CacheEntry>
    initialPersistCache?: Map<RendererPersistCacheKey, any>
  } = {}
) => {
  // Mock cache storage with CacheEntry structure (includes TTL support)
  const memoryCache = new Map<string, CacheEntry>(options.initialMemoryCache || [])
  const sharedCache = new Map<string, CacheEntry>(options.initialSharedCache || [])
  const persistCache = new Map<RendererPersistCacheKey, any>(options.initialPersistCache || [])

  // Active hooks tracking
  const activeHooks = new Set<string>()

  // Mock subscribers
  const subscribers = new Map<string, Set<CacheSubscriber>>()

  // Shared cache ready state
  let sharedCacheReady = true
  const sharedCacheReadyCallbacks: Array<() => void> = []

  // Helper function to check TTL expiration
  const isExpired = (entry: CacheEntry): boolean => {
    if (entry.expireAt && Date.now() > entry.expireAt) {
      return true
    }
    return false
  }

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
    // ============ Memory Cache (Type-safe) ============

    get: vi.fn(<K extends UseCacheKey>(key: K): UseCacheSchema[K] => {
      const entry = memoryCache.get(key)
      if (entry === undefined) {
        return DefaultUseCache[key]
      }
      if (isExpired(entry)) {
        memoryCache.delete(key)
        notifySubscribers(key)
        return DefaultUseCache[key]
      }
      return entry.value
    }),

    set: vi.fn(<K extends UseCacheKey>(key: K, value: UseCacheSchema[K], ttl?: number): void => {
      const entry: CacheEntry = {
        value,
        expireAt: ttl ? Date.now() + ttl : undefined
      }
      memoryCache.set(key, entry)
      notifySubscribers(key)
    }),

    has: vi.fn(<K extends UseCacheKey>(key: K): boolean => {
      const entry = memoryCache.get(key)
      if (entry === undefined) {
        return false
      }
      if (isExpired(entry)) {
        memoryCache.delete(key)
        notifySubscribers(key)
        return false
      }
      return true
    }),

    delete: vi.fn(<K extends UseCacheKey>(key: K): boolean => {
      if (activeHooks.has(key)) {
        console.error(`Cannot delete key "${key}" as it's being used by useCache hook`)
        return false
      }
      const existed = memoryCache.has(key)
      memoryCache.delete(key)
      if (existed) {
        notifySubscribers(key)
      }
      return true
    }),

    hasTTL: vi.fn(<K extends UseCacheKey>(key: K): boolean => {
      const entry = memoryCache.get(key)
      return entry?.expireAt !== undefined
    }),

    // ============ Memory Cache (Casual - Dynamic Keys) ============

    getCasual: vi.fn(<T>(key: string): T | undefined => {
      const entry = memoryCache.get(key)
      if (entry === undefined) {
        return undefined
      }
      if (isExpired(entry)) {
        memoryCache.delete(key)
        notifySubscribers(key)
        return undefined
      }
      return entry.value as T
    }),

    setCasual: vi.fn(<T>(key: string, value: T, ttl?: number): void => {
      const entry: CacheEntry = {
        value,
        expireAt: ttl ? Date.now() + ttl : undefined
      }
      memoryCache.set(key, entry)
      notifySubscribers(key)
    }),

    hasCasual: vi.fn((key: string): boolean => {
      const entry = memoryCache.get(key)
      if (entry === undefined) {
        return false
      }
      if (isExpired(entry)) {
        memoryCache.delete(key)
        notifySubscribers(key)
        return false
      }
      return true
    }),

    deleteCasual: vi.fn((key: string): boolean => {
      if (activeHooks.has(key)) {
        console.error(`Cannot delete key "${key}" as it's being used by useCache hook`)
        return false
      }
      const existed = memoryCache.has(key)
      memoryCache.delete(key)
      if (existed) {
        notifySubscribers(key)
      }
      return true
    }),

    hasTTLCasual: vi.fn((key: string): boolean => {
      const entry = memoryCache.get(key)
      return entry?.expireAt !== undefined
    }),

    // ============ Shared Cache (Type-safe) ============

    getShared: vi.fn(<K extends SharedCacheKey>(key: K): SharedCacheSchema[K] | undefined => {
      const entry = sharedCache.get(key)
      if (entry === undefined) {
        return DefaultSharedCache[key]
      }
      if (isExpired(entry)) {
        sharedCache.delete(key)
        notifySubscribers(key)
        return DefaultSharedCache[key]
      }
      return entry.value
    }),

    setShared: vi.fn(<K extends SharedCacheKey>(key: K, value: SharedCacheSchema[K], ttl?: number): void => {
      const entry: CacheEntry = {
        value,
        expireAt: ttl ? Date.now() + ttl : undefined
      }
      sharedCache.set(key, entry)
      notifySubscribers(key)
    }),

    hasShared: vi.fn(<K extends SharedCacheKey>(key: K): boolean => {
      const entry = sharedCache.get(key)
      if (entry === undefined) {
        return false
      }
      if (isExpired(entry)) {
        sharedCache.delete(key)
        notifySubscribers(key)
        return false
      }
      return true
    }),

    deleteShared: vi.fn(<K extends SharedCacheKey>(key: K): boolean => {
      if (activeHooks.has(key)) {
        console.error(`Cannot delete key "${key}" as it's being used by useSharedCache hook`)
        return false
      }
      const existed = sharedCache.has(key)
      sharedCache.delete(key)
      if (existed) {
        notifySubscribers(key)
      }
      return true
    }),

    hasSharedTTL: vi.fn(<K extends SharedCacheKey>(key: K): boolean => {
      const entry = sharedCache.get(key)
      return entry?.expireAt !== undefined
    }),

    // ============ Shared Cache (Casual - Dynamic Keys) ============

    getSharedCasual: vi.fn(<T>(key: string): T | undefined => {
      const entry = sharedCache.get(key)
      if (entry === undefined) {
        return undefined
      }
      if (isExpired(entry)) {
        sharedCache.delete(key)
        notifySubscribers(key)
        return undefined
      }
      return entry.value as T
    }),

    setSharedCasual: vi.fn(<T>(key: string, value: T, ttl?: number): void => {
      const entry: CacheEntry = {
        value,
        expireAt: ttl ? Date.now() + ttl : undefined
      }
      sharedCache.set(key, entry)
      notifySubscribers(key)
    }),

    hasSharedCasual: vi.fn((key: string): boolean => {
      const entry = sharedCache.get(key)
      if (entry === undefined) {
        return false
      }
      if (isExpired(entry)) {
        sharedCache.delete(key)
        notifySubscribers(key)
        return false
      }
      return true
    }),

    deleteSharedCasual: vi.fn((key: string): boolean => {
      if (activeHooks.has(key)) {
        console.error(`Cannot delete key "${key}" as it's being used by useSharedCache hook`)
        return false
      }
      const existed = sharedCache.has(key)
      sharedCache.delete(key)
      if (existed) {
        notifySubscribers(key)
      }
      return true
    }),

    hasSharedTTLCasual: vi.fn((key: string): boolean => {
      const entry = sharedCache.get(key)
      return entry?.expireAt !== undefined
    }),

    // ============ Persist Cache ============

    getPersist: vi.fn(<K extends RendererPersistCacheKey>(key: K): RendererPersistCacheSchema[K] => {
      if (persistCache.has(key)) {
        return persistCache.get(key) as RendererPersistCacheSchema[K]
      }
      return DefaultRendererPersistCache[key]
    }),

    setPersist: vi.fn(<K extends RendererPersistCacheKey>(key: K, value: RendererPersistCacheSchema[K]): void => {
      persistCache.set(key, value)
      notifySubscribers(key)
    }),

    hasPersist: vi.fn((key: RendererPersistCacheKey): boolean => {
      return persistCache.has(key)
    }),

    // ============ Hook Reference Management ============

    registerHook: vi.fn((key: string): void => {
      activeHooks.add(key)
    }),

    unregisterHook: vi.fn((key: string): void => {
      activeHooks.delete(key)
    }),

    // ============ Shared Cache Ready State ============

    isSharedCacheReady: vi.fn((): boolean => {
      return sharedCacheReady
    }),

    onSharedCacheReady: vi.fn((callback: () => void): (() => void) => {
      if (sharedCacheReady) {
        callback()
        return () => {}
      }
      sharedCacheReadyCallbacks.push(callback)
      return () => {
        const idx = sharedCacheReadyCallbacks.indexOf(callback)
        if (idx >= 0) {
          sharedCacheReadyCallbacks.splice(idx, 1)
        }
      }
    }),

    // ============ Subscription Management ============

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

    notifySubscribers: vi.fn((key: string): void => {
      notifySubscribers(key)
    }),

    // ============ Lifecycle ============

    cleanup: vi.fn((): void => {
      memoryCache.clear()
      sharedCache.clear()
      persistCache.clear()
      activeHooks.clear()
      subscribers.clear()
    }),

    // ============ Internal State Access for Testing ============

    _getMockState: () => ({
      memoryCache: new Map(memoryCache),
      sharedCache: new Map(sharedCache),
      persistCache: new Map(persistCache),
      activeHooks: new Set(activeHooks),
      subscribers: new Map(subscribers),
      sharedCacheReady
    }),

    _resetMockState: () => {
      memoryCache.clear()
      sharedCache.clear()
      persistCache.clear()
      activeHooks.clear()
      subscribers.clear()
      sharedCacheReady = true
    },

    _setSharedCacheReady: (ready: boolean) => {
      sharedCacheReady = ready
      if (ready) {
        sharedCacheReadyCallbacks.forEach((cb) => cb())
        sharedCacheReadyCallbacks.length = 0
      }
    }
  }

  return mockCacheService
}

// Default mock instance
export const mockCacheService = createMockCacheService()

// Singleton instance mock
export const MockCacheService = {
  CacheService: class MockCacheService {
    static getInstance() {
      return mockCacheService
    }

    // ============ Memory Cache (Type-safe) ============
    get<K extends UseCacheKey>(key: K): UseCacheSchema[K] {
      return mockCacheService.get(key)
    }

    set<K extends UseCacheKey>(key: K, value: UseCacheSchema[K], ttl?: number): void {
      return mockCacheService.set(key, value, ttl)
    }

    has<K extends UseCacheKey>(key: K): boolean {
      return mockCacheService.has(key)
    }

    delete<K extends UseCacheKey>(key: K): boolean {
      return mockCacheService.delete(key)
    }

    hasTTL<K extends UseCacheKey>(key: K): boolean {
      return mockCacheService.hasTTL(key)
    }

    // ============ Memory Cache (Casual) ============
    getCasual<T>(key: string): T | undefined {
      return mockCacheService.getCasual(key) as T | undefined
    }

    setCasual<T>(key: string, value: T, ttl?: number): void {
      return mockCacheService.setCasual(key, value, ttl)
    }

    hasCasual(key: string): boolean {
      return mockCacheService.hasCasual(key)
    }

    deleteCasual(key: string): boolean {
      return mockCacheService.deleteCasual(key)
    }

    hasTTLCasual(key: string): boolean {
      return mockCacheService.hasTTLCasual(key)
    }

    // ============ Shared Cache (Type-safe) ============
    getShared<K extends SharedCacheKey>(key: K): SharedCacheSchema[K] | undefined {
      return mockCacheService.getShared(key)
    }

    setShared<K extends SharedCacheKey>(key: K, value: SharedCacheSchema[K], ttl?: number): void {
      return mockCacheService.setShared(key, value, ttl)
    }

    hasShared<K extends SharedCacheKey>(key: K): boolean {
      return mockCacheService.hasShared(key)
    }

    deleteShared<K extends SharedCacheKey>(key: K): boolean {
      return mockCacheService.deleteShared(key)
    }

    hasSharedTTL<K extends SharedCacheKey>(key: K): boolean {
      return mockCacheService.hasSharedTTL(key)
    }

    // ============ Shared Cache (Casual) ============
    getSharedCasual<T>(key: string): T | undefined {
      return mockCacheService.getSharedCasual(key) as T | undefined
    }

    setSharedCasual<T>(key: string, value: T, ttl?: number): void {
      return mockCacheService.setSharedCasual(key, value, ttl)
    }

    hasSharedCasual(key: string): boolean {
      return mockCacheService.hasSharedCasual(key)
    }

    deleteSharedCasual(key: string): boolean {
      return mockCacheService.deleteSharedCasual(key)
    }

    hasSharedTTLCasual(key: string): boolean {
      return mockCacheService.hasSharedTTLCasual(key)
    }

    // ============ Persist Cache ============
    getPersist<K extends RendererPersistCacheKey>(key: K): RendererPersistCacheSchema[K] {
      return mockCacheService.getPersist(key)
    }

    setPersist<K extends RendererPersistCacheKey>(key: K, value: RendererPersistCacheSchema[K]): void {
      return mockCacheService.setPersist(key, value)
    }

    hasPersist(key: RendererPersistCacheKey): boolean {
      return mockCacheService.hasPersist(key)
    }

    // ============ Hook Reference Management ============
    registerHook(key: string): void {
      return mockCacheService.registerHook(key)
    }

    unregisterHook(key: string): void {
      return mockCacheService.unregisterHook(key)
    }

    // ============ Ready State ============
    isSharedCacheReady(): boolean {
      return mockCacheService.isSharedCacheReady()
    }

    onSharedCacheReady(callback: () => void): () => void {
      return mockCacheService.onSharedCacheReady(callback)
    }

    // ============ Subscription ============
    subscribe(key: string, callback: CacheSubscriber): () => void {
      return mockCacheService.subscribe(key, callback)
    }

    notifySubscribers(key: string): void {
      return mockCacheService.notifySubscribers(key)
    }

    // ============ Lifecycle ============
    cleanup(): void {
      return mockCacheService.cleanup()
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
      mockCacheService._resetMockState()
    }
  },

  /**
   * Set initial cache state for testing
   */
  setInitialState: (state: {
    memory?: Array<[string, any, number?]> // [key, value, ttl?]
    shared?: Array<[string, any, number?]>
    persist?: Array<[RendererPersistCacheKey, any]>
  }) => {
    mockCacheService._resetMockState()

    state.memory?.forEach(([key, value, ttl]) => {
      mockCacheService.setCasual(key, value, ttl)
    })
    state.shared?.forEach(([key, value, ttl]) => {
      mockCacheService.setSharedCasual(key, value, ttl)
    })
    state.persist?.forEach(([key, value]) => {
      mockCacheService.setPersist(key, value)
    })
  },

  /**
   * Get current mock state for inspection
   */
  getCurrentState: () => {
    return mockCacheService._getMockState()
  },

  /**
   * Simulate cache events for testing subscribers
   */
  triggerCacheChange: (key: string, value: any, ttl?: number) => {
    mockCacheService.setCasual(key, value, ttl)
  },

  /**
   * Set shared cache ready state for testing
   */
  setSharedCacheReady: (ready: boolean) => {
    mockCacheService._setSharedCacheReady(ready)
  },

  /**
   * Simulate TTL expiration by manipulating cache entries
   */
  simulateTTLExpiration: (key: string) => {
    const state = mockCacheService._getMockState()
    const entry = state.memoryCache.get(key) || state.sharedCache.get(key)
    if (entry) {
      entry.expireAt = Date.now() - 1000 // Set to expired
    }
  }
}
