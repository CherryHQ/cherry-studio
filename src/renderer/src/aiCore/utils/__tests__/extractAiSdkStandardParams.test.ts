/**
 * extractAiSdkStandardParams Unit Tests
 * Tests for extracting AI SDK standard parameters from custom parameters
 */

import { describe, expect, it, vi } from 'vitest'

import { extractAiSdkStandardParams } from '../options'

// Mock logger to prevent errors
vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      debug: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      info: vi.fn()
    })
  }
}))

// Mock settings store
vi.mock('@renderer/store/settings', () => ({
  default: (state = { settings: {} }) => state
}))

// Mock hooks to prevent uuid errors
vi.mock('@renderer/hooks/useSettings', () => ({
  getStoreSetting: vi.fn(() => ({}))
}))

// Mock uuid to prevent errors
vi.mock('uuid', () => ({
  v4: vi.fn(() => 'test-uuid')
}))

// Mock AssistantService to prevent uuid errors
vi.mock('@renderer/services/AssistantService', () => ({
  getDefaultAssistant: vi.fn(() => ({
    id: 'test-assistant',
    name: 'Test Assistant',
    settings: {}
  })),
  getDefaultTopic: vi.fn(() => ({
    id: 'test-topic',
    assistantId: 'test-assistant',
    createdAt: new Date().toISOString()
  }))
}))

// Mock provider service
vi.mock('@renderer/services/ProviderService', () => ({
  getProviderById: vi.fn(() => ({
    id: 'test-provider',
    name: 'Test Provider'
  }))
}))

// Mock config modules
vi.mock('@renderer/config/models', () => ({
  isOpenAIModel: vi.fn(() => false),
  isQwenMTModel: vi.fn(() => false),
  isSupportFlexServiceTierModel: vi.fn(() => false),
  isSupportVerbosityModel: vi.fn(() => false),
  getModelSupportedVerbosity: vi.fn(() => [])
}))

vi.mock('@renderer/config/translate', () => ({
  mapLanguageToQwenMTModel: vi.fn()
}))

vi.mock('@renderer/utils/provider', () => ({
  isSupportServiceTierProvider: vi.fn(() => false),
  isSupportVerbosityProvider: vi.fn(() => false)
}))

describe('extractAiSdkStandardParams', () => {
  describe('Positive cases - Standard parameters extraction', () => {
    it('should extract all AI SDK standard parameters', () => {
      const customParams = {
        maxOutputTokens: 1000,
        temperature: 0.7,
        topP: 0.9,
        topK: 40,
        presencePenalty: 0.5,
        frequencyPenalty: 0.3,
        stopSequences: ['STOP', 'END'],
        seed: 42
      }

      const result = extractAiSdkStandardParams(customParams)

      expect(result.standardParams).toStrictEqual({
        maxOutputTokens: 1000,
        temperature: 0.7,
        topP: 0.9,
        topK: 40,
        presencePenalty: 0.5,
        frequencyPenalty: 0.3,
        stopSequences: ['STOP', 'END'],
        seed: 42
      })
      expect(result.providerParams).toStrictEqual({})
    })

    it('should extract single standard parameter', () => {
      const customParams = {
        temperature: 0.8
      }

      const result = extractAiSdkStandardParams(customParams)

      expect(result.standardParams).toStrictEqual({
        temperature: 0.8
      })
      expect(result.providerParams).toStrictEqual({})
    })

    it('should extract topK parameter', () => {
      const customParams = {
        topK: 50
      }

      const result = extractAiSdkStandardParams(customParams)

      expect(result.standardParams).toStrictEqual({
        topK: 50
      })
      expect(result.providerParams).toStrictEqual({})
    })

    it('should extract frequencyPenalty parameter', () => {
      const customParams = {
        frequencyPenalty: 0.6
      }

      const result = extractAiSdkStandardParams(customParams)

      expect(result.standardParams).toStrictEqual({
        frequencyPenalty: 0.6
      })
      expect(result.providerParams).toStrictEqual({})
    })

    it('should extract presencePenalty parameter', () => {
      const customParams = {
        presencePenalty: 0.4
      }

      const result = extractAiSdkStandardParams(customParams)

      expect(result.standardParams).toStrictEqual({
        presencePenalty: 0.4
      })
      expect(result.providerParams).toStrictEqual({})
    })

    it('should extract stopSequences parameter', () => {
      const customParams = {
        stopSequences: ['HALT', 'TERMINATE']
      }

      const result = extractAiSdkStandardParams(customParams)

      expect(result.standardParams).toStrictEqual({
        stopSequences: ['HALT', 'TERMINATE']
      })
      expect(result.providerParams).toStrictEqual({})
    })

    it('should extract seed parameter', () => {
      const customParams = {
        seed: 12345
      }

      const result = extractAiSdkStandardParams(customParams)

      expect(result.standardParams).toStrictEqual({
        seed: 12345
      })
      expect(result.providerParams).toStrictEqual({})
    })

    it('should extract maxOutputTokens parameter', () => {
      const customParams = {
        maxOutputTokens: 2048
      }

      const result = extractAiSdkStandardParams(customParams)

      expect(result.standardParams).toStrictEqual({
        maxOutputTokens: 2048
      })
      expect(result.providerParams).toStrictEqual({})
    })

    it('should extract topP parameter', () => {
      const customParams = {
        topP: 0.95
      }

      const result = extractAiSdkStandardParams(customParams)

      expect(result.standardParams).toStrictEqual({
        topP: 0.95
      })
      expect(result.providerParams).toStrictEqual({})
    })
  })

  describe('Negative cases - Provider-specific parameters', () => {
    it('should place all non-standard parameters in providerParams', () => {
      const customParams = {
        customParam: 'value',
        anotherParam: 123,
        thirdParam: true
      }

      const result = extractAiSdkStandardParams(customParams)

      expect(result.standardParams).toStrictEqual({})
      expect(result.providerParams).toStrictEqual({
        customParam: 'value',
        anotherParam: 123,
        thirdParam: true
      })
    })

    it('should place single provider-specific parameter in providerParams', () => {
      const customParams = {
        reasoningEffort: 'high'
      }

      const result = extractAiSdkStandardParams(customParams)

      expect(result.standardParams).toStrictEqual({})
      expect(result.providerParams).toStrictEqual({
        reasoningEffort: 'high'
      })
    })

    it('should place model-specific parameter in providerParams', () => {
      const customParams = {
        thinking: { type: 'enabled', budgetTokens: 5000 }
      }

      const result = extractAiSdkStandardParams(customParams)

      expect(result.standardParams).toStrictEqual({})
      expect(result.providerParams).toStrictEqual({
        thinking: { type: 'enabled', budgetTokens: 5000 }
      })
    })

    it('should place serviceTier in providerParams', () => {
      const customParams = {
        serviceTier: 'auto'
      }

      const result = extractAiSdkStandardParams(customParams)

      expect(result.standardParams).toStrictEqual({})
      expect(result.providerParams).toStrictEqual({
        serviceTier: 'auto'
      })
    })

    it('should place textVerbosity in providerParams', () => {
      const customParams = {
        textVerbosity: 'high'
      }

      const result = extractAiSdkStandardParams(customParams)

      expect(result.standardParams).toStrictEqual({})
      expect(result.providerParams).toStrictEqual({
        textVerbosity: 'high'
      })
    })
  })

  describe('Mixed parameters', () => {
    it('should correctly separate mixed standard and provider-specific parameters', () => {
      const customParams = {
        temperature: 0.7,
        topK: 40,
        customParam: 'custom_value',
        reasoningEffort: 'medium',
        frequencyPenalty: 0.5,
        seed: 999
      }

      const result = extractAiSdkStandardParams(customParams)

      expect(result.standardParams).toStrictEqual({
        temperature: 0.7,
        topK: 40,
        frequencyPenalty: 0.5,
        seed: 999
      })
      expect(result.providerParams).toStrictEqual({
        customParam: 'custom_value',
        reasoningEffort: 'medium'
      })
    })

    it('should handle complex mixed parameters with nested objects', () => {
      const customParams = {
        topP: 0.9,
        presencePenalty: 0.3,
        thinking: { type: 'enabled', budgetTokens: 5000 },
        stopSequences: ['STOP'],
        serviceTier: 'auto',
        maxOutputTokens: 4096
      }

      const result = extractAiSdkStandardParams(customParams)

      expect(result.standardParams).toStrictEqual({
        topP: 0.9,
        presencePenalty: 0.3,
        stopSequences: ['STOP'],
        maxOutputTokens: 4096
      })
      expect(result.providerParams).toStrictEqual({
        thinking: { type: 'enabled', budgetTokens: 5000 },
        serviceTier: 'auto'
      })
    })

    it('should handle all standard params with some provider params', () => {
      const customParams = {
        maxOutputTokens: 2000,
        temperature: 0.8,
        topP: 0.95,
        topK: 50,
        presencePenalty: 0.6,
        frequencyPenalty: 0.4,
        stopSequences: ['END', 'DONE'],
        seed: 777,
        customApiParam: 'value',
        anotherCustomParam: 123
      }

      const result = extractAiSdkStandardParams(customParams)

      expect(result.standardParams).toStrictEqual({
        maxOutputTokens: 2000,
        temperature: 0.8,
        topP: 0.95,
        topK: 50,
        presencePenalty: 0.6,
        frequencyPenalty: 0.4,
        stopSequences: ['END', 'DONE'],
        seed: 777
      })
      expect(result.providerParams).toStrictEqual({
        customApiParam: 'value',
        anotherCustomParam: 123
      })
    })
  })

  describe('Edge cases', () => {
    it('should handle empty object', () => {
      const customParams = {}

      const result = extractAiSdkStandardParams(customParams)

      expect(result.standardParams).toStrictEqual({})
      expect(result.providerParams).toStrictEqual({})
    })

    it('should handle zero values for numeric parameters', () => {
      const customParams = {
        temperature: 0,
        topK: 0,
        seed: 0
      }

      const result = extractAiSdkStandardParams(customParams)

      expect(result.standardParams).toStrictEqual({
        temperature: 0,
        topK: 0,
        seed: 0
      })
      expect(result.providerParams).toStrictEqual({})
    })

    it('should handle negative values for numeric parameters', () => {
      const customParams = {
        presencePenalty: -0.5,
        frequencyPenalty: -0.3,
        seed: -1
      }

      const result = extractAiSdkStandardParams(customParams)

      expect(result.standardParams).toStrictEqual({
        presencePenalty: -0.5,
        frequencyPenalty: -0.3,
        seed: -1
      })
      expect(result.providerParams).toStrictEqual({})
    })

    it('should handle empty arrays for stopSequences', () => {
      const customParams = {
        stopSequences: []
      }

      const result = extractAiSdkStandardParams(customParams)

      expect(result.standardParams).toStrictEqual({
        stopSequences: []
      })
      expect(result.providerParams).toStrictEqual({})
    })

    it('should handle null values in mixed parameters', () => {
      const customParams = {
        temperature: 0.7,
        customNull: null,
        topK: 40
      }

      const result = extractAiSdkStandardParams(customParams)

      expect(result.standardParams).toStrictEqual({
        temperature: 0.7,
        topK: 40
      })
      expect(result.providerParams).toStrictEqual({
        customNull: null
      })
    })

    it('should handle undefined values in mixed parameters', () => {
      const customParams = {
        temperature: 0.7,
        customUndefined: undefined,
        topK: 40
      }

      const result = extractAiSdkStandardParams(customParams)

      expect(result.standardParams).toStrictEqual({
        temperature: 0.7,
        topK: 40
      })
      expect(result.providerParams).toStrictEqual({
        customUndefined: undefined
      })
    })

    it('should handle boolean values for standard parameters', () => {
      const customParams = {
        temperature: 0.7,
        customBoolean: false,
        topK: 40
      }

      const result = extractAiSdkStandardParams(customParams)

      expect(result.standardParams).toStrictEqual({
        temperature: 0.7,
        topK: 40
      })
      expect(result.providerParams).toStrictEqual({
        customBoolean: false
      })
    })

    it('should handle very large numeric values', () => {
      const customParams = {
        maxOutputTokens: 999999,
        seed: 2147483647,
        topK: 10000
      }

      const result = extractAiSdkStandardParams(customParams)

      expect(result.standardParams).toStrictEqual({
        maxOutputTokens: 999999,
        seed: 2147483647,
        topK: 10000
      })
      expect(result.providerParams).toStrictEqual({})
    })

    it('should handle decimal values with high precision', () => {
      const customParams = {
        temperature: 0.123456789,
        topP: 0.987654321,
        presencePenalty: 0.111111111
      }

      const result = extractAiSdkStandardParams(customParams)

      expect(result.standardParams).toStrictEqual({
        temperature: 0.123456789,
        topP: 0.987654321,
        presencePenalty: 0.111111111
      })
      expect(result.providerParams).toStrictEqual({})
    })
  })

  describe('Case sensitivity', () => {
    it('should NOT extract parameters with incorrect case - uppercase first letter', () => {
      const customParams = {
        Temperature: 0.7,
        TopK: 40,
        FrequencyPenalty: 0.5
      }

      const result = extractAiSdkStandardParams(customParams)

      expect(result.standardParams).toStrictEqual({})
      expect(result.providerParams).toStrictEqual({
        Temperature: 0.7,
        TopK: 40,
        FrequencyPenalty: 0.5
      })
    })

    it('should NOT extract parameters with incorrect case - all uppercase', () => {
      const customParams = {
        TEMPERATURE: 0.7,
        TOPK: 40,
        SEED: 42
      }

      const result = extractAiSdkStandardParams(customParams)

      expect(result.standardParams).toStrictEqual({})
      expect(result.providerParams).toStrictEqual({
        TEMPERATURE: 0.7,
        TOPK: 40,
        SEED: 42
      })
    })

    it('should NOT extract parameters with incorrect case - all lowercase', () => {
      const customParams = {
        maxoutputtokens: 1000,
        frequencypenalty: 0.5,
        stopsequences: ['STOP']
      }

      const result = extractAiSdkStandardParams(customParams)

      expect(result.standardParams).toStrictEqual({})
      expect(result.providerParams).toStrictEqual({
        maxoutputtokens: 1000,
        frequencypenalty: 0.5,
        stopsequences: ['STOP']
      })
    })

    it('should correctly extract exact case match while rejecting incorrect case', () => {
      const customParams = {
        temperature: 0.7,
        Temperature: 0.8,
        TEMPERATURE: 0.9,
        topK: 40,
        TopK: 50
      }

      const result = extractAiSdkStandardParams(customParams)

      expect(result.standardParams).toStrictEqual({
        temperature: 0.7,
        topK: 40
      })
      expect(result.providerParams).toStrictEqual({
        Temperature: 0.8,
        TEMPERATURE: 0.9,
        TopK: 50
      })
    })
  })

  describe('Parameter name variations', () => {
    it('should NOT extract similar but incorrect parameter names', () => {
      const customParams = {
        temp: 0.7, // should not match temperature
        top_k: 40, // should not match topK
        max_tokens: 1000, // should not match maxOutputTokens
        freq_penalty: 0.5 // should not match frequencyPenalty
      }

      const result = extractAiSdkStandardParams(customParams)

      expect(result.standardParams).toStrictEqual({})
      expect(result.providerParams).toStrictEqual({
        temp: 0.7,
        top_k: 40,
        max_tokens: 1000,
        freq_penalty: 0.5
      })
    })

    it('should NOT extract snake_case versions of standard parameters', () => {
      const customParams = {
        top_k: 40,
        top_p: 0.9,
        presence_penalty: 0.5,
        frequency_penalty: 0.3,
        stop_sequences: ['STOP'],
        max_output_tokens: 1000
      }

      const result = extractAiSdkStandardParams(customParams)

      expect(result.standardParams).toStrictEqual({})
      expect(result.providerParams).toStrictEqual({
        top_k: 40,
        top_p: 0.9,
        presence_penalty: 0.5,
        frequency_penalty: 0.3,
        stop_sequences: ['STOP'],
        max_output_tokens: 1000
      })
    })

    it('should extract exact camelCase parameters only', () => {
      const customParams = {
        topK: 40, // correct
        top_k: 50, // incorrect
        topP: 0.9, // correct
        top_p: 0.8, // incorrect
        frequencyPenalty: 0.5, // correct
        frequency_penalty: 0.4 // incorrect
      }

      const result = extractAiSdkStandardParams(customParams)

      expect(result.standardParams).toStrictEqual({
        topK: 40,
        topP: 0.9,
        frequencyPenalty: 0.5
      })
      expect(result.providerParams).toStrictEqual({
        top_k: 50,
        top_p: 0.8,
        frequency_penalty: 0.4
      })
    })
  })
})
