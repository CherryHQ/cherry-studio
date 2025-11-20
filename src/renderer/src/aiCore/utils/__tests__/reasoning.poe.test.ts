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
    it('should return reasoning_effort for GPT-5 model with low effort', () => {
      const model = createPoeModel('gpt-5')
      const assistant = createAssistant('low')
      const result = getReasoningEffort(assistant, model)
      
      expect(result).toEqual({
        reasoning_effort: 'low'
      })
    })

    it('should return reasoning_effort for GPT-5 model with medium effort', () => {
      const model = createPoeModel('gpt-5')
      const assistant = createAssistant('medium')
      const result = getReasoningEffort(assistant, model)
      
      expect(result).toEqual({
        reasoning_effort: 'medium'
      })
    })

    it('should return reasoning_effort for GPT-5 model with high effort', () => {
      const model = createPoeModel('gpt-5')
      const assistant = createAssistant('high')
      const result = getReasoningEffort(assistant, model)
      
      expect(result).toEqual({
        reasoning_effort: 'high'
      })
    })

    it('should convert auto to medium for GPT-5 model', () => {
      const model = createPoeModel('gpt-5')
      const assistant = createAssistant('auto')
      const result = getReasoningEffort(assistant, model)
      
      expect(result).toEqual({
        reasoning_effort: 'medium'
      })
    })

    it('should return reasoning_effort for GPT-5.1 model', () => {
      const model = createPoeModel('gpt-5.1')
      const assistant = createAssistant('medium')
      const result = getReasoningEffort(assistant, model)
      
      expect(result).toEqual({
        reasoning_effort: 'medium'
      })
    })
  })

  describe('Claude Models', () => {
    it('should return thinking config for Claude 3.7 Sonnet', () => {
      const model = createPoeModel('claude-3.7-sonnet')
      const assistant = createAssistant('medium', 4096)
      const result = getReasoningEffort(assistant, model)
      
      expect(result).toHaveProperty('thinking')
      expect(result.thinking).toHaveProperty('type', 'enabled')
      expect(result.thinking).toHaveProperty('budget_tokens')
      expect(typeof result.thinking.budget_tokens).toBe('number')
      expect(result.thinking.budget_tokens).toBeGreaterThan(0)
    })

    it('should return thinking config for Claude Sonnet 4', () => {
      const model = createPoeModel('claude-sonnet-4')
      const assistant = createAssistant('high', 8192)
      const result = getReasoningEffort(assistant, model)
      
      expect(result).toHaveProperty('thinking')
      expect(result.thinking).toHaveProperty('type', 'enabled')
      expect(result.thinking).toHaveProperty('budget_tokens')
      expect(typeof result.thinking.budget_tokens).toBe('number')
    })

    it('should calculate budget_tokens based on effort ratio and maxTokens', () => {
      const model = createPoeModel('claude-3.7-sonnet')
      const assistant = createAssistant('low', 4096)
      const result = getReasoningEffort(assistant, model)
      
      expect(result.thinking.budget_tokens).toBeGreaterThanOrEqual(1024)
    })
  })

  describe('Gemini Models', () => {
    it('should return thinking_config for Gemini 2.5 Flash', () => {
      const model = createPoeModel('gemini-2.5-flash')
      const assistant = createAssistant('medium')
      const result = getReasoningEffort(assistant, model)
      
      expect(result).toHaveProperty('extra_body')
      expect(result.extra_body).toHaveProperty('google')
      expect(result.extra_body.google).toHaveProperty('thinking_config')
      expect(result.extra_body.google.thinking_config).toHaveProperty('include_thoughts', true)
      expect(result.extra_body.google.thinking_config).toHaveProperty('thinking_budget')
    })

    it('should return thinking_config for Gemini 2.5 Pro', () => {
      const model = createPoeModel('gemini-2.5-pro')
      const assistant = createAssistant('high')
      const result = getReasoningEffort(assistant, model)
      
      expect(result).toHaveProperty('extra_body')
      expect(result.extra_body.google.thinking_config).toHaveProperty('include_thoughts', true)
    })

    it('should use -1 for auto effort', () => {
      const model = createPoeModel('gemini-2.5-flash')
      const assistant = createAssistant('auto')
      const result = getReasoningEffort(assistant, model)
      
      expect(result.extra_body.google.thinking_config.thinking_budget).toBe(-1)
    })

    it('should calculate thinking_budget for non-auto effort', () => {
      const model = createPoeModel('gemini-2.5-flash')
      const assistant = createAssistant('low')
      const result = getReasoningEffort(assistant, model)
      
      expect(typeof result.extra_body.google.thinking_config.thinking_budget).toBe('number')
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
