import type { Assistant, Model, ReasoningEffortOption } from '@renderer/types'
import { SystemProviderIds } from '@renderer/types'
import { describe, expect, it, vi } from 'vitest'

import { getReasoningEffort } from '../reasoning'

// Mock logger
vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      warn: vi.fn(),
      info: vi.fn(),
      error: vi.fn()
    })
  }
}))

vi.mock('@renderer/store/settings', () => ({
  default: {},
  settingsSlice: {
    name: 'settings',
    reducer: vi.fn(),
    actions: {}
  }
}))

vi.mock('@renderer/store/assistants', () => {
  const mockAssistantsSlice = {
    name: 'assistants',
    reducer: vi.fn((state = { entities: {}, ids: [] }) => state),
    actions: {
      updateTopicUpdatedAt: vi.fn(() => ({ type: 'UPDATE_TOPIC_UPDATED_AT' }))
    }
  }

  return {
    default: mockAssistantsSlice.reducer,
    updateTopicUpdatedAt: vi.fn(() => ({ type: 'UPDATE_TOPIC_UPDATED_AT' })),
    assistantsSlice: mockAssistantsSlice
  }
})

// Mock provider service
vi.mock('@renderer/services/AssistantService', () => ({
  getProviderByModel: (model: Model) => ({
    id: model.provider,
    name: 'Poe',
    type: 'openai'
  }),
  getAssistantSettings: (assistant: Assistant) => assistant.settings || {}
}))

describe('Poe Provider Reasoning Support', () => {
  const createPoeModel = (id: string): Model => ({
    id,
    name: id,
    provider: SystemProviderIds.poe,
    group: 'poe'
  })

  const createAssistant = (reasoning_effort?: ReasoningEffortOption, maxTokens?: number): Assistant => ({
    id: 'test-assistant',
    name: 'Test Assistant',
    emoji: '🤖',
    prompt: '',
    topics: [],
    messages: [],
    type: 'assistant',
    regularPhrases: [],
    settings: {
      reasoning_effort,
      maxTokens
    }
  })

  describe('No Reasoning Effort', () => {
    it('should return empty object when reasoning_effort is not set', () => {
      const model = createPoeModel('GPT-5.2')
      const assistant = createAssistant(undefined)
      const result = getReasoningEffort(assistant, model)

      expect(result).toEqual({})
    })

    it('should pass reasoningEffort "none" for GPT-5 models that support it', () => {
      const model = createPoeModel('GPT-5.2')
      const assistant = createAssistant('none')
      const result = getReasoningEffort(assistant, model)

      expect(result).toEqual({ reasoningEffort: 'none' })
    })
  })
})
