import { DefaultPreferences } from '@shared/data/preference/preferenceSchemas'
import type { UnifiedPreferenceKeyType, UnifiedPreferenceType } from '@shared/data/preference/preferenceTypes'
import { vi } from 'vitest'

/**
 * Mock PreferenceService for main process testing
 * Simulates the complete main process PreferenceService functionality
 */

// Mock preference state storage
const mockPreferenceState = new Map<UnifiedPreferenceKeyType, any>()

// Initialize with defaults
Object.entries(DefaultPreferences.default).forEach(([key, value]) => {
  mockPreferenceState.set(key as UnifiedPreferenceKeyType, value)
})

// Mock subscription tracking
const mockSubscriptions = new Map<number, Set<string>>() // windowId -> Set<keys>
const mockMainSubscribers = new Map<string, Set<(newValue: any, oldValue?: any) => void>>()

// Helper function to notify main process subscribers
const notifyMainSubscribers = (key: string, newValue: any, oldValue?: any) => {
  const subscribers = mockMainSubscribers.get(key)
  if (subscribers) {
    subscribers.forEach((callback) => {
      try {
        callback(newValue, oldValue)
      } catch (error) {
        console.warn('Mock PreferenceService: Main subscriber callback error:', error)
      }
    })
  }
}

/**
 * Mock PreferenceService class
 */
export class MockMainPreferenceService {
  private static instance: MockMainPreferenceService
  private _initialized = false // Used in initialize method

  private constructor() {}

  public static getInstance(): MockMainPreferenceService {
    if (!MockMainPreferenceService.instance) {
      MockMainPreferenceService.instance = new MockMainPreferenceService()
    }
    return MockMainPreferenceService.instance
  }

  // Mock initialization
  public initialize = vi.fn(async (): Promise<void> => {
    this._initialized = true
  })

  // Mock get method
  public get = vi.fn(<K extends UnifiedPreferenceKeyType>(key: K): UnifiedPreferenceType[K] => {
    return mockPreferenceState.get(key) as UnifiedPreferenceType[K]
  })

  // Mock set method
  public set = vi.fn(
    async <K extends UnifiedPreferenceKeyType>(key: K, value: UnifiedPreferenceType[K]): Promise<void> => {
      const oldValue = mockPreferenceState.get(key)
      mockPreferenceState.set(key, value)
      notifyMainSubscribers(key, value, oldValue)
    }
  )

  // Mock getMultiple method
  public getMultiple = vi.fn(<K extends UnifiedPreferenceKeyType>(keys: K[]) => {
    const result: any = {}
    keys.forEach((key) => {
      result[key] = mockPreferenceState.get(key)
    })
    return result
  })

  // Mock setMultiple method
  public setMultiple = vi.fn(async (updates: Partial<UnifiedPreferenceType>): Promise<void> => {
    Object.entries(updates).forEach(([key, value]) => {
      if (value !== undefined) {
        const oldValue = mockPreferenceState.get(key as UnifiedPreferenceKeyType)
        mockPreferenceState.set(key as UnifiedPreferenceKeyType, value)
        notifyMainSubscribers(key, value, oldValue)
      }
    })
  })

  // Mock subscription methods
  public subscribeForWindow = vi.fn((windowId: number, keys: string[]): void => {
    if (!mockSubscriptions.has(windowId)) {
      mockSubscriptions.set(windowId, new Set())
    }
    const windowKeys = mockSubscriptions.get(windowId)!
    keys.forEach((key) => windowKeys.add(key))
  })

  public unsubscribeForWindow = vi.fn((windowId: number): void => {
    mockSubscriptions.delete(windowId)
  })

  // Mock main process subscription methods
  public subscribeChange = vi.fn(
    <K extends UnifiedPreferenceKeyType>(
      key: K,
      callback: (newValue: UnifiedPreferenceType[K], oldValue?: UnifiedPreferenceType[K]) => void
    ): (() => void) => {
      if (!mockMainSubscribers.has(key)) {
        mockMainSubscribers.set(key, new Set())
      }
      mockMainSubscribers.get(key)!.add(callback)

      // Return unsubscribe function
      return () => {
        const subscribers = mockMainSubscribers.get(key)
        if (subscribers) {
          subscribers.delete(callback)
          if (subscribers.size === 0) {
            mockMainSubscribers.delete(key)
          }
        }
      }
    }
  )

  public subscribeMultipleChanges = vi.fn(
    (
      keys: UnifiedPreferenceKeyType[],
      callback: (key: UnifiedPreferenceKeyType, newValue: any, oldValue: any) => void
    ): (() => void) => {
      const unsubscribeFunctions = keys.map((key) =>
        this.subscribeChange(key, (newValue, oldValue) => callback(key, newValue, oldValue))
      )

      return () => {
        unsubscribeFunctions.forEach((unsubscribe) => unsubscribe())
      }
    }
  )

  // Mock utility methods
  public getAll = vi.fn((): UnifiedPreferenceType => {
    const result: any = {}
    for (const [key, defaultValue] of Object.entries(DefaultPreferences.default)) {
      result[key] = mockPreferenceState.get(key as UnifiedPreferenceKeyType) ?? defaultValue
    }
    return result
  })

  public getSubscriptions = vi.fn(() => new Map(mockSubscriptions))

  public removeAllChangeListeners = vi.fn((): void => {
    mockMainSubscribers.clear()
  })

  public getChangeListenerCount = vi.fn((): number => {
    let total = 0
    mockMainSubscribers.forEach((subscribers) => {
      total += subscribers.size
    })
    return total
  })

  public getKeyListenerCount = vi.fn((key: UnifiedPreferenceKeyType): number => {
    return mockMainSubscribers.get(key)?.size ?? 0
  })

  public getSubscribedKeys = vi.fn((): string[] => {
    return Array.from(mockMainSubscribers.keys())
  })

  public getSubscriptionStats = vi.fn((): Record<string, number> => {
    const stats: Record<string, number> = {}
    mockMainSubscribers.forEach((subscribers, key) => {
      stats[key] = subscribers.size
    })
    return stats
  })

  // Getter for testing purposes
  public get isInitialized() {
    return this._initialized
  }

  // Static methods
  public static registerIpcHandler = vi.fn((): void => {
    // Mock IPC handler registration
  })
}

// Mock singleton instance
const mockInstance = MockMainPreferenceService.getInstance()

/**
 * Export mock service
 */
export const MockMainPreferenceServiceExport = {
  PreferenceService: MockMainPreferenceService,
  preferenceService: mockInstance
}

/**
 * Utility functions for testing
 */
export const MockMainPreferenceServiceUtils = {
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

    // Reset state to defaults
    mockPreferenceState.clear()
    Object.entries(DefaultPreferences.default).forEach(([key, value]) => {
      mockPreferenceState.set(key as UnifiedPreferenceKeyType, value)
    })

    // Clear subscriptions
    mockSubscriptions.clear()
    mockMainSubscribers.clear()
  },

  /**
   * Set a preference value for testing
   */
  setPreferenceValue: <K extends UnifiedPreferenceKeyType>(key: K, value: UnifiedPreferenceType[K]) => {
    const oldValue = mockPreferenceState.get(key)
    mockPreferenceState.set(key, value)
    notifyMainSubscribers(key, value, oldValue)
  },

  /**
   * Get current preference value
   */
  getPreferenceValue: <K extends UnifiedPreferenceKeyType>(key: K): UnifiedPreferenceType[K] => {
    return mockPreferenceState.get(key) as UnifiedPreferenceType[K]
  },

  /**
   * Set multiple preference values for testing
   */
  setMultiplePreferenceValues: (values: Record<string, any>) => {
    Object.entries(values).forEach(([key, value]) => {
      const oldValue = mockPreferenceState.get(key as UnifiedPreferenceKeyType)
      mockPreferenceState.set(key as UnifiedPreferenceKeyType, value)
      notifyMainSubscribers(key, value, oldValue)
    })
  },

  /**
   * Get all current preference values
   */
  getAllPreferenceValues: (): Record<string, any> => {
    const result: Record<string, any> = {}
    mockPreferenceState.forEach((value, key) => {
      result[key] = value
    })
    return result
  },

  /**
   * Simulate window subscription
   */
  simulateWindowSubscription: (windowId: number, keys: string[]) => {
    mockInstance.subscribeForWindow(windowId, keys)
  },

  /**
   * Simulate external preference change
   */
  simulateExternalPreferenceChange: <K extends UnifiedPreferenceKeyType>(key: K, value: UnifiedPreferenceType[K]) => {
    const oldValue = mockPreferenceState.get(key)
    mockPreferenceState.set(key, value)
    notifyMainSubscribers(key, value, oldValue)
  },

  /**
   * Get subscription counts for debugging
   */
  getSubscriptionCounts: () => ({
    windows: Array.from(mockSubscriptions.entries()).map(([windowId, keys]) => [windowId, keys.size]),
    mainSubscribers: Array.from(mockMainSubscribers.entries()).map(([key, subs]) => [key, subs.size])
  })
}
