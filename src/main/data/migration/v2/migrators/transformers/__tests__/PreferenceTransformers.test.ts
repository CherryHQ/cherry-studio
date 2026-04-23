import { describe, expect, it } from 'vitest'

import {
  flattenCompressionConfig,
  getNestedValue,
  isNonEmptyString,
  isValidNumber,
  migrateWebSearchProviders,
  normalizeWebSearchDefaultProvider
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

  describe('normalizeWebSearchDefaultProvider', () => {
    it('should keep supported provider ids', () => {
      const result = normalizeWebSearchDefaultProvider({ defaultProvider: 'tavily' })

      expect(result['chat.web_search.default_provider']).toBe('tavily')
    })

    it('should collapse removed local providers to null', () => {
      const result = normalizeWebSearchDefaultProvider({ defaultProvider: 'local-bing' })

      expect(result['chat.web_search.default_provider']).toBeNull()
    })

    it('should collapse empty and unknown providers to null', () => {
      expect(normalizeWebSearchDefaultProvider({ defaultProvider: '' })['chat.web_search.default_provider']).toBeNull()
      expect(
        normalizeWebSearchDefaultProvider({ defaultProvider: 'custom-provider' })['chat.web_search.default_provider']
      ).toBeNull()
      expect(normalizeWebSearchDefaultProvider({})['chat.web_search.default_provider']).toBeNull()
    })
  })

  describe('flattenCompressionConfig', () => {
    it('should return defaults when no config provided', () => {
      const result = flattenCompressionConfig({})
      expect(result['chat.web_search.compression.method']).toBe('none')
      expect(result['chat.web_search.compression.cutoff_limit']).toBe(2000)
      expect(result['chat.web_search.compression.cutoff_unit']).toBe('char')
    })

    it('should flatten compression config with all fields', () => {
      const result = flattenCompressionConfig({
        compressionConfig: {
          method: 'cutoff',
          cutoffLimit: 2000,
          cutoffUnit: 'token'
        }
      })

      expect(result['chat.web_search.compression.method']).toBe('cutoff')
      expect(result['chat.web_search.compression.cutoff_limit']).toBe(2000)
      expect(result['chat.web_search.compression.cutoff_unit']).toBe('token')
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
    })

    it('should fallback to default cutoff limit when cutoff config has no limit', () => {
      const result = flattenCompressionConfig({
        compressionConfig: {
          method: 'cutoff',
          cutoffLimit: null
        }
      })

      expect(result['chat.web_search.compression.method']).toBe('cutoff')
      expect(result['chat.web_search.compression.cutoff_limit']).toBe(2000)
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
          method: 'cutoff',
          cutoffUnit: 'sentence'
        }
      })

      expect(result['chat.web_search.compression.method']).toBe('cutoff')
      expect(result['chat.web_search.compression.cutoff_unit']).toBe('char')
    })

    it('should collapse removed rag method to none', () => {
      const result = flattenCompressionConfig({
        compressionConfig: {
          method: 'rag'
        }
      })

      expect(result['chat.web_search.compression.method']).toBe('none')
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
          { id: 'tavily', name: 'Tavily', apiKey: ' key1 , key2 ', apiHost: 'https://api.tavily.com' },
          { id: 'custom-provider', name: 'Custom', apiHost: 'https://custom.example.com/search' }
        ]
      })

      const overrides = result['chat.web_search.provider_overrides'] as Record<string, Record<string, unknown>>
      expect(overrides).toEqual({
        tavily: { apiKeys: ['key1', 'key2'] }
      })
    })

    it('should preserve custom auth fields for supported providers', () => {
      const result = migrateWebSearchProviders({
        providers: [
          {
            id: 'searxng',
            name: 'Searxng',
            apiHost: 'https://searx.example.com',
            engines: ['news'],
            basicAuthUsername: 'user',
            basicAuthPassword: 'pass'
          }
        ]
      })

      const overrides = result['chat.web_search.provider_overrides'] as Record<string, Record<string, unknown>>
      expect(overrides).toEqual({
        searxng: {
          apiHost: 'https://searx.example.com',
          engines: ['news'],
          basicAuthUsername: 'user',
          basicAuthPassword: 'pass'
        }
      })
    })

    it('should omit apiHost when it matches preset default host', () => {
      const result = migrateWebSearchProviders({
        providers: [{ id: 'exa-mcp', name: 'ExaMCP', apiHost: 'https://mcp.exa.ai/mcp' }]
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
        tavily: { apiKeys: ['key1'] }
      })
    })

    it('should omit empty api keys after splitting', () => {
      const result = migrateWebSearchProviders({
        providers: [{ id: 'tavily', name: 'Tavily', apiKey: ' ,  , ' }]
      })

      expect(result['chat.web_search.provider_overrides']).toEqual({})
    })
  })
})
