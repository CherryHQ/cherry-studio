import type {
  RendererPersistCacheKey,
  RendererPersistCacheSchema,
  UseCacheKey,
  UseCacheSchema,
  InferUseCacheValue,
  SharedCacheKey,
  SharedCacheSchema
} from '@shared/data/cache/cacheSchemas'
import { DefaultRendererPersistCache, DefaultUseCache, DefaultSharedCache } from '@shared/data/cache/cacheSchemas'
import { vi } from 'vitest'

/**
 * Mock useCache hooks for testing
 * Provides comprehensive mocks for all cache management hooks
 */

// Mock cache state storage (using string for memory cache to support template keys)
const mockMemoryCache = new Map<string, any>()
const mockSharedCache = new Map<SharedCacheKey, any>()
const mockPersistCache = new Map<RendererPersistCacheKey, any>()

// Initialize caches with defaults
Object.entries(DefaultUseCache).forEach(([key, value]) => {
  mockMemoryCache.set(key, value)
})

Object.entries(DefaultSharedCache).forEach(([key, value]) => {
  mockSharedCache.set(key as SharedCacheKey, value)
})

Object.entries(DefaultRendererPersistCache).forEach(([key, value]) => {
  mockPersistCache.set(key as RendererPersistCacheKey, value)
})

// Mock subscribers for cache changes (using string for memory to support template keys)
const mockMemorySubscribers = new Map<string, Set<() => void>>()
const mockSharedSubscribers = new Map<SharedCacheKey, Set<() => void>>()
const mockPersistSubscribers = new Map<RendererPersistCacheKey, Set<() => void>>()

// Helper functions to notify subscribers
const notifyMemorySubscribers = (key: string) => {
  const subscribers = mockMemorySubscribers.get(key)
  if (subscribers) {
    subscribers.forEach((callback) => {
      try {
        callback()
      } catch (error) {
        console.warn('Mock useCache: Memory subscriber callback error:', error)
      }
    })
  }
}

const notifySharedSubscribers = (key: SharedCacheKey) => {
  const subscribers = mockSharedSubscribers.get(key)
  if (subscribers) {
    subscribers.forEach((callback) => {
      try {
        callback()
      } catch (error) {
        console.warn('Mock useCache: Shared subscriber callback error:', error)
      }
    })
  }
}

const notifyPersistSubscribers = (key: RendererPersistCacheKey) => {
  const subscribers = mockPersistSubscribers.get(key)
  if (subscribers) {
    subscribers.forEach((callback) => {
      try {
        callback()
      } catch (error) {
        console.warn('Mock useCache: Persist subscriber callback error:', error)
      }
    })
  }
}

// ============ Template Key Utilities ============

/**
 * Checks if a schema key is a template key (contains ${...} placeholder).
 */
const isTemplateKey = (key: string): boolean => {
  return key.includes('${') && key.includes('}')
}

/**
 * Converts a template key pattern into a RegExp for matching concrete keys.
 */
const templateToRegex = (template: string): RegExp => {
  const escaped = template.replace(/[.*+?^${}()|[\]\\]/g, (match) => {
    if (match === '$' || match === '{' || match === '}') {
      return match
    }
    return '\\' + match
  })
  const pattern = escaped.replace(/\$\{[^}]+\}/g, '([\\w\\-]+)')
  return new RegExp(`^${pattern}$`)
}

/**
 * Finds the schema key that matches a given concrete key.
 */
const findMatchingSchemaKey = (key: string): keyof UseCacheSchema | undefined => {
  if (key in DefaultUseCache) {
    return key as keyof UseCacheSchema
  }
  const schemaKeys = Object.keys(DefaultUseCache) as Array<keyof UseCacheSchema>
  for (const schemaKey of schemaKeys) {
    if (isTemplateKey(schemaKey as string)) {
      const regex = templateToRegex(schemaKey as string)
      if (regex.test(key)) {
        return schemaKey
      }
    }
  }
  return undefined
}

/**
 * Gets the default value for a cache key from the schema.
 */
const getDefaultValue = <K extends UseCacheKey>(key: K): InferUseCacheValue<K> | undefined => {
  const schemaKey = findMatchingSchemaKey(key)
  if (schemaKey) {
    return DefaultUseCache[schemaKey] as InferUseCacheValue<K>
  }
  return undefined
}

/**
 * Mock useCache hook (memory cache)
 */
export const mockUseCache = vi.fn(
  <K extends UseCacheKey>(
    key: K,
    initValue?: InferUseCacheValue<K>
  ): [InferUseCacheValue<K>, (value: InferUseCacheValue<K>) => void] => {
    // Get current value
    let currentValue = mockMemoryCache.get(key)
    if (currentValue === undefined) {
      currentValue = initValue ?? getDefaultValue(key)
      if (currentValue !== undefined) {
        mockMemoryCache.set(key, currentValue)
      }
    }

    // Mock setValue function
    const setValue = vi.fn((value: InferUseCacheValue<K>) => {
      mockMemoryCache.set(key, value)
      notifyMemorySubscribers(key)
    })

    return [currentValue, setValue]
  }
)

/**
 * Mock useSharedCache hook (shared cache)
 */
export const mockUseSharedCache = vi.fn(
  <K extends SharedCacheKey>(
    key: K,
    initValue?: SharedCacheSchema[K]
  ): [SharedCacheSchema[K], (value: SharedCacheSchema[K]) => void] => {
    // Get current value
    let currentValue = mockSharedCache.get(key)
    if (currentValue === undefined) {
      currentValue = initValue ?? DefaultSharedCache[key]
      if (currentValue !== undefined) {
        mockSharedCache.set(key, currentValue)
      }
    }

    // Mock setValue function
    const setValue = vi.fn((value: SharedCacheSchema[K]) => {
      mockSharedCache.set(key, value)
      notifySharedSubscribers(key)
    })

    return [currentValue, setValue]
  }
)

/**
 * Mock usePersistCache hook (persistent cache)
 */
export const mockUsePersistCache = vi.fn(
  <K extends RendererPersistCacheKey>(
    key: K,
    initValue?: RendererPersistCacheSchema[K]
  ): [RendererPersistCacheSchema[K], (value: RendererPersistCacheSchema[K]) => void] => {
    // Get current value
    let currentValue = mockPersistCache.get(key)
    if (currentValue === undefined) {
      currentValue = initValue ?? DefaultRendererPersistCache[key]
      if (currentValue !== undefined) {
        mockPersistCache.set(key, currentValue)
      }
    }

    // Mock setValue function
    const setValue = vi.fn((value: RendererPersistCacheSchema[K]) => {
      mockPersistCache.set(key, value)
      notifyPersistSubscribers(key)
    })

    return [currentValue, setValue]
  }
)

/**
 * Export all mocks as a unified module
 */
export const MockUseCache = {
  useCache: mockUseCache,
  useSharedCache: mockUseSharedCache,
  usePersistCache: mockUsePersistCache
}

/**
 * Utility functions for testing
 */
export const MockUseCacheUtils = {
  /**
   * Reset all hook mock call counts and state
   */
  resetMocks: () => {
    mockUseCache.mockClear()
    mockUseSharedCache.mockClear()
    mockUsePersistCache.mockClear()

    // Reset caches to defaults
    mockMemoryCache.clear()
    mockSharedCache.clear()
    mockPersistCache.clear()

    Object.entries(DefaultUseCache).forEach(([key, value]) => {
      mockMemoryCache.set(key, value)
    })

    Object.entries(DefaultSharedCache).forEach(([key, value]) => {
      mockSharedCache.set(key as SharedCacheKey, value)
    })

    Object.entries(DefaultRendererPersistCache).forEach(([key, value]) => {
      mockPersistCache.set(key as RendererPersistCacheKey, value)
    })

    // Clear subscribers
    mockMemorySubscribers.clear()
    mockSharedSubscribers.clear()
    mockPersistSubscribers.clear()
  },

  /**
   * Set cache value for testing (memory cache)
   */
  setCacheValue: <K extends UseCacheKey>(key: K, value: InferUseCacheValue<K>) => {
    mockMemoryCache.set(key, value)
    notifyMemorySubscribers(key)
  },

  /**
   * Get cache value (memory cache)
   */
  getCacheValue: <K extends UseCacheKey>(key: K): InferUseCacheValue<K> | undefined => {
    return mockMemoryCache.get(key) ?? getDefaultValue(key)
  },

  /**
   * Set shared cache value for testing
   */
  setSharedCacheValue: <K extends SharedCacheKey>(key: K, value: SharedCacheSchema[K]) => {
    mockSharedCache.set(key, value)
    notifySharedSubscribers(key)
  },

  /**
   * Get shared cache value
   */
  getSharedCacheValue: <K extends SharedCacheKey>(key: K): SharedCacheSchema[K] => {
    return mockSharedCache.get(key) ?? DefaultSharedCache[key]
  },

  /**
   * Set persist cache value for testing
   */
  setPersistCacheValue: <K extends RendererPersistCacheKey>(key: K, value: RendererPersistCacheSchema[K]) => {
    mockPersistCache.set(key, value)
    notifyPersistSubscribers(key)
  },

  /**
   * Get persist cache value
   */
  getPersistCacheValue: <K extends RendererPersistCacheKey>(key: K): RendererPersistCacheSchema[K] => {
    return mockPersistCache.get(key) ?? DefaultRendererPersistCache[key]
  },

  /**
   * Set multiple cache values at once
   */
  setMultipleCacheValues: (values: {
    memory?: Array<[UseCacheKey, any]>
    shared?: Array<[SharedCacheKey, any]>
    persist?: Array<[RendererPersistCacheKey, any]>
  }) => {
    values.memory?.forEach(([key, value]) => {
      mockMemoryCache.set(key, value)
      notifyMemorySubscribers(key)
    })

    values.shared?.forEach(([key, value]) => {
      mockSharedCache.set(key, value)
      notifySharedSubscribers(key)
    })

    values.persist?.forEach(([key, value]) => {
      mockPersistCache.set(key, value)
      notifyPersistSubscribers(key)
    })
  },

  /**
   * Get all cache values
   */
  getAllCacheValues: () => ({
    memory: Object.fromEntries(mockMemoryCache.entries()),
    shared: Object.fromEntries(mockSharedCache.entries()),
    persist: Object.fromEntries(mockPersistCache.entries())
  }),

  /**
   * Simulate cache change from external source
   */
  simulateExternalCacheChange: <K extends UseCacheKey>(key: K, value: InferUseCacheValue<K>) => {
    mockMemoryCache.set(key, value)
    notifyMemorySubscribers(key)
  },

  /**
   * Mock cache hook to return specific value for a key
   */
  mockCacheReturn: <K extends UseCacheKey>(
    key: K,
    value: InferUseCacheValue<K>,
    setValue?: (value: InferUseCacheValue<K>) => void
  ) => {
    mockUseCache.mockImplementation((cacheKey, initValue) => {
      if (cacheKey === key) {
        return [value, setValue || vi.fn()] as any
      }

      // Default behavior for other keys
      const defaultValue = mockMemoryCache.get(cacheKey) ?? initValue ?? getDefaultValue(cacheKey)
      return [defaultValue, vi.fn()] as any
    })
  },

  /**
   * Mock shared cache hook to return specific value for a key
   */
  mockSharedCacheReturn: <K extends SharedCacheKey>(
    key: K,
    value: SharedCacheSchema[K],
    setValue?: (value: SharedCacheSchema[K]) => void
  ) => {
    mockUseSharedCache.mockImplementation((cacheKey, initValue) => {
      if (cacheKey === key) {
        return [value, setValue || vi.fn()]
      }

      // Default behavior for other keys
      const defaultValue = mockSharedCache.get(cacheKey) ?? initValue ?? DefaultSharedCache[cacheKey]
      return [defaultValue, vi.fn()]
    })
  },

  /**
   * Mock persist cache hook to return specific value for a key
   */
  mockPersistCacheReturn: <K extends RendererPersistCacheKey>(
    key: K,
    value: RendererPersistCacheSchema[K],
    setValue?: (value: RendererPersistCacheSchema[K]) => void
  ) => {
    mockUsePersistCache.mockImplementation((cacheKey, initValue) => {
      if (cacheKey === key) {
        return [value, setValue || vi.fn()]
      }

      // Default behavior for other keys
      const defaultValue = mockPersistCache.get(cacheKey) ?? initValue ?? DefaultRendererPersistCache[cacheKey]
      return [defaultValue, vi.fn()]
    })
  },

  /**
   * Add subscriber for cache changes (for testing subscription behavior)
   */
  addMemorySubscriber: (key: UseCacheKey, callback: () => void): (() => void) => {
    if (!mockMemorySubscribers.has(key)) {
      mockMemorySubscribers.set(key, new Set())
    }
    mockMemorySubscribers.get(key)!.add(callback)

    return () => {
      const subscribers = mockMemorySubscribers.get(key)
      if (subscribers) {
        subscribers.delete(callback)
        if (subscribers.size === 0) {
          mockMemorySubscribers.delete(key)
        }
      }
    }
  },

  /**
   * Add subscriber for shared cache changes
   */
  addSharedSubscriber: (key: SharedCacheKey, callback: () => void): (() => void) => {
    if (!mockSharedSubscribers.has(key)) {
      mockSharedSubscribers.set(key, new Set())
    }
    mockSharedSubscribers.get(key)!.add(callback)

    return () => {
      const subscribers = mockSharedSubscribers.get(key)
      if (subscribers) {
        subscribers.delete(callback)
        if (subscribers.size === 0) {
          mockSharedSubscribers.delete(key)
        }
      }
    }
  },

  /**
   * Add subscriber for persist cache changes
   */
  addPersistSubscriber: (key: RendererPersistCacheKey, callback: () => void): (() => void) => {
    if (!mockPersistSubscribers.has(key)) {
      mockPersistSubscribers.set(key, new Set())
    }
    mockPersistSubscribers.get(key)!.add(callback)

    return () => {
      const subscribers = mockPersistSubscribers.get(key)
      if (subscribers) {
        subscribers.delete(callback)
        if (subscribers.size === 0) {
          mockPersistSubscribers.delete(key)
        }
      }
    }
  },

  /**
   * Get subscriber counts for debugging
   */
  getSubscriberCounts: () => ({
    memory: Array.from(mockMemorySubscribers.entries()).map(([key, subs]) => [key, subs.size]),
    shared: Array.from(mockSharedSubscribers.entries()).map(([key, subs]) => [key, subs.size]),
    persist: Array.from(mockPersistSubscribers.entries()).map(([key, subs]) => [key, subs.size])
  })
}
