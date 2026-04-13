import { describe, expect, it } from 'vitest'

import { extractUniqueModelId, transformLlmModelIds } from '../LlmModelTransforms'

describe('LlmModelTransforms', () => {
  describe('extractUniqueModelId', () => {
    it('creates UniqueModelId from a valid Model object', () => {
      const model = { id: 'gpt-4', provider: 'openai', name: 'GPT-4' }
      expect(extractUniqueModelId(model)).toBe('openai::gpt-4')
    })

    it('handles model with extra fields', () => {
      const model = { id: 'claude-3-opus', provider: 'anthropic', name: 'Claude 3 Opus', group: 'Claude' }
      expect(extractUniqueModelId(model)).toBe('anthropic::claude-3-opus')
    })

    it('returns null for null input', () => {
      expect(extractUniqueModelId(null)).toBeNull()
    })

    it('returns null for undefined input', () => {
      expect(extractUniqueModelId(undefined)).toBeNull()
    })

    it('returns null for non-object input', () => {
      expect(extractUniqueModelId('string')).toBeNull()
      expect(extractUniqueModelId(123)).toBeNull()
    })

    it('returns null when provider is missing', () => {
      expect(extractUniqueModelId({ id: 'gpt-4' })).toBeNull()
    })

    it('returns null when id is missing', () => {
      expect(extractUniqueModelId({ provider: 'openai' })).toBeNull()
    })

    it('returns null when provider is empty string', () => {
      expect(extractUniqueModelId({ id: 'gpt-4', provider: '' })).toBeNull()
    })

    it('returns null when id is empty string', () => {
      expect(extractUniqueModelId({ id: '', provider: 'openai' })).toBeNull()
    })

    it('returns null for empty object', () => {
      expect(extractUniqueModelId({})).toBeNull()
    })
  })

  describe('transformLlmModelIds', () => {
    it('transforms all 4 model fields to UniqueModelIds', () => {
      const sources = {
        defaultModel: { id: 'gpt-4', provider: 'openai', name: 'GPT-4' },
        topicNamingModel: { id: 'gpt-3.5-turbo', provider: 'openai', name: 'GPT-3.5' },
        quickModel: { id: 'claude-3-haiku', provider: 'anthropic', name: 'Haiku' },
        translateModel: { id: 'qwen-max', provider: 'qwen', name: 'Qwen Max' }
      }

      const result = transformLlmModelIds(sources)

      expect(result).toEqual({
        'chat.default_model_id': 'openai::gpt-4',
        'topic.naming.model_id': 'openai::gpt-3.5-turbo',
        'feature.quick_assistant.model_id': 'anthropic::claude-3-haiku',
        'feature.translate.model_id': 'qwen::qwen-max'
      })
    })

    it('returns null for missing model objects', () => {
      const result = transformLlmModelIds({})

      expect(result).toEqual({
        'chat.default_model_id': null,
        'topic.naming.model_id': null,
        'feature.quick_assistant.model_id': null,
        'feature.translate.model_id': null
      })
    })

    it('handles mix of valid and missing models', () => {
      const sources = {
        defaultModel: { id: 'gpt-4', provider: 'openai' },
        topicNamingModel: null
        // quickModel and translateModel not present
      }

      const result = transformLlmModelIds(sources)

      expect(result['chat.default_model_id']).toBe('openai::gpt-4')
      expect(result['topic.naming.model_id']).toBeNull()
      expect(result['feature.quick_assistant.model_id']).toBeNull()
      expect(result['feature.translate.model_id']).toBeNull()
    })

    it('handles model with incomplete data (missing provider)', () => {
      const sources = {
        defaultModel: { id: 'gpt-4' }, // no provider
        topicNamingModel: { provider: 'openai' } // no id
      }

      const result = transformLlmModelIds(sources)

      expect(result['chat.default_model_id']).toBeNull()
      expect(result['topic.naming.model_id']).toBeNull()
    })
  })
})
