/**
 * reasoning.ts Unit Tests
 * Tests for reasoning parameter generation utilities
 */

import { getStoreSetting } from '@renderer/hooks/useSettings'
import type { SettingsState } from '@renderer/store/settings'
import type { Assistant, Model, Provider } from '@renderer/types'
import { SystemProviderIds } from '@renderer/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  getAnthropicReasoningParams,
  getBedrockReasoningParams,
  getCustomParameters,
  getGeminiReasoningParams,
  getOpenAIReasoningParams,
  getReasoningEffort,
  getXAIReasoningParams
} from '../reasoning'

function defaultGetStoreSetting<K extends keyof SettingsState>(key: K): SettingsState[K] {
  if (key === 'openAI') {
    return {
      summaryText: 'auto',
      verbosity: 'medium'
    } as SettingsState[K]
  }
  return undefined as SettingsState[K]
}

// Mock dependencies
vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      debug: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      info: vi.fn()
    })
  }
}))

vi.mock('@renderer/store/settings', () => ({
  default: (state = { settings: {} }) => state
}))

vi.mock('@renderer/store/llm', () => ({
  initialState: {},
  default: (state = { llm: {} }) => state
}))

vi.mock('@renderer/config/constant', () => ({
  DEFAULT_MAX_TOKENS: 4096,
  isMac: false,
  isWin: false,
  TOKENFLUX_HOST: 'mock-host'
}))

vi.mock('@renderer/utils/provider', () => ({
  isSupportEnableThinkingProvider: vi.fn((provider) => {
    return [SystemProviderIds.dashscope, SystemProviderIds.silicon].includes(provider.id)
  })
}))

vi.mock('@renderer/config/models', async (importOriginal) => {
  const actual: any = await importOriginal()
  return {
    ...actual,
    isReasoningModel: vi.fn(() => false),
    isOpenAIDeepResearchModel: vi.fn(() => false),
    isOpenAIModel: vi.fn(() => false),
    isSupportedReasoningEffortOpenAIModel: vi.fn(() => false),
    isSupportedThinkingTokenQwenModel: vi.fn(() => false),
    isQwenReasoningModel: vi.fn(() => false),
    isSupportedThinkingTokenClaudeModel: vi.fn(() => false),
    isSupportedThinkingTokenGeminiModel: vi.fn(() => false),
    isSupportedThinkingTokenDoubaoModel: vi.fn(() => false),
    isSupportedThinkingTokenZhipuModel: vi.fn(() => false),
    isSupportedReasoningEffortModel: vi.fn(() => false),
    isDeepSeekHybridInferenceModel: vi.fn(() => false),
    isSupportedReasoningEffortGrokModel: vi.fn(() => false),
    getThinkModelType: vi.fn(() => 'default'),
    isDoubaoSeedAfter251015: vi.fn(() => false),
    isDoubaoThinkingAutoModel: vi.fn(() => false),
    isGrok4FastReasoningModel: vi.fn(() => false),
    isGrokReasoningModel: vi.fn(() => false),
    isOpenAIReasoningModel: vi.fn(() => false),
    isQwenAlwaysThinkModel: vi.fn(() => false),
    isSupportedThinkingTokenHunyuanModel: vi.fn(() => false),
    isSupportedThinkingTokenModel: vi.fn(() => false),
    isGPT51SeriesModel: vi.fn(() => false)
  }
})

vi.mock('@renderer/hooks/useSettings', () => ({
  getStoreSetting: vi.fn(defaultGetStoreSetting)
}))

vi.mock('@renderer/services/AssistantService', () => ({
  getAssistantSettings: vi.fn((assistant) => ({
    maxTokens: assistant?.settings?.maxTokens || 4096,
    reasoning_effort: assistant?.settings?.reasoning_effort
  })),
  getProviderByModel: vi.fn((model) => ({
    id: model.provider,
    name: 'Test Provider'
  })),
  getDefaultAssistant: vi.fn(() => ({
    id: 'default',
    name: 'Default Assistant',
    settings: {}
  }))
}))

const ensureWindowApi = () => {
  const globalWindow = window as any
  globalWindow.api = globalWindow.api || {}
  globalWindow.api.getAppInfo = globalWindow.api.getAppInfo || vi.fn(async () => ({ notesPath: '' }))
}

ensureWindowApi()

describe('reasoning utils', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  describe('getReasoningEffort', () => {
    it('should return empty object for non-reasoning model', async () => {
      const model: Model = {
        id: 'gpt-4',
        name: 'GPT-4',
        provider: SystemProviderIds.openai
      } as Model

      const assistant: Assistant = {
        id: 'test',
        name: 'Test',
        settings: {}
      } as Assistant

      const result = getReasoningEffort(assistant, model)
      expect(result).toEqual({})
    })

    it('should not override reasoning for OpenRouter when reasoning effort undefined', async () => {
      const { isReasoningModel } = await import('@renderer/config/models')

      vi.mocked(isReasoningModel).mockReturnValue(true)

      const model: Model = {
        id: 'anthropic/claude-sonnet-4',
        name: 'Claude Sonnet 4',
        provider: SystemProviderIds.openrouter
      } as Model

      const assistant: Assistant = {
        id: 'test',
        name: 'Test',
        settings: {}
      } as Assistant

      const result = getReasoningEffort(assistant, model)
      expect(result).toEqual({})
    })

    it('should disable reasoning for OpenRouter when reasoning effort explicitly none', async () => {
      const { isReasoningModel } = await import('@renderer/config/models')

      vi.mocked(isReasoningModel).mockReturnValue(true)

      const model: Model = {
        id: 'anthropic/claude-sonnet-4',
        name: 'Claude Sonnet 4',
        provider: SystemProviderIds.openrouter
      } as Model

      const assistant: Assistant = {
        id: 'test',
        name: 'Test',
        settings: {
          reasoning_effort: 'none'
        }
      } as Assistant

      const result = getReasoningEffort(assistant, model)
      expect(result).toEqual({ reasoning: { enabled: false, exclude: true } })
    })

    it('should handle Qwen models with enable_thinking', async () => {
      const { isReasoningModel, isSupportedThinkingTokenQwenModel, isQwenReasoningModel } = await import(
        '@renderer/config/models'
      )

      vi.mocked(isReasoningModel).mockReturnValue(true)
      vi.mocked(isSupportedThinkingTokenQwenModel).mockReturnValue(true)
      vi.mocked(isQwenReasoningModel).mockReturnValue(true)

      const model: Model = {
        id: 'qwen-plus',
        name: 'Qwen Plus',
        provider: SystemProviderIds.dashscope
      } as Model

      const assistant: Assistant = {
        id: 'test',
        name: 'Test',
        settings: {
          reasoning_effort: 'medium'
        }
      } as Assistant

      const result = getReasoningEffort(assistant, model)
      expect(result).toHaveProperty('enable_thinking')
    })

    it('should handle Claude models with thinking config', async () => {
      const {
        isSupportedThinkingTokenClaudeModel,
        isReasoningModel,
        isQwenReasoningModel,
        isSupportedThinkingTokenGeminiModel,
        isSupportedThinkingTokenDoubaoModel,
        isSupportedThinkingTokenZhipuModel,
        isSupportedReasoningEffortModel
      } = await import('@renderer/config/models')

      vi.mocked(isReasoningModel).mockReturnValue(true)
      vi.mocked(isSupportedThinkingTokenClaudeModel).mockReturnValue(true)
      vi.mocked(isQwenReasoningModel).mockReturnValue(false)
      vi.mocked(isSupportedThinkingTokenGeminiModel).mockReturnValue(false)
      vi.mocked(isSupportedThinkingTokenDoubaoModel).mockReturnValue(false)
      vi.mocked(isSupportedThinkingTokenZhipuModel).mockReturnValue(false)
      vi.mocked(isSupportedReasoningEffortModel).mockReturnValue(false)

      const model: Model = {
        id: 'claude-3-7-sonnet',
        name: 'Claude 3.7 Sonnet',
        provider: SystemProviderIds.anthropic
      } as Model

      const assistant: Assistant = {
        id: 'test',
        name: 'Test',
        settings: {
          reasoning_effort: 'high',
          maxTokens: 4096
        }
      } as Assistant

      const result = getReasoningEffort(assistant, model)
      expect(result).toEqual({
        thinking: {
          type: 'enabled',
          budget_tokens: expect.any(Number)
        }
      })
    })

    it('should handle Gemini Flash models with thinking budget 0', async () => {
      const {
        isSupportedThinkingTokenGeminiModel,
        isReasoningModel,
        isQwenReasoningModel,
        isSupportedThinkingTokenClaudeModel,
        isSupportedThinkingTokenDoubaoModel,
        isSupportedThinkingTokenZhipuModel,
        isOpenAIDeepResearchModel,
        isSupportedThinkingTokenQwenModel,
        isSupportedThinkingTokenHunyuanModel,
        isDeepSeekHybridInferenceModel
      } = await import('@renderer/config/models')

      vi.mocked(isReasoningModel).mockReturnValue(true)
      vi.mocked(isOpenAIDeepResearchModel).mockReturnValue(false)
      vi.mocked(isSupportedThinkingTokenGeminiModel).mockReturnValue(true)
      vi.mocked(isQwenReasoningModel).mockReturnValue(false)
      vi.mocked(isSupportedThinkingTokenClaudeModel).mockReturnValue(false)
      vi.mocked(isSupportedThinkingTokenDoubaoModel).mockReturnValue(false)
      vi.mocked(isSupportedThinkingTokenZhipuModel).mockReturnValue(false)
      vi.mocked(isSupportedThinkingTokenQwenModel).mockReturnValue(false)
      vi.mocked(isSupportedThinkingTokenHunyuanModel).mockReturnValue(false)
      vi.mocked(isDeepSeekHybridInferenceModel).mockReturnValue(false)

      const model: Model = {
        id: 'gemini-2.5-flash',
        name: 'Gemini 2.5 Flash',
        provider: SystemProviderIds.openai
      } as Model

      const assistant: Assistant = {
        id: 'test',
        name: 'Test',
        settings: {
          reasoning_effort: 'none'
        }
      } as Assistant

      const result = getReasoningEffort(assistant, model)
      expect(result).toEqual({
        extra_body: {
          google: {
            thinking_config: {
              thinking_budget: 0
            }
          }
        }
      })
    })

    it('should handle GPT-5.1 reasoning model with effort levels', async () => {
      const {
        isReasoningModel,
        isOpenAIDeepResearchModel,
        isSupportedReasoningEffortModel,
        isGPT51SeriesModel,
        getThinkModelType
      } = await import('@renderer/config/models')

      vi.mocked(isReasoningModel).mockReturnValue(true)
      vi.mocked(isOpenAIDeepResearchModel).mockReturnValue(false)
      vi.mocked(isSupportedReasoningEffortModel).mockReturnValue(true)
      vi.mocked(getThinkModelType).mockReturnValue('gpt5_1')
      vi.mocked(isGPT51SeriesModel).mockReturnValue(true)

      const model: Model = {
        id: 'gpt-5.1',
        name: 'GPT-5.1',
        provider: SystemProviderIds.openai
      } as Model

      const assistant: Assistant = {
        id: 'test',
        name: 'Test',
        settings: {
          reasoning_effort: 'none'
        }
      } as Assistant

      const result = getReasoningEffort(assistant, model)
      expect(result).toEqual({
        reasoningEffort: 'none'
      })
    })

    it('should handle DeepSeek hybrid inference models', async () => {
      const { isReasoningModel, isDeepSeekHybridInferenceModel } = await import('@renderer/config/models')

      vi.mocked(isReasoningModel).mockReturnValue(true)
      vi.mocked(isDeepSeekHybridInferenceModel).mockReturnValue(true)

      const model: Model = {
        id: 'deepseek-v3.1',
        name: 'DeepSeek V3.1',
        provider: SystemProviderIds.silicon
      } as Model

      const assistant: Assistant = {
        id: 'test',
        name: 'Test',
        settings: {
          reasoning_effort: 'high'
        }
      } as Assistant

      const result = getReasoningEffort(assistant, model)
      expect(result).toEqual({
        enable_thinking: true
      })
    })

    it('should return medium effort for deep research models', async () => {
      const { isReasoningModel, isOpenAIDeepResearchModel } = await import('@renderer/config/models')

      vi.mocked(isReasoningModel).mockReturnValue(true)
      vi.mocked(isOpenAIDeepResearchModel).mockReturnValue(true)

      const model: Model = {
        id: 'o3-deep-research',
        provider: SystemProviderIds.openai
      } as Model

      const assistant: Assistant = {
        id: 'test',
        name: 'Test',
        settings: {}
      } as Assistant

      const result = getReasoningEffort(assistant, model)
      expect(result).toEqual({ reasoning_effort: 'medium' })
    })

    it('should return empty for groq provider', async () => {
      const { getProviderByModel } = await import('@renderer/services/AssistantService')

      vi.mocked(getProviderByModel).mockReturnValue({
        id: 'groq',
        name: 'Groq'
      } as Provider)

      const model: Model = {
        id: 'groq-model',
        name: 'Groq Model',
        provider: 'groq'
      } as Model

      const assistant: Assistant = {
        id: 'test',
        name: 'Test',
        settings: {}
      } as Assistant

      const result = getReasoningEffort(assistant, model)
      expect(result).toEqual({})
    })
  })

  describe('getOpenAIReasoningParams', () => {
    it('should return empty object for non-reasoning model', async () => {
      const model: Model = {
        id: 'gpt-4',
        name: 'GPT-4',
        provider: SystemProviderIds.openai
      } as Model

      const assistant: Assistant = {
        id: 'test',
        name: 'Test',
        settings: {}
      } as Assistant

      const result = getOpenAIReasoningParams(assistant, model)
      expect(result).toEqual({})
    })

    it('should return empty when no reasoning effort set', async () => {
      const model: Model = {
        id: 'o1-preview',
        name: 'O1 Preview',
        provider: SystemProviderIds.openai
      } as Model

      const assistant: Assistant = {
        id: 'test',
        name: 'Test',
        settings: {}
      } as Assistant

      const result = getOpenAIReasoningParams(assistant, model)
      expect(result).toEqual({})
    })

    it('should return reasoning effort for OpenAI models', async () => {
      const { isReasoningModel, isOpenAIModel, isSupportedReasoningEffortOpenAIModel } = await import(
        '@renderer/config/models'
      )

      vi.mocked(isReasoningModel).mockReturnValue(true)
      vi.mocked(isOpenAIModel).mockReturnValue(true)
      vi.mocked(isSupportedReasoningEffortOpenAIModel).mockReturnValue(true)

      const model: Model = {
        id: 'gpt-5.1',
        name: 'GPT 5.1',
        provider: SystemProviderIds.openai
      } as Model

      const assistant: Assistant = {
        id: 'test',
        name: 'Test',
        settings: {
          reasoning_effort: 'high'
        }
      } as Assistant

      const result = getOpenAIReasoningParams(assistant, model)
      expect(result).toEqual({
        reasoningEffort: 'high',
        reasoningSummary: 'auto'
      })
    })

    it('should include reasoning summary when not o1-pro', async () => {
      const { isReasoningModel, isOpenAIModel, isSupportedReasoningEffortOpenAIModel } = await import(
        '@renderer/config/models'
      )

      vi.mocked(isReasoningModel).mockReturnValue(true)
      vi.mocked(isOpenAIModel).mockReturnValue(true)
      vi.mocked(isSupportedReasoningEffortOpenAIModel).mockReturnValue(true)

      const model: Model = {
        id: 'gpt-5',
        provider: SystemProviderIds.openai
      } as Model

      const assistant: Assistant = {
        id: 'test',
        name: 'Test',
        settings: {
          reasoning_effort: 'medium'
        }
      } as Assistant

      const result = getOpenAIReasoningParams(assistant, model)
      expect(result).toEqual({
        reasoningEffort: 'medium',
        reasoningSummary: 'auto'
      })
    })

    it('should not include reasoning summary for o1-pro', async () => {
      const { isReasoningModel, isOpenAIDeepResearchModel, isSupportedReasoningEffortOpenAIModel } = await import(
        '@renderer/config/models'
      )

      vi.mocked(isReasoningModel).mockReturnValue(true)
      vi.mocked(isOpenAIDeepResearchModel).mockReturnValue(false)
      vi.mocked(isSupportedReasoningEffortOpenAIModel).mockReturnValue(true)
      vi.mocked(getStoreSetting).mockReturnValue({ summaryText: 'off' } as any)

      const model: Model = {
        id: 'o1-pro',
        name: 'O1 Pro',
        provider: SystemProviderIds.openai
      } as Model

      const assistant: Assistant = {
        id: 'test',
        name: 'Test',
        settings: {
          reasoning_effort: 'high'
        }
      } as Assistant

      const result = getOpenAIReasoningParams(assistant, model)
      expect(result).toEqual({
        reasoningEffort: 'high',
        reasoningSummary: undefined
      })
    })

    it('should force medium effort for deep research models', async () => {
      const { isReasoningModel, isOpenAIModel, isOpenAIDeepResearchModel, isSupportedReasoningEffortOpenAIModel } =
        await import('@renderer/config/models')
      const { getStoreSetting } = await import('@renderer/hooks/useSettings')

      vi.mocked(isReasoningModel).mockReturnValue(true)
      vi.mocked(isOpenAIModel).mockReturnValue(true)
      vi.mocked(isOpenAIDeepResearchModel).mockReturnValue(true)
      vi.mocked(isSupportedReasoningEffortOpenAIModel).mockReturnValue(true)
      vi.mocked(getStoreSetting).mockReturnValue({ summaryText: 'off' } as any)

      const model: Model = {
        id: 'o3-deep-research',
        name: 'O3 Mini',
        provider: SystemProviderIds.openai
      } as Model

      const assistant: Assistant = {
        id: 'test',
        name: 'Test',
        settings: {
          reasoning_effort: 'high'
        }
      } as Assistant

      const result = getOpenAIReasoningParams(assistant, model)
      expect(result).toEqual({
        reasoningEffort: 'medium',
        reasoningSummary: 'off'
      })
    })
  })

  describe('getAnthropicReasoningParams', () => {
    it('should return empty for non-reasoning model', async () => {
      const { isReasoningModel } = await import('@renderer/config/models')

      vi.mocked(isReasoningModel).mockReturnValue(false)

      const model: Model = {
        id: 'claude-3-5-sonnet',
        name: 'Claude 3.5 Sonnet',
        provider: SystemProviderIds.anthropic
      } as Model

      const assistant: Assistant = {
        id: 'test',
        name: 'Test',
        settings: {}
      } as Assistant

      const result = getAnthropicReasoningParams(assistant, model)
      expect(result).toEqual({})
    })

    it('should return disabled thinking when no reasoning effort', async () => {
      const { isReasoningModel, isSupportedThinkingTokenClaudeModel } = await import('@renderer/config/models')

      vi.mocked(isReasoningModel).mockReturnValue(true)
      vi.mocked(isSupportedThinkingTokenClaudeModel).mockReturnValue(false)

      const model: Model = {
        id: 'claude-3-7-sonnet',
        name: 'Claude 3.7 Sonnet',
        provider: SystemProviderIds.anthropic
      } as Model

      const assistant: Assistant = {
        id: 'test',
        name: 'Test',
        settings: {}
      } as Assistant

      const result = getAnthropicReasoningParams(assistant, model)
      expect(result).toEqual({
        thinking: {
          type: 'disabled'
        }
      })
    })

    it('should return enabled thinking with budget for Claude models', async () => {
      const { isReasoningModel, isSupportedThinkingTokenClaudeModel } = await import('@renderer/config/models')

      vi.mocked(isReasoningModel).mockReturnValue(true)
      vi.mocked(isSupportedThinkingTokenClaudeModel).mockReturnValue(true)

      const model: Model = {
        id: 'claude-3-7-sonnet',
        name: 'Claude 3.7 Sonnet',
        provider: SystemProviderIds.anthropic
      } as Model

      const assistant: Assistant = {
        id: 'test',
        name: 'Test',
        settings: {
          reasoning_effort: 'medium',
          maxTokens: 4096
        }
      } as Assistant

      const result = getAnthropicReasoningParams(assistant, model)
      expect(result).toEqual({
        thinking: {
          type: 'enabled',
          budgetTokens: 2048
        }
      })
    })
  })

  describe('getGeminiReasoningParams', () => {
    it('should return empty for non-reasoning model', async () => {
      const { isReasoningModel } = await import('@renderer/config/models')

      vi.mocked(isReasoningModel).mockReturnValue(false)

      const model: Model = {
        id: 'gemini-2.0-flash',
        name: 'Gemini 2.0 Flash',
        provider: SystemProviderIds.gemini
      } as Model

      const assistant: Assistant = {
        id: 'test',
        name: 'Test',
        settings: {}
      } as Assistant

      const result = getGeminiReasoningParams(assistant, model)
      expect(result).toEqual({})
    })

    it('should disable thinking for Flash models without reasoning effort', async () => {
      const { isReasoningModel, isSupportedThinkingTokenGeminiModel } = await import('@renderer/config/models')

      vi.mocked(isReasoningModel).mockReturnValue(true)
      vi.mocked(isSupportedThinkingTokenGeminiModel).mockReturnValue(true)

      const model: Model = {
        id: 'gemini-2.5-flash',
        name: 'Gemini 2.5 Flash',
        provider: SystemProviderIds.gemini
      } as Model

      const assistant: Assistant = {
        id: 'test',
        name: 'Test',
        settings: {}
      } as Assistant

      const result = getGeminiReasoningParams(assistant, model)
      expect(result).toEqual({
        thinkingConfig: {
          includeThoughts: false,
          thinkingBudget: 0
        }
      })
    })

    it('should enable thinking with budget for reasoning effort', async () => {
      const { isReasoningModel, isSupportedThinkingTokenGeminiModel } = await import('@renderer/config/models')

      vi.mocked(isReasoningModel).mockReturnValue(true)
      vi.mocked(isSupportedThinkingTokenGeminiModel).mockReturnValue(true)

      const model: Model = {
        id: 'gemini-2.5-pro',
        name: 'Gemini 2.5 Pro',
        provider: SystemProviderIds.gemini
      } as Model

      const assistant: Assistant = {
        id: 'test',
        name: 'Test',
        settings: {
          reasoning_effort: 'medium'
        }
      } as Assistant

      const result = getGeminiReasoningParams(assistant, model)
      expect(result).toEqual({
        thinkingConfig: {
          thinkingBudget: 16448,
          includeThoughts: true
        }
      })
    })

    it('should enable thinking without budget for auto effort ratio > 1', async () => {
      const { isReasoningModel, isSupportedThinkingTokenGeminiModel } = await import('@renderer/config/models')

      vi.mocked(isReasoningModel).mockReturnValue(true)
      vi.mocked(isSupportedThinkingTokenGeminiModel).mockReturnValue(true)

      const model: Model = {
        id: 'gemini-2.5-pro',
        name: 'Gemini 2.5 Pro',
        provider: SystemProviderIds.gemini
      } as Model

      const assistant: Assistant = {
        id: 'test',
        name: 'Test',
        settings: {
          reasoning_effort: 'auto'
        }
      } as Assistant

      const result = getGeminiReasoningParams(assistant, model)
      expect(result).toEqual({
        thinkingConfig: {
          includeThoughts: true
        }
      })
    })
  })

  describe('getXAIReasoningParams', () => {
    it('should return empty for non-Grok model', async () => {
      const { isSupportedReasoningEffortGrokModel } = await import('@renderer/config/models')

      vi.mocked(isSupportedReasoningEffortGrokModel).mockReturnValue(false)

      const model: Model = {
        id: 'other-model',
        name: 'Other Model',
        provider: SystemProviderIds.grok
      } as Model

      const assistant: Assistant = {
        id: 'test',
        name: 'Test',
        settings: {}
      } as Assistant

      const result = getXAIReasoningParams(assistant, model)
      expect(result).toEqual({})
    })

    it('should return empty when no reasoning effort', async () => {
      const { isSupportedReasoningEffortGrokModel } = await import('@renderer/config/models')

      vi.mocked(isSupportedReasoningEffortGrokModel).mockReturnValue(true)

      const model: Model = {
        id: 'grok-2',
        name: 'Grok 2',
        provider: SystemProviderIds.grok
      } as Model

      const assistant: Assistant = {
        id: 'test',
        name: 'Test',
        settings: {}
      } as Assistant

      const result = getXAIReasoningParams(assistant, model)
      expect(result).toEqual({})
    })

    it('should return reasoning effort for Grok models', async () => {
      const { isSupportedReasoningEffortGrokModel } = await import('@renderer/config/models')

      vi.mocked(isSupportedReasoningEffortGrokModel).mockReturnValue(true)

      const model: Model = {
        id: 'grok-3',
        name: 'Grok 3',
        provider: SystemProviderIds.grok
      } as Model

      const assistant: Assistant = {
        id: 'test',
        name: 'Test',
        settings: {
          reasoning_effort: 'high'
        }
      } as Assistant

      const result = getXAIReasoningParams(assistant, model)
      expect(result).toHaveProperty('reasoningEffort')
      expect(result.reasoningEffort).toBe('high')
    })
  })

  describe('getBedrockReasoningParams', () => {
    it('should return empty for non-reasoning model', async () => {
      const model: Model = {
        id: 'other-model',
        name: 'Other Model',
        provider: 'bedrock'
      } as Model

      const assistant: Assistant = {
        id: 'test',
        name: 'Test',
        settings: {}
      } as Assistant

      const result = getBedrockReasoningParams(assistant, model)
      expect(result).toEqual({})
    })

    it('should return empty when no reasoning effort', async () => {
      const model: Model = {
        id: 'claude-3-7-sonnet',
        name: 'Claude 3.7 Sonnet',
        provider: 'bedrock'
      } as Model

      const assistant: Assistant = {
        id: 'test',
        name: 'Test',
        settings: {}
      } as Assistant

      const result = getBedrockReasoningParams(assistant, model)
      expect(result).toEqual({})
    })

    it('should return reasoning config for Claude models on Bedrock', async () => {
      const { isReasoningModel, isSupportedThinkingTokenClaudeModel } = await import('@renderer/config/models')

      vi.mocked(isReasoningModel).mockReturnValue(true)
      vi.mocked(isSupportedThinkingTokenClaudeModel).mockReturnValue(true)

      const model: Model = {
        id: 'claude-3-7-sonnet',
        name: 'Claude 3.7 Sonnet',
        provider: 'bedrock'
      } as Model

      const assistant: Assistant = {
        id: 'test',
        name: 'Test',
        settings: {
          reasoning_effort: 'medium',
          maxTokens: 4096
        }
      } as Assistant

      const result = getBedrockReasoningParams(assistant, model)
      expect(result).toEqual({
        reasoningConfig: {
          type: 'enabled',
          budgetTokens: 2048
        }
      })
    })
  })

  describe('getCustomParameters', () => {
    it('should return empty object when no custom parameters', async () => {
      const assistant: Assistant = {
        id: 'test',
        name: 'Test',
        settings: {}
      } as Assistant

      const result = getCustomParameters(assistant)
      expect(result).toEqual({})
    })

    it('should return custom parameters as key-value pairs', async () => {
      const assistant: Assistant = {
        id: 'test',
        name: 'Test',
        settings: {
          customParameters: [
            { name: 'param1', value: 'value1', type: 'string' },
            { name: 'param2', value: 123, type: 'number' }
          ]
        }
      } as Assistant

      const result = getCustomParameters(assistant)
      expect(result).toEqual({
        param1: 'value1',
        param2: 123
      })
    })

    it('should parse JSON type parameters', async () => {
      const assistant: Assistant = {
        id: 'test',
        name: 'Test',
        settings: {
          customParameters: [{ name: 'config', value: '{"key": "value"}', type: 'json' }]
        }
      } as Assistant

      const result = getCustomParameters(assistant)
      expect(result).toEqual({
        config: { key: 'value' }
      })
    })

    it('should handle invalid JSON gracefully', async () => {
      const assistant: Assistant = {
        id: 'test',
        name: 'Test',
        settings: {
          customParameters: [{ name: 'invalid', value: '{invalid json', type: 'json' }]
        }
      } as Assistant

      const result = getCustomParameters(assistant)
      expect(result).toEqual({
        invalid: '{invalid json'
      })
    })

    it('should handle undefined JSON value', async () => {
      const assistant: Assistant = {
        id: 'test',
        name: 'Test',
        settings: {
          customParameters: [{ name: 'undef', value: 'undefined', type: 'json' }]
        }
      } as Assistant

      const result = getCustomParameters(assistant)
      expect(result).toEqual({
        undef: undefined
      })
    })

    it('should skip parameters with empty names', async () => {
      const assistant: Assistant = {
        id: 'test',
        name: 'Test',
        settings: {
          customParameters: [
            { name: '', value: 'value1', type: 'string' },
            { name: '  ', value: 'value2', type: 'string' },
            { name: 'valid', value: 'value3', type: 'string' }
          ]
        }
      } as Assistant

      const result = getCustomParameters(assistant)
      expect(result).toEqual({
        valid: 'value3'
      })
    })
  })
})
