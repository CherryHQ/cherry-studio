import { vi } from 'vitest'

/**
 * Mock PreferenceService for testing
 * Provides common preference defaults used across the application
 */

// Default preference values used in tests
export const mockPreferenceDefaults: Record<string, any> = {
  // Export preferences
  'data.export.markdown.force_dollar_math': false,
  'data.export.markdown.exclude_citations': false,
  'data.export.markdown.standardize_citations': true,
  'data.export.markdown.show_model_name': false,
  'data.export.markdown.show_model_provider': false,

  // UI preferences
  'ui.language': 'zh-CN',
  'ui.theme': 'light',
  'ui.font_size': 14,

  // AI preferences
  'ai.default_model': 'gpt-4',
  'ai.temperature': 0.7,
  'ai.max_tokens': 2000,

  // Feature flags
  'feature.web_search': true,
  'feature.reasoning': false,
  'feature.tool_calling': true,

  // User preferences
  'user.name': 'MockUser',

  // App preferences
  'app.user.name': 'MockUser',
  'app.language': 'zh-CN'

  // Add more defaults as needed
}

/**
 * Mock implementation of PreferenceService
 */
export const createMockPreferenceService = (customDefaults: Record<string, any> = {}) => {
  const mergedDefaults = { ...mockPreferenceDefaults, ...customDefaults }

  return {
    get: vi.fn((key: string) => {
      const value = mergedDefaults[key]
      return Promise.resolve(value !== undefined ? value : null)
    }),

    getMultiple: vi.fn((keys: Record<string, string>) => {
      const result: Record<string, any> = {}
      Object.entries(keys).forEach(([alias, key]) => {
        const value = mergedDefaults[key]
        result[alias] = value !== undefined ? value : null
      })
      return Promise.resolve(result)
    }),

    set: vi.fn((key: string, value: any) => {
      mergedDefaults[key] = value
      return Promise.resolve()
    }),

    setMultiple: vi.fn((values: Record<string, any>) => {
      Object.assign(mergedDefaults, values)
      return Promise.resolve()
    }),

    delete: vi.fn((key: string) => {
      delete mergedDefaults[key]
      return Promise.resolve()
    }),

    clear: vi.fn(() => {
      Object.keys(mergedDefaults).forEach((key) => delete mergedDefaults[key])
      return Promise.resolve()
    }),

    // Internal state access for testing
    _getMockState: () => ({ ...mergedDefaults }),
    _resetMockState: () => {
      Object.keys(mergedDefaults).forEach((key) => delete mergedDefaults[key])
      Object.assign(mergedDefaults, mockPreferenceDefaults, customDefaults)
    }
  }
}

// Default mock instance
export const mockPreferenceService = createMockPreferenceService()

// Export for easy mocking in individual tests
export const MockPreferenceService = {
  preferenceService: mockPreferenceService
}
