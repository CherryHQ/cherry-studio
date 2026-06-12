import { CHERRYAI_DEFAULT_UNIQUE_MODEL_ID } from '@shared/data/presets/cherryai'
import { describe, expect, it } from 'vitest'

import { transformLlmModelIds } from '../LlmModelTransforms'

describe('LlmModelTransforms', () => {
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

    it('falls back setting model preferences to CherryAI when model objects are missing', () => {
      const result = transformLlmModelIds({})

      expect(result).toEqual({
        'chat.default_model_id': CHERRYAI_DEFAULT_UNIQUE_MODEL_ID,
        'topic.naming.model_id': CHERRYAI_DEFAULT_UNIQUE_MODEL_ID,
        'feature.quick_assistant.model_id': CHERRYAI_DEFAULT_UNIQUE_MODEL_ID,
        'feature.translate.model_id': CHERRYAI_DEFAULT_UNIQUE_MODEL_ID
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
      expect(result['topic.naming.model_id']).toBe(CHERRYAI_DEFAULT_UNIQUE_MODEL_ID)
      expect(result['feature.quick_assistant.model_id']).toBe(CHERRYAI_DEFAULT_UNIQUE_MODEL_ID)
      expect(result['feature.translate.model_id']).toBe(CHERRYAI_DEFAULT_UNIQUE_MODEL_ID)
    })

    it('handles model with incomplete data (missing provider)', () => {
      const sources = {
        defaultModel: { id: 'gpt-4' }, // no provider
        topicNamingModel: { provider: 'openai' } // no id
      }

      const result = transformLlmModelIds(sources)

      expect(result['chat.default_model_id']).toBe(CHERRYAI_DEFAULT_UNIQUE_MODEL_ID)
      expect(result['topic.naming.model_id']).toBe(CHERRYAI_DEFAULT_UNIQUE_MODEL_ID)
    })

    it('uses shared model conversion behavior for passthrough, trimming, and invalid providers', () => {
      const result = transformLlmModelIds({
        defaultModel: { id: ' openai::gpt-4 ', provider: 'openai' },
        topicNamingModel: { id: ' gpt-4o-mini ', provider: ' openai ' },
        quickModel: { id: 'gpt-4', provider: 'o::p' },
        translateModel: 'not-an-object'
      })

      expect(result).toEqual({
        'chat.default_model_id': 'openai::gpt-4',
        'topic.naming.model_id': 'openai::gpt-4o-mini',
        'feature.quick_assistant.model_id': CHERRYAI_DEFAULT_UNIQUE_MODEL_ID,
        'feature.translate.model_id': CHERRYAI_DEFAULT_UNIQUE_MODEL_ID
      })
    })

    it('maps legacy CherryAI model references to the seeded Qwen model', () => {
      const result = transformLlmModelIds({
        defaultModel: { id: 'old-default', provider: 'cherryai' },
        topicNamingModel: { id: 'old-topic', provider: 'cherryai' },
        quickModel: { id: 'old-quick', provider: 'cherryai' },
        translateModel: { id: 'old-translate', provider: 'cherryai' }
      })

      expect(result).toEqual({
        'chat.default_model_id': CHERRYAI_DEFAULT_UNIQUE_MODEL_ID,
        'topic.naming.model_id': CHERRYAI_DEFAULT_UNIQUE_MODEL_ID,
        'feature.quick_assistant.model_id': CHERRYAI_DEFAULT_UNIQUE_MODEL_ID,
        'feature.translate.model_id': CHERRYAI_DEFAULT_UNIQUE_MODEL_ID
      })
    })

    it('trims legacy CherryAI provider ids before remapping', () => {
      const result = transformLlmModelIds({
        defaultModel: { id: 'old-default', provider: ' cherryai ' },
        topicNamingModel: { id: 'old-topic', provider: '\tcherryai\n' }
      })

      expect(result['chat.default_model_id']).toBe(CHERRYAI_DEFAULT_UNIQUE_MODEL_ID)
      expect(result['topic.naming.model_id']).toBe(CHERRYAI_DEFAULT_UNIQUE_MODEL_ID)
    })
  })
})
