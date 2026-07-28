import type { PreferenceKeyType, PreferenceUpdateOptions } from '@shared/data/preference/preferenceTypes'
import { vi } from 'vitest'

import { mockPreferenceDefaults } from './PreferenceService'

/**
 * Mock usePreference hooks for testing
 * Provides comprehensive mocks for preference management hooks
 */

// Mock preference state storage
const mockPreferenceState = new Map<PreferenceKeyType, any>()

// Initialize with defaults
Object.entries(mockPreferenceDefaults).forEach(([key, value]) => {
  mockPreferenceState.set(key as PreferenceKeyType, value)
})

// Mock subscribers for preference changes
const mockPreferenceSubscribers = new Map<PreferenceKeyType, Set<() => void>>()

// Helper function to notify subscribers
const notifyPreferenceSubscribers = (key: PreferenceKeyType) => {
  const subscribers = mockPreferenceSubscribers.get(key)
  if (subscribers) {
    subscribers.forEach((callback) => {
      try {
        callback()
      } catch (error) {
        console.warn('Mock usePreference: Subscriber callback error:', error)
      }
    })
  }
}

/**
 * Mock usePreference hook
 */
export const mockUsePreference = vi.fn(
  <K extends PreferenceKeyType>(key: K, options?: PreferenceUpdateOptions): [any, (value: any) => Promise<void>] => {
    // Get current value
    const currentValue = mockPreferenceState.get(key) ?? mockPreferenceDefaults[key] ?? null

    // Mock setValue function
    const setValue = vi.fn(async (value: any) => {
      const oldValue = mockPreferenceState.get(key)

      // Simulate optimistic updates (default behavior)
      if (options?.optimistic !== false) {
        mockPreferenceState.set(key, value)
        notifyPreferenceSubscribers(key)
      }

      // Simulate async update delay
      await new Promise((resolve) => setTimeout(resolve, 10))

      // For pessimistic updates, update after delay
      if (options?.optimistic === false) {
        mockPreferenceState.set(key, value)
        notifyPreferenceSubscribers(key)
      }

      // Simulate error scenarios if configured
      if ((options as any)?.shouldError) {
        // Rollback optimistic update on error
        if (options?.optimistic !== false) {
          mockPreferenceState.set(key, oldValue)
          notifyPreferenceSubscribers(key)
        }
        throw new Error(`Mock preference error for key: ${key}`)
      }
    })

    return [currentValue, setValue]
  }
)

/**
 * Mock useMultiplePreferences hook
 */
export const mockUseMultiplePreferences = vi.fn(
  <T extends Record<string, PreferenceKeyType>>(
    keys: T,
    options?: PreferenceUpdateOptions
  ): [{ [K in keyof T]: any }, (values: Partial<{ [K in keyof T]: any }>) => Promise<void>] => {
    // Get current values for all keys
    const currentValues = {} as { [K in keyof T]: any }
    Object.entries(keys).forEach(([alias, key]) => {
      currentValues[alias as keyof T] =
        mockPreferenceState.get(key as PreferenceKeyType) ?? mockPreferenceDefaults[key as string] ?? null
    })

    // Mock setValues function
    const setValues = vi.fn(async (values: Partial<{ [K in keyof T]: any }>) => {
      const oldValues = { ...currentValues }

      // Simulate optimistic updates
      if (options?.optimistic !== false) {
        Object.entries(values).forEach(([alias, value]) => {
          const key = keys[alias as keyof T] as PreferenceKeyType
          if (value !== undefined) {
            mockPreferenceState.set(key, value)
            currentValues[alias as keyof T] = value as any
            notifyPreferenceSubscribers(key)
          }
        })
      }

      // Simulate async update delay
      await new Promise((resolve) => setTimeout(resolve, 10))

      // For pessimistic updates, update after delay
      if (options?.optimistic === false) {
        Object.entries(values).forEach(([alias, value]) => {
          const key = keys[alias as keyof T] as PreferenceKeyType
          if (value !== undefined) {
            mockPreferenceState.set(key, value)
            currentValues[alias as keyof T] = value as any
            notifyPreferenceSubscribers(key)
          }
        })
      }

      // Simulate error scenarios
      if ((options as any)?.shouldError) {
        // Rollback optimistic updates on error
        if (options?.optimistic !== false) {
          Object.entries(oldValues).forEach(([alias, value]) => {
            const key = keys[alias as keyof T] as PreferenceKeyType
            mockPreferenceState.set(key, value)
            currentValues[alias as keyof T] = value
            notifyPreferenceSubscribers(key)
          })
        }
        throw new Error('Mock multiple preferences error')
      }
    })

    return [currentValues, setValues]
  }
)

/**
 * Export all mocks as a unified module
 */
export const MockUsePreference = {
  usePreference: mockUsePreference,
  useMultiplePreferences: mockUseMultiplePreferences
}

/**
 * Utility functions for testing
 */
export const MockUsePreferenceUtils = {
  /**
   * Reset all hook mock call counts and state
   */
  resetMocks: () => {
    mockUsePreference.mockClear()
    mockUseMultiplePreferences.mockClear()

    // Reset state to defaults
    mockPreferenceState.clear()
    Object.entries(mockPreferenceDefaults).forEach(([key, value]) => {
      mockPreferenceState.set(key as PreferenceKeyType, value)
    })

    // Clear subscribers
    mockPreferenceSubscribers.clear()
  },

  /**
   * Set a preference value for testing
   */
  setPreferenceValue: <K extends PreferenceKeyType>(key: K, value: any) => {
    mockPreferenceState.set(key, value)
    notifyPreferenceSubscribers(key)
  },

  /**
   * Get current preference value
   */
  getPreferenceValue: <K extends PreferenceKeyType>(key: K): any => {
    return mockPreferenceState.get(key) ?? mockPreferenceDefaults[key] ?? null
  },

  /**
   * Set multiple preference values for testing
   */
  setMultiplePreferenceValues: (values: Record<string, any>) => {
    Object.entries(values).forEach(([key, value]) => {
      mockPreferenceState.set(key as PreferenceKeyType, value)
      notifyPreferenceSubscribers(key as PreferenceKeyType)
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
   * Simulate preference change from external source
   */
  simulateExternalPreferenceChange: <K extends PreferenceKeyType>(key: K, value: any) => {
    mockPreferenceState.set(key, value)
    notifyPreferenceSubscribers(key)
  },

  /**
   * Mock preference hook to return specific value for a key
   */
  mockPreferenceReturn: <K extends PreferenceKeyType>(key: K, value: any, setValue?: (value: any) => Promise<void>) => {
    mockUsePreference.mockImplementation((preferenceKey) => {
      if (preferenceKey === key) {
        return [value, setValue || vi.fn().mockResolvedValue(undefined)]
      }

      // Default behavior for other keys
      const defaultValue = mockPreferenceState.get(preferenceKey) ?? mockPreferenceDefaults[preferenceKey] ?? null
      return [defaultValue, vi.fn().mockResolvedValue(undefined)]
    })
  },

  /**
   * Mock preference hook to simulate error for a key
   */
  mockPreferenceError: <K extends PreferenceKeyType>(key: K, error: Error) => {
    mockUsePreference.mockImplementation((preferenceKey) => {
      if (preferenceKey === key) {
        const setValue = vi.fn().mockRejectedValue(error)
        const currentValue = mockPreferenceState.get(key) ?? mockPreferenceDefaults[key] ?? null
        return [currentValue, setValue]
      }

      // Default behavior for other keys
      const defaultValue = mockPreferenceState.get(preferenceKey) ?? mockPreferenceDefaults[preferenceKey] ?? null
      return [defaultValue, vi.fn().mockResolvedValue(undefined)]
    })
  },

  /**
   * Add subscriber for preference changes (for testing subscription behavior)
   */
  addSubscriber: (key: PreferenceKeyType, callback: () => void): (() => void) => {
    if (!mockPreferenceSubscribers.has(key)) {
      mockPreferenceSubscribers.set(key, new Set())
    }
    mockPreferenceSubscribers.get(key)!.add(callback)

    // Return unsubscribe function
    return () => {
      const subscribers = mockPreferenceSubscribers.get(key)
      if (subscribers) {
        subscribers.delete(callback)
        if (subscribers.size === 0) {
          mockPreferenceSubscribers.delete(key)
        }
      }
    }
  },

  /**
   * Get subscriber count for a preference key
   */
  getSubscriberCount: (key: PreferenceKeyType): number => {
    return mockPreferenceSubscribers.get(key)?.size ?? 0
  }
}
