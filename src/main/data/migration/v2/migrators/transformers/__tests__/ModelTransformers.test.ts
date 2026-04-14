import { describe, expect, it } from 'vitest'

import { legacyModelToUniqueId } from '../ModelTransformers'

describe('legacyModelToUniqueId', () => {
  describe('happy path', () => {
    it('should convert valid model to UniqueModelId', () => {
      expect(legacyModelToUniqueId({ id: 'gpt-4', provider: 'openai' })).toBe('openai::gpt-4')
    })

    it('should work with model objects that have extra fields', () => {
      const model = { id: 'gpt-4', provider: 'openai', name: 'GPT-4', group: 'chat' }
      expect(legacyModelToUniqueId(model as { id: string; provider: string })).toBe('openai::gpt-4')
    })
  })

  describe('null/undefined/missing input', () => {
    it('should return null for null model', () => {
      expect(legacyModelToUniqueId(null)).toBeNull()
    })

    it('should return null for undefined model', () => {
      expect(legacyModelToUniqueId(undefined)).toBeNull()
    })

    it('should return null for model missing provider', () => {
      expect(legacyModelToUniqueId({ id: 'gpt-4' })).toBeNull()
    })

    it('should return null for model missing id', () => {
      expect(legacyModelToUniqueId({ provider: 'openai' })).toBeNull()
    })

    it('should return null for model with both missing', () => {
      expect(legacyModelToUniqueId({})).toBeNull()
    })
  })

  describe('empty and whitespace strings', () => {
    it('should return null for empty provider', () => {
      expect(legacyModelToUniqueId({ id: 'gpt-4', provider: '' })).toBeNull()
    })

    it('should return null for empty id', () => {
      expect(legacyModelToUniqueId({ id: '', provider: 'openai' })).toBeNull()
    })

    it('should return null for whitespace-only provider', () => {
      expect(legacyModelToUniqueId({ id: 'gpt-4', provider: '  ' })).toBeNull()
    })

    it('should return null for whitespace-only id', () => {
      expect(legacyModelToUniqueId({ id: '  ', provider: 'openai' })).toBeNull()
    })

    it('should trim whitespace from valid values', () => {
      expect(legacyModelToUniqueId({ id: ' gpt-4 ', provider: ' openai ' })).toBe('openai::gpt-4')
    })
  })

  describe('non-string field values', () => {
    it('should return null when provider is a number', () => {
      expect(legacyModelToUniqueId({ id: 'gpt-4', provider: 123 as unknown as string })).toBeNull()
    })

    it('should return null when id is a boolean', () => {
      expect(legacyModelToUniqueId({ id: true as unknown as string, provider: 'openai' })).toBeNull()
    })

    it('should return null when id is an object', () => {
      expect(legacyModelToUniqueId({ id: {} as unknown as string, provider: 'openai' })).toBeNull()
    })
  })

  describe('pre-composed ID passthrough', () => {
    it('should return pre-composed id directly without double-prefixing', () => {
      expect(legacyModelToUniqueId({ id: 'openai::gpt-4', provider: 'openai' })).toBe('openai::gpt-4')
    })

    it('should handle pre-composed id with different provider', () => {
      expect(legacyModelToUniqueId({ id: 'azure::gpt-4', provider: 'openai' })).toBe('azure::gpt-4')
    })
  })

  describe('fallback parameter', () => {
    it('should use fallback when model is null', () => {
      expect(legacyModelToUniqueId(null, 'raw-model-id')).toBe('raw-model-id')
    })

    it('should use fallback when model is undefined', () => {
      expect(legacyModelToUniqueId(undefined, 'raw-model-id')).toBe('raw-model-id')
    })

    it('should use fallback when model has missing fields', () => {
      expect(legacyModelToUniqueId({ id: 'gpt-4' }, 'raw-model-id')).toBe('raw-model-id')
    })

    it('should ignore fallback when model is valid', () => {
      expect(legacyModelToUniqueId({ id: 'gpt-4', provider: 'openai' }, 'raw-model-id')).toBe('openai::gpt-4')
    })

    it('should return null for empty fallback', () => {
      expect(legacyModelToUniqueId(null, '')).toBeNull()
    })

    it('should return null for null fallback', () => {
      expect(legacyModelToUniqueId(null, null)).toBeNull()
    })

    it('should return null when no fallback provided', () => {
      expect(legacyModelToUniqueId(null)).toBeNull()
    })
  })
})
