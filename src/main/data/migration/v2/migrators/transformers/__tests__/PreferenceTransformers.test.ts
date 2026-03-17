import { describe, expect, it } from 'vitest'

import {
  extractModelReferences,
  flattenCompressionConfig,
  getNestedValue,
  isNonEmptyString,
  isValidNumber,
  migrateWebSearchProviders
} from '../PreferenceTransformers'

describe('PreferenceTransformers', () => {
  describe('utility functions', () => {
    describe('getNestedValue', () => {
      it('should get nested value from object', () => {
        const obj = { a: { b: { c: 'value' } } }
        expect(getNestedValue(obj, 'a.b.c')).toBe('value')
      })

      it('should get top-level value', () => {
        const obj = { a: 'value' }
        expect(getNestedValue(obj, 'a')).toBe('value')
      })

      it('should return undefined for non-existent path', () => {
        const obj = { a: { b: 1 } }
        expect(getNestedValue(obj, 'a.b.c')).toBeUndefined()
      })

      it('should return undefined for null object', () => {
        expect(getNestedValue(null, 'a.b')).toBeUndefined()
      })

      it('should return undefined for undefined object', () => {
        expect(getNestedValue(undefined, 'a.b')).toBeUndefined()
      })

      it('should return undefined for non-object', () => {
        expect(getNestedValue('string', 'a')).toBeUndefined()
      })

      it('should return undefined when intermediate path is null', () => {
        const obj = { a: null }
        expect(getNestedValue(obj, 'a.b')).toBeUndefined()
      })

      it('should handle array access', () => {
        const obj = { a: [1, 2, 3] }
        expect(getNestedValue(obj, 'a.1')).toBe(2)
      })
    })

    describe('isValidNumber', () => {
      it('should return true for positive integers', () => {
        expect(isValidNumber(42)).toBe(true)
      })

      it('should return true for zero', () => {
        expect(isValidNumber(0)).toBe(true)
      })

      it('should return true for negative numbers', () => {
        expect(isValidNumber(-1)).toBe(true)
      })

      it('should return true for floating point numbers', () => {
        expect(isValidNumber(3.14)).toBe(true)
      })

      it('should return true for Infinity', () => {
        expect(isValidNumber(Infinity)).toBe(true)
      })

      it('should return true for negative Infinity', () => {
        expect(isValidNumber(-Infinity)).toBe(true)
      })

      it('should return false for NaN', () => {
        expect(isValidNumber(NaN)).toBe(false)
      })

      it('should return false for string numbers', () => {
        expect(isValidNumber('42')).toBe(false)
      })

      it('should return false for null', () => {
        expect(isValidNumber(null)).toBe(false)
      })

      it('should return false for undefined', () => {
        expect(isValidNumber(undefined)).toBe(false)
      })

      it('should return false for objects', () => {
        expect(isValidNumber({})).toBe(false)
      })
    })

    describe('isNonEmptyString', () => {
      it('should return true for non-empty strings', () => {
        expect(isNonEmptyString('hello')).toBe(true)
      })

      it('should return true for whitespace-only strings', () => {
        expect(isNonEmptyString(' ')).toBe(true)
      })

      it('should return true for strings with special characters', () => {
        expect(isNonEmptyString('!@#$%')).toBe(true)
      })

      it('should return false for empty string', () => {
        expect(isNonEmptyString('')).toBe(false)
      })

      it('should return false for null', () => {
        expect(isNonEmptyString(null)).toBe(false)
      })

      it('should return false for undefined', () => {
        expect(isNonEmptyString(undefined)).toBe(false)
      })

      it('should return false for numbers', () => {
        expect(isNonEmptyString(42)).toBe(false)
      })

      it('should return false for objects', () => {
        expect(isNonEmptyString({})).toBe(false)
      })

      it('should return false for arrays', () => {
        expect(isNonEmptyString(['a'])).toBe(false)
      })
    })
  })

  describe('extractModelReferences', () => {
    it('should extract UniqueModelId from full Model objects', () => {
      const result = extractModelReferences({
        defaultModel: { id: 'gpt-4o', provider: 'openai', name: 'GPT-4o', group: 'openai' },
        quickModel: { id: 'claude-3-haiku', provider: 'anthropic', name: 'Claude 3 Haiku', group: 'anthropic' },
        translateModel: { id: 'gpt-3.5-turbo', provider: 'openai', name: 'GPT-3.5', group: 'openai' }
      })

      expect(result['model.default_id']).toBe('openai::gpt-4o')
      expect(result['model.quick_id']).toBe('anthropic::claude-3-haiku')
      expect(result['model.translate_id']).toBe('openai::gpt-3.5-turbo')
    })

    it('should skip models with missing id', () => {
      const result = extractModelReferences({
        defaultModel: { provider: 'openai', name: 'no-id' }
      })

      expect(result['model.default_id']).toBeUndefined()
    })

    it('should skip models with missing provider', () => {
      const result = extractModelReferences({
        defaultModel: { id: 'gpt-4o', name: 'no-provider' }
      })

      expect(result['model.default_id']).toBeUndefined()
    })

    it('should return empty result when no models present', () => {
      const result = extractModelReferences({})
      expect(Object.keys(result)).toHaveLength(0)
    })

    it('should handle null/undefined model values', () => {
      const result = extractModelReferences({
        defaultModel: null,
        quickModel: undefined
      })

      expect(result['model.default_id']).toBeUndefined()
      expect(result['model.quick_id']).toBeUndefined()
    })

    it('should handle partial models (only some present)', () => {
      const result = extractModelReferences({
        defaultModel: { id: 'gpt-4o', provider: 'openai', name: 'GPT-4o', group: 'openai' }
      })

      expect(result['model.default_id']).toBe('openai::gpt-4o')
      expect(result['model.quick_id']).toBeUndefined()
      expect(result['model.translate_id']).toBeUndefined()
    })
  })

  describe('flattenCompressionConfig', () => {
    it('should return defaults when no config provided', () => {
      const result = flattenCompressionConfig({})
      expect(result['chat.web_search.compression.method']).toBe('none')
      expect(result['chat.web_search.compression.cutoff_limit']).toBeNull()
      expect(result['chat.web_search.compression.cutoff_unit']).toBe('char')
      expect(result['chat.web_search.compression.rag_document_count']).toBe(5)
      expect(result['chat.web_search.compression.rag_embedding_model_id']).toBeNull()
      expect(result['chat.web_search.compression.rag_embedding_dimensions']).toBeNull()
      expect(result['chat.web_search.compression.rag_rerank_model_id']).toBeNull()
    })

    it('should flatten compression config with all fields', () => {
      const result = flattenCompressionConfig({
        compressionConfig: {
          method: 'rag',
          cutoffLimit: 2000,
          cutoffUnit: 'token',
          documentCount: 10,
          embeddingModel: { id: 'embed-model', provider: 'openai' },
          embeddingDimensions: 1536,
          rerankModel: { id: 'rerank-model', provider: 'cohere' }
        }
      })

      expect(result['chat.web_search.compression.method']).toBe('rag')
      expect(result['chat.web_search.compression.cutoff_limit']).toBe(2000)
      expect(result['chat.web_search.compression.cutoff_unit']).toBe('token')
      expect(result['chat.web_search.compression.rag_document_count']).toBe(10)
      expect(result['chat.web_search.compression.rag_embedding_model_id']).toBe('openai::embed-model')
      expect(result['chat.web_search.compression.rag_embedding_dimensions']).toBe(1536)
      expect(result['chat.web_search.compression.rag_rerank_model_id']).toBe('cohere::rerank-model')
    })

    it('should handle partial config with defaults', () => {
      const result = flattenCompressionConfig({
        compressionConfig: {
          method: 'cutoff',
          cutoffLimit: 1000
        }
      })

      expect(result['chat.web_search.compression.method']).toBe('cutoff')
      expect(result['chat.web_search.compression.cutoff_limit']).toBe(1000)
      expect(result['chat.web_search.compression.cutoff_unit']).toBe('char')
      expect(result['chat.web_search.compression.rag_document_count']).toBe(5)
    })

    it('should fallback to default method when method is invalid', () => {
      const result = flattenCompressionConfig({
        compressionConfig: {
          method: 'invalid-method',
          cutoffUnit: 'token'
        }
      })

      expect(result['chat.web_search.compression.method']).toBe('none')
      expect(result['chat.web_search.compression.cutoff_unit']).toBe('token')
    })

    it('should fallback to default cutoff unit when unit is invalid', () => {
      const result = flattenCompressionConfig({
        compressionConfig: {
          method: 'rag',
          cutoffUnit: 'sentence'
        }
      })

      expect(result['chat.web_search.compression.method']).toBe('rag')
      expect(result['chat.web_search.compression.cutoff_unit']).toBe('char')
    })

    it('should handle null embeddingModel and rerankModel', () => {
      const result = flattenCompressionConfig({
        compressionConfig: {
          method: 'none',
          embeddingModel: null,
          rerankModel: null
        }
      })

      expect(result['chat.web_search.compression.rag_embedding_model_id']).toBeNull()
      expect(result['chat.web_search.compression.rag_rerank_model_id']).toBeNull()
    })
  })

  describe('migrateWebSearchProviders', () => {
    it('should return empty overrides when no providers', () => {
      const result = migrateWebSearchProviders({})
      expect(result['chat.web_search.provider_overrides']).toEqual({})
    })

    it('should keep only non-empty user fields', () => {
      const result = migrateWebSearchProviders({
        providers: [
          { id: 'tavily', name: 'Tavily', apiKey: ' key1 ', apiHost: 'https://api.tavily.com' },
          { id: 'local-google', name: 'Google' }
        ]
      })

      const overrides = result['chat.web_search.provider_overrides'] as Record<string, Record<string, unknown>>
      expect(overrides).toEqual({
        tavily: { apiKey: 'key1' }
      })
    })

    it('should map url to apiHost and preserve auth fields', () => {
      const result = migrateWebSearchProviders({
        providers: [
          {
            id: 'local-bing',
            name: 'Bing',
            url: 'https://www.bing.com/search?q=%s',
            engines: ['news'],
            basicAuthUsername: 'user',
            basicAuthPassword: 'pass'
          }
        ]
      })

      const overrides = result['chat.web_search.provider_overrides'] as Record<string, Record<string, unknown>>
      expect(overrides).toEqual({
        'local-bing': {
          apiHost: 'https://www.bing.com/search?q=%s',
          engines: ['news'],
          basicAuthUsername: 'user',
          basicAuthPassword: 'pass'
        }
      })
    })

    it('should omit apiHost when it matches preset default host', () => {
      const result = migrateWebSearchProviders({
        providers: [
          { id: 'exa-mcp', name: 'ExaMCP', apiHost: 'https://mcp.exa.ai/mcp' },
          { id: 'local-baidu', name: 'Baidu', url: 'https://www.baidu.com/s?wd=%s' }
        ]
      })

      const overrides = result['chat.web_search.provider_overrides'] as Record<string, Record<string, unknown>>
      expect(overrides).toEqual({})
    })

    it('should ignore providers without matching presets', () => {
      const result = migrateWebSearchProviders({
        providers: [
          { id: 'custom-provider', name: 'Custom', apiHost: 'https://custom.example.com/search' },
          { id: 'tavily', name: 'Tavily', apiKey: 'key1' }
        ]
      })

      const overrides = result['chat.web_search.provider_overrides'] as Record<string, Record<string, unknown>>
      expect(overrides).toEqual({
        tavily: { apiKey: 'key1' }
      })
    })
  })
})
