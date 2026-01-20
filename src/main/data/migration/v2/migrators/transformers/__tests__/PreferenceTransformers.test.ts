import { describe, expect, it } from 'vitest'

import {
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

  describe('flattenCompressionConfig', () => {
    it('should return defaults when no config provided', () => {
      const result = flattenCompressionConfig({})
      expect(result['chat.websearch.compression.method']).toBe('none')
      expect(result['chat.websearch.compression.cutoff_limit']).toBeNull()
      expect(result['chat.websearch.compression.cutoff_unit']).toBe('char')
      expect(result['chat.websearch.compression.rag_document_count']).toBe(5)
      expect(result['chat.websearch.compression.rag_embedding_model_id']).toBeNull()
      expect(result['chat.websearch.compression.rag_embedding_provider_id']).toBeNull()
      expect(result['chat.websearch.compression.rag_embedding_dimensions']).toBeNull()
      expect(result['chat.websearch.compression.rag_rerank_model_id']).toBeNull()
      expect(result['chat.websearch.compression.rag_rerank_provider_id']).toBeNull()
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

      expect(result['chat.websearch.compression.method']).toBe('rag')
      expect(result['chat.websearch.compression.cutoff_limit']).toBe(2000)
      expect(result['chat.websearch.compression.cutoff_unit']).toBe('token')
      expect(result['chat.websearch.compression.rag_document_count']).toBe(10)
      expect(result['chat.websearch.compression.rag_embedding_model_id']).toBe('embed-model')
      expect(result['chat.websearch.compression.rag_embedding_provider_id']).toBe('openai')
      expect(result['chat.websearch.compression.rag_embedding_dimensions']).toBe(1536)
      expect(result['chat.websearch.compression.rag_rerank_model_id']).toBe('rerank-model')
      expect(result['chat.websearch.compression.rag_rerank_provider_id']).toBe('cohere')
    })

    it('should handle partial config with defaults', () => {
      const result = flattenCompressionConfig({
        compressionConfig: {
          method: 'cutoff',
          cutoffLimit: 1000
        }
      })

      expect(result['chat.websearch.compression.method']).toBe('cutoff')
      expect(result['chat.websearch.compression.cutoff_limit']).toBe(1000)
      expect(result['chat.websearch.compression.cutoff_unit']).toBe('char')
      expect(result['chat.websearch.compression.rag_document_count']).toBe(5)
    })

    it('should handle null embeddingModel and rerankModel', () => {
      const result = flattenCompressionConfig({
        compressionConfig: {
          method: 'none',
          embeddingModel: null,
          rerankModel: null
        }
      })

      expect(result['chat.websearch.compression.rag_embedding_model_id']).toBeNull()
      expect(result['chat.websearch.compression.rag_embedding_provider_id']).toBeNull()
      expect(result['chat.websearch.compression.rag_rerank_model_id']).toBeNull()
      expect(result['chat.websearch.compression.rag_rerank_provider_id']).toBeNull()
    })
  })

  describe('migrateWebSearchProviders', () => {
    it('should return empty array when no providers', () => {
      const result = migrateWebSearchProviders({})
      expect(result['chat.websearch.providers']).toEqual([])
    })

    it('should add type field based on id prefix', () => {
      const result = migrateWebSearchProviders({
        providers: [
          { id: 'tavily', name: 'Tavily', apiKey: 'key1', apiHost: 'https://api.tavily.com' },
          { id: 'local-google', name: 'Google' }
        ]
      })

      const providers = result['chat.websearch.providers'] as Array<{ id: string; type: string }>
      expect(providers[0].id).toBe('tavily')
      expect(providers[0].type).toBe('api')
      expect(providers[1].id).toBe('local-google')
      expect(providers[1].type).toBe('local')
    })

    it('should add missing fields with defaults', () => {
      const result = migrateWebSearchProviders({
        providers: [{ id: 'tavily', name: 'Tavily' }]
      })

      const providers = result['chat.websearch.providers'] as Array<Record<string, unknown>>
      expect(providers[0].apiKey).toBe('')
      expect(providers[0].apiHost).toBe('')
      expect(providers[0].engines).toEqual([])
      expect(providers[0].usingBrowser).toBe(false)
      expect(providers[0].basicAuthUsername).toBe('')
      expect(providers[0].basicAuthPassword).toBe('')
    })

    it('should preserve existing field values', () => {
      const result = migrateWebSearchProviders({
        providers: [
          {
            id: 'searxng',
            name: 'Searxng',
            apiHost: 'http://localhost:8080',
            basicAuthUsername: 'user',
            basicAuthPassword: 'pass'
          }
        ]
      })

      const providers = result['chat.websearch.providers'] as Array<Record<string, unknown>>
      expect(providers[0].apiHost).toBe('http://localhost:8080')
      expect(providers[0].basicAuthUsername).toBe('user')
      expect(providers[0].basicAuthPassword).toBe('pass')
    })
  })
})
