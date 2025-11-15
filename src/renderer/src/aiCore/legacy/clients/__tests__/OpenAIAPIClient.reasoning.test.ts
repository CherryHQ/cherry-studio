import type { Assistant, Model, Provider } from '@renderer/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { OpenAIAPIClient } from '../openai/OpenAIApiClient'

// Mock dependencies
vi.mock('@renderer/config/models', () => ({
  isSupportedReasoningEffortOpenAIModel: vi.fn((model: Model) => {
    const modelId = model.id.toLowerCase()
    return (
      modelId.includes('gpt-5') ||
      (modelId.includes('o1') && !modelId.includes('o1-preview') && !modelId.includes('o1-mini')) ||
      modelId.includes('o3') ||
      modelId.includes('o4')
    )
  }),
  isSupportedReasoningEffortGrokModel: vi.fn((model: Model) => {
    return model.id.toLowerCase().includes('grok')
  }),
  isSupportedReasoningEffortPerplexityModel: vi.fn((model: Model) => {
    return model.id.toLowerCase().includes('sonar-deep-research')
  }),
  isSupportedReasoningEffortModel: vi.fn((model: Model) => {
    const modelId = model.id.toLowerCase()
    return (
      modelId.includes('gpt-5') ||
      modelId.includes('o1') ||
      modelId.includes('o3') ||
      modelId.includes('o4') ||
      modelId.includes('grok') ||
      modelId.includes('sonar-deep-research')
    )
  }),
  isReasoningModel: vi.fn(() => true),
  isOpenAIDeepResearchModel: vi.fn(() => false),
  isSupportedThinkingTokenZhipuModel: vi.fn(() => false),
  isDeepSeekHybridInferenceModel: vi.fn(() => false),
  isSupportedThinkingTokenGeminiModel: vi.fn(() => false),
  isSupportedThinkingTokenQwenModel: vi.fn(() => false),
  isSupportedThinkingTokenHunyuanModel: vi.fn(() => false),
  isSupportedThinkingTokenClaudeModel: vi.fn(() => false),
  isSupportedThinkingTokenDoubaoModel: vi.fn(() => false),
  isQwenReasoningModel: vi.fn(() => false),
  isGrokReasoningModel: vi.fn(() => false),
  isOpenAIReasoningModel: vi.fn(() => false),
  isSupportedThinkingTokenModel: vi.fn(() => false),
  isQwenAlwaysThinkModel: vi.fn(() => false),
  isDoubaoThinkingAutoModel: vi.fn(() => false),
  getThinkModelType: vi.fn(() => 'default'),
  GEMINI_FLASH_MODEL_REGEX: /gemini.*flash/i,
  MODEL_SUPPORTED_REASONING_EFFORT: {
    default: ['low', 'medium', 'high'],
    grok: ['low', 'high'],
    perplexity: ['low', 'medium', 'high'],
    gpt5: ['minimal', 'low', 'medium', 'high']
  },
  findTokenLimit: vi.fn()
}))

vi.mock('@renderer/config/providers', () => ({
  isSupportEnableThinkingProvider: vi.fn(() => false)
}))

vi.mock('@renderer/hooks/useSettings', () => ({
  getStoreSetting: vi.fn(() => ({
    summaryText: 'off'
  }))
}))

vi.mock('@renderer/types', () => ({
  SystemProviderIds: {
    groq: 'groq',
    openrouter: 'openrouter',
    dashscope: 'dashscope',
    doubao: 'doubao',
    silicon: 'silicon',
    ppio: 'ppio',
    poe: 'poe'
  },
  EFFORT_RATIO: {
    minimal: 0.1,
    low: 0.3,
    medium: 0.5,
    high: 0.8,
    auto: 1
  }
}))

describe('OpenAIAPIClient - Reasoning Effort', () => {
  let client: OpenAIAPIClient
  let provider: Provider
  let assistant: Assistant
  
  beforeEach(() => {
    provider = {
      id: 'copilot',
      name: 'Github Copilot',
      type: 'openai',
      apiKey: 'test-key',
      apiHost: 'https://api.githubcopilot.com/',
      models: []
    }
    
    client = new OpenAIAPIClient(provider)
    
    assistant = {
      id: 'test-assistant',
      name: 'Test Assistant',
      emoji: '🤖',
      prompt: 'You are a helpful assistant',
      topics: [],
      messages: [],
      type: 'assistant',
      regularPhrases: [],
      settings: {
        reasoning_effort: 'medium'
      }
    }
  })

  describe('GPT-5 models through GitHub Copilot', () => {
    it('should return reasoning object format for gpt-5-mini', () => {
      const model: Model = {
        id: 'gpt-5-mini',
        name: 'GPT-5 Mini',
        provider: 'copilot',
        group: 'openai'
      }

      const result = client.getReasoningEffort(assistant, model)

      // Should use base class implementation which returns { reasoning: { effort, summary } }
      expect(result).toHaveProperty('reasoning')
      expect(result.reasoning).toHaveProperty('effort', 'medium')
      expect(result.reasoning).toHaveProperty('summary')
      expect(result).not.toHaveProperty('reasoning_effort')
    })

    it('should return reasoning object format for o1-2024-12-17', () => {
      const model: Model = {
        id: 'o1-2024-12-17',
        name: 'O1',
        provider: 'copilot',
        group: 'openai'
      }

      const result = client.getReasoningEffort(assistant, model)

      expect(result).toHaveProperty('reasoning')
      expect(result.reasoning).toHaveProperty('effort', 'medium')
      expect(result).not.toHaveProperty('reasoning_effort')
    })

    it('should return reasoning object format for o3-mini', () => {
      const model: Model = {
        id: 'o3-mini',
        name: 'O3 Mini',
        provider: 'copilot',
        group: 'openai'
      }

      const result = client.getReasoningEffort(assistant, model)

      expect(result).toHaveProperty('reasoning')
      expect(result.reasoning).toHaveProperty('effort', 'medium')
      expect(result).not.toHaveProperty('reasoning_effort')
    })
  })

  describe('Non-OpenAI reasoning models', () => {
    it('should return reasoning_effort format for Grok models', () => {
      const model: Model = {
        id: 'grok-3-mini',
        name: 'Grok 3 Mini',
        provider: 'grok',
        group: 'xai'
      }

      const result = client.getReasoningEffort(assistant, model)

      // Should use reasoning_effort for non-OpenAI models
      expect(result).toHaveProperty('reasoning_effort', 'medium')
      expect(result).not.toHaveProperty('reasoning')
    })

    it('should return reasoning_effort format for Perplexity models', () => {
      const model: Model = {
        id: 'sonar-deep-research',
        name: 'Sonar Deep Research',
        provider: 'perplexity',
        group: 'perplexity'
      }

      const result = client.getReasoningEffort(assistant, model)

      expect(result).toHaveProperty('reasoning_effort', 'medium')
      expect(result).not.toHaveProperty('reasoning')
    })
  })

  describe('When reasoning_effort is not set', () => {
    beforeEach(() => {
      assistant.settings = {}
    })

    it('should return empty object for GPT-5 models', () => {
      const model: Model = {
        id: 'gpt-5-mini',
        name: 'GPT-5 Mini',
        provider: 'copilot',
        group: 'openai'
      }

      const result = client.getReasoningEffort(assistant, model)

      expect(result).toEqual({})
    })
  })
})
