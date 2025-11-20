import { describe, expect, it, vi } from 'vitest'

import { DEFAULT_MAX_TOKENS } from '@renderer/config/constant'
import type { Assistant, Model } from '@renderer/types'
import { SystemProviderIds } from '@renderer/types'

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

  const createAssistant = (reasoning_effort?: string, maxTokens?: number): Assistant => ({
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

  describe('GPT-5 Series Models', () => {
    it('should return reasoning_effort in extra_body for GPT-5 model with low effort', () => {
      const model = createPoeModel('gpt-5')
      const assistant = createAssistant('low')
      const result = getReasoningEffort(assistant, model)
      
      expect(result).toEqual({
        extra_body: {
          reasoning_effort: 'low'
        }
      })
    })

    it('should return reasoning_effort in extra_body for GPT-5 model with medium effort', () => {
      const model = createPoeModel('gpt-5')
      const assistant = createAssistant('medium')
      const result = getReasoningEffort(assistant, model)
      
      expect(result).toEqual({
        extra_body: {
          reasoning_effort: 'medium'
        }
      })
    })

    it('should return reasoning_effort in extra_body for GPT-5 model with high effort', () => {
      const model = createPoeModel('gpt-5')
      const assistant = createAssistant('high')
      const result = getReasoningEffort(assistant, model)
      
      expect(result).toEqual({
        extra_body: {
          reasoning_effort: 'high'
        }
      })
    })

    it('should convert auto to medium for GPT-5 model in extra_body', () => {
      const model = createPoeModel('gpt-5')
      const assistant = createAssistant('auto')
      const result = getReasoningEffort(assistant, model)
      
      expect(result).toEqual({
        extra_body: {
          reasoning_effort: 'medium'
        }
      })
    })

    it('should return reasoning_effort in extra_body for GPT-5.1 model', () => {
      const model = createPoeModel('gpt-5.1')
      const assistant = createAssistant('medium')
      const result = getReasoningEffort(assistant, model)
      
      expect(result).toEqual({
        extra_body: {
          reasoning_effort: 'medium'
        }
      })
    })
  })

  describe('Claude Models', () => {
    it('should return thinking_budget in extra_body for Claude 3.7 Sonnet', () => {
      const model = createPoeModel('claude-3.7-sonnet')
      const assistant = createAssistant('medium', 4096)
      const result = getReasoningEffort(assistant, model)
      
      expect(result).toHaveProperty('extra_body')
      expect(result.extra_body).toHaveProperty('thinking_budget')
      expect(typeof result.extra_body.thinking_budget).toBe('number')
      expect(result.extra_body.thinking_budget).toBeGreaterThan(0)
    })

    it('should return thinking_budget in extra_body for Claude Sonnet 4', () => {
      const model = createPoeModel('claude-sonnet-4')
      const assistant = createAssistant('high', 8192)
      const result = getReasoningEffort(assistant, model)
      
      expect(result).toHaveProperty('extra_body')
      expect(result.extra_body).toHaveProperty('thinking_budget')
      expect(typeof result.extra_body.thinking_budget).toBe('number')
    })

    it('should calculate thinking_budget based on effort ratio and maxTokens', () => {
      const model = createPoeModel('claude-3.7-sonnet')
      const assistant = createAssistant('low', 4096)
      const result = getReasoningEffort(assistant, model)
      
      expect(result.extra_body.thinking_budget).toBeGreaterThanOrEqual(1024)
    })
  })

  describe('Gemini Models', () => {
    it('should return thinking_budget in extra_body for Gemini 2.5 Flash', () => {
      const model = createPoeModel('gemini-2.5-flash')
      const assistant = createAssistant('medium')
      const result = getReasoningEffort(assistant, model)
      
      expect(result).toHaveProperty('extra_body')
      expect(result.extra_body).toHaveProperty('thinking_budget')
      expect(typeof result.extra_body.thinking_budget).toBe('number')
    })

    it('should return thinking_budget in extra_body for Gemini 2.5 Pro', () => {
      const model = createPoeModel('gemini-2.5-pro')
      const assistant = createAssistant('high')
      const result = getReasoningEffort(assistant, model)
      
      expect(result).toHaveProperty('extra_body')
      expect(result.extra_body).toHaveProperty('thinking_budget')
    })

    it('should use -1 for auto effort', () => {
      const model = createPoeModel('gemini-2.5-flash')
      const assistant = createAssistant('auto')
      const result = getReasoningEffort(assistant, model)
      
      expect(result.extra_body.thinking_budget).toBe(-1)
    })

    it('should calculate thinking_budget for non-auto effort', () => {
      const model = createPoeModel('gemini-2.5-flash')
      const assistant = createAssistant('low')
      const result = getReasoningEffort(assistant, model)
      
      expect(typeof result.extra_body.thinking_budget).toBe('number')
    })
  })

  describe('No Reasoning Effort', () => {
    it('should return empty object when reasoning_effort is not set', () => {
      const model = createPoeModel('gpt-5')
      const assistant = createAssistant(undefined)
      const result = getReasoningEffort(assistant, model)
      
      expect(result).toEqual({})
    })

    it('should return empty object when reasoning_effort is "none"', () => {
      const model = createPoeModel('gpt-5')
      const assistant = createAssistant('none')
      const result = getReasoningEffort(assistant, model)
      
      expect(result).toEqual({})
    })
  })

  describe('Non-Reasoning Models', () => {
    it('should return empty object for non-reasoning models', () => {
      const model = createPoeModel('gpt-4')
      const assistant = createAssistant('medium')
      const result = getReasoningEffort(assistant, model)
      
      expect(result).toEqual({})
    })
  })
})
