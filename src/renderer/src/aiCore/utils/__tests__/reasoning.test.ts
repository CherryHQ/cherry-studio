/**
 * reasoning.ts Unit Tests
 * Tests for reasoning parameter generation utilities
 */

import { getStoreSetting } from '@renderer/hooks/useSettings'
import type { SettingsState } from '@renderer/store/settings'
import type { Assistant, Model, Provider } from '@renderer/types'
import { SystemProviderIds } from '@renderer/types'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  getAnthropicReasoningParams,
  getBedrockReasoningParams,
  getCustomParameters,
  getGeminiReasoningParams,
  getOpenAIReasoningParams,
  getReasoningEffort,
  getThinkingBudget,
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
  TOKENFLUX_HOST: 'mock-host',
  ARTIFACT_EXT:
    '\\.(md|html?|txt|json|csv|pdf|xml|ya?ml|toml|ini|cfg|conf|log|svg|png|jpe?g|gif|bmp|ico|css|jsx?|tsx?|py|rb|go|rs|java|sql|sh|bat|ps1|pptx?|xlsx?|docx?)'
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
    isSupportedThinkingTokenMiMoModel: vi.fn(() => false),
    isSupportedReasoningEffortModel: vi.fn(() => false),
    isDeepSeekHybridInferenceModel: vi.fn(() => false),
    isDeepSeekV4PlusModel: vi.fn(() => false),
    isSupportedReasoningEffortGrokModel: vi.fn(() => false),
    getThinkModelType: vi.fn(() => 'default'),
    isDoubaoSeedAfter251015: vi.fn(() => false),
    isDoubaoThinkingAutoModel: vi.fn(() => false),
    isGrok4FastReasoningModel: vi.fn(() => false),
    isGrokReasoningModel: vi.fn(() => false),
    isOpenAIReasoningModel: vi.fn(() => false),
    isQwenAlwaysThinkModel: vi.fn(() => false),
    isHostedGemma4ThinkingModel: vi.fn(() => false),
    isSupportedThinkingTokenHunyuanModel: vi.fn(() => false),
    isSupportedThinkingTokenModel: vi.fn(() => false),
    isGPT51SeriesModel: vi.fn(() => false),
    isGemini3ThinkingTokenModel: vi.fn(() => false),
    findTokenLimit: vi.fn(actual.findTokenLimit)
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

    it('should disable thinking for MiMo models when reasoning effort is none', async () => {
      const { isReasoningModel, isSupportedThinkingTokenMiMoModel } = await import('@renderer/config/models')

      vi.mocked(isReasoningModel).mockReturnValue(true)
      vi.mocked(isSupportedThinkingTokenMiMoModel).mockReturnValue(true)

      const model: Model = {
        id: 'mimo-v2-pro',
        name: 'MiMo V2 Pro',
        provider: SystemProviderIds.mimo
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
        thinking: {
          type: 'disabled'
        }
      })
    })

    it('should enable thinking for MiMo models when reasoning effort is auto', async () => {
      const { isReasoningModel, isSupportedThinkingTokenMiMoModel } = await import('@renderer/config/models')

      vi.mocked(isReasoningModel).mockReturnValue(true)
      vi.mocked(isSupportedThinkingTokenMiMoModel).mockReturnValue(true)

      const model: Model = {
        id: 'mimo-v2-pro',
        name: 'MiMo V2 Pro',
        provider: SystemProviderIds.mimo
      } as Model

      const assistant: Assistant = {
        id: 'test',
        name: 'Test',
        settings: {
          reasoning_effort: 'auto'
        }
      } as Assistant

      const result = getReasoningEffort(assistant, model)
      expect(result).toEqual({
        thinking: {
          type: 'enabled'
        }
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

    it('should use enable_thinking:false for SiliconFlow + DeepSeek-V4-Flash when reasoning_effort is none', async () => {
      const { isReasoningModel, isDeepSeekHybridInferenceModel } = await import('@renderer/config/models')

      vi.mocked(isReasoningModel).mockReturnValue(true)
      vi.mocked(isDeepSeekHybridInferenceModel).mockReturnValue(true)

      const model: Model = {
        id: 'deepseek-ai/DeepSeek-V4-Flash',
        name: 'DeepSeek V4 Flash',
        provider: SystemProviderIds.silicon
      } as Model

      const assistant: Assistant = {
        id: 'test',
        name: 'Test',
        settings: {
          reasoning_effort: 'none'
        }
      } as Assistant

      const result = getReasoningEffort(assistant, model)
      expect(result).toEqual({ enable_thinking: false })
    })

    it('should use enable_thinking:false for SiliconFlow + Zhipu model when reasoning_effort is none', async () => {
      const { isReasoningModel, isSupportedThinkingTokenZhipuModel } = await import('@renderer/config/models')

      vi.mocked(isReasoningModel).mockReturnValue(true)
      vi.mocked(isSupportedThinkingTokenZhipuModel).mockReturnValue(true)

      const model: Model = {
        id: 'THUDM/glm-4.5-thinking',
        name: 'GLM-4.5 Thinking',
        provider: SystemProviderIds.silicon
      } as Model

      const assistant: Assistant = {
        id: 'test',
        name: 'Test',
        settings: {
          reasoning_effort: 'none'
        }
      } as Assistant

      const result = getReasoningEffort(assistant, model)
      expect(result).toEqual({ enable_thinking: false })
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

    it('should return camelCase reasoningEffort for Gemini 3 models', async () => {
      const {
        isReasoningModel,
        isOpenAIDeepResearchModel,
        isSupportedThinkingTokenGeminiModel,
        isGemini3ThinkingTokenModel,
        isQwenReasoningModel,
        isSupportedThinkingTokenClaudeModel,
        isSupportedThinkingTokenDoubaoModel,
        isSupportedThinkingTokenZhipuModel,
        isSupportedReasoningEffortModel,
        isSupportedThinkingTokenQwenModel,
        isSupportedThinkingTokenHunyuanModel,
        isDeepSeekHybridInferenceModel
      } = await import('@renderer/config/models')

      vi.mocked(isReasoningModel).mockReturnValue(true)
      vi.mocked(isOpenAIDeepResearchModel).mockReturnValue(false)
      vi.mocked(isSupportedThinkingTokenGeminiModel).mockReturnValue(true)
      vi.mocked(isGemini3ThinkingTokenModel).mockReturnValue(true)
      vi.mocked(isQwenReasoningModel).mockReturnValue(false)
      vi.mocked(isSupportedThinkingTokenClaudeModel).mockReturnValue(false)
      vi.mocked(isSupportedThinkingTokenDoubaoModel).mockReturnValue(false)
      vi.mocked(isSupportedThinkingTokenZhipuModel).mockReturnValue(false)
      vi.mocked(isSupportedReasoningEffortModel).mockReturnValue(false)
      vi.mocked(isSupportedThinkingTokenQwenModel).mockReturnValue(false)
      vi.mocked(isSupportedThinkingTokenHunyuanModel).mockReturnValue(false)
      vi.mocked(isDeepSeekHybridInferenceModel).mockReturnValue(false)

      const model: Model = {
        id: 'gemini-3-flash-preview',
        name: 'Gemini 3 Flash',
        provider: 'custom-provider'
      } as Model

      const assistant: Assistant = {
        id: 'test',
        name: 'Test',
        settings: {
          reasoning_effort: 'high'
        }
      } as Assistant

      const result = getReasoningEffort(assistant, model)
      // Should use camelCase 'reasoningEffort' for AI SDK openai-compatible provider compatibility
      expect(result).toEqual({ reasoningEffort: 'high' })
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

    // Mistral models use reasoningEffort with only 'none' | 'high' support
    describe('Mistral models (mistral-small-2603 and magistral-*)', () => {
      // Helper: Create a Mistral model
      const createMistralModel = (id: string): Model => ({
        id,
        name: id,
        provider: 'mistral',
        group: 'Mistral'
      })

      // Helper: Create an assistant with specific reasoning_effort setting
      const createAssistantWithReasoning = (effort: string | undefined): Assistant =>
        ({
          id: 'test',
          name: 'Test',
          settings: {
            reasoning_effort: effort as any
          }
        }) as Assistant

      describe('mistral-small-2603', () => {
        const mistralModel = createMistralModel('mistral-small-2603')

        it('should return { reasoningEffort: "high" } when reasoning_effort is "high"', async () => {
          const { isReasoningModel } = await import('@renderer/config/models')
          vi.mocked(isReasoningModel).mockReturnValue(true)

          const assistant = createAssistantWithReasoning('high')
          const result = getReasoningEffort(assistant, mistralModel)
          expect(result).toEqual({ reasoningEffort: 'high' })
        })

        it('should return { reasoningEffort: "none" } when reasoning_effort is "none"', async () => {
          const { isReasoningModel } = await import('@renderer/config/models')
          vi.mocked(isReasoningModel).mockReturnValue(true)

          const assistant = createAssistantWithReasoning('none')
          const result = getReasoningEffort(assistant, mistralModel)
          expect(result).toEqual({ reasoningEffort: 'none' })
        })

        it('should return { reasoningEffort: "high" } when reasoning_effort is "low" (mapping)', async () => {
          // Mistral models only support 'none' and 'high', so other values map to 'high'
          const { isReasoningModel } = await import('@renderer/config/models')
          vi.mocked(isReasoningModel).mockReturnValue(true)

          const assistant = createAssistantWithReasoning('low')
          const result = getReasoningEffort(assistant, mistralModel)
          expect(result).toEqual({ reasoningEffort: 'high' })
        })

        it('should return { reasoningEffort: "high" } when reasoning_effort is "medium" (mapping)', async () => {
          const { isReasoningModel } = await import('@renderer/config/models')
          vi.mocked(isReasoningModel).mockReturnValue(true)

          const assistant = createAssistantWithReasoning('medium')
          const result = getReasoningEffort(assistant, mistralModel)
          expect(result).toEqual({ reasoningEffort: 'high' })
        })

        it('should return {} when reasoning_effort is "default"', async () => {
          const { isReasoningModel } = await import('@renderer/config/models')
          vi.mocked(isReasoningModel).mockReturnValue(true)

          const assistant = createAssistantWithReasoning('default')
          const result = getReasoningEffort(assistant, mistralModel)
          expect(result).toEqual({})
        })

        it('should return {} when reasoning_effort is undefined', async () => {
          const { isReasoningModel } = await import('@renderer/config/models')
          vi.mocked(isReasoningModel).mockReturnValue(true)

          const assistant = {
            id: 'test',
            name: 'Test',
            settings: {
              reasoning_effort: undefined
            }
          } as Assistant
          const result = getReasoningEffort(assistant, mistralModel)
          expect(result).toEqual({})
        })
      })

      describe('magistral-small-latest', () => {
        // Magistral models reason natively — they do NOT accept reasoning_effort parameter
        const magistralModel = createMistralModel('magistral-small-latest')

        it('should return {} for magistral (native reasoning, no parameter)', async () => {
          const { isReasoningModel } = await import('@renderer/config/models')
          vi.mocked(isReasoningModel).mockReturnValue(true)

          const assistant = createAssistantWithReasoning('high')
          const result = getReasoningEffort(assistant, magistralModel)
          expect(result).toEqual({})
        })

        it('should return {} for magistral when reasoning_effort is "none"', async () => {
          const { isReasoningModel } = await import('@renderer/config/models')
          vi.mocked(isReasoningModel).mockReturnValue(true)

          const assistant = createAssistantWithReasoning('none')
          const result = getReasoningEffort(assistant, magistralModel)
          expect(result).toEqual({})
        })
      })

      describe('magistral-medium-latest', () => {
        // Magistral models reason natively — no reasoning_effort parameter accepted
        const magistralModel = createMistralModel('magistral-medium-latest')

        it('should return {} for magistral-medium (native reasoning)', async () => {
          const { isReasoningModel } = await import('@renderer/config/models')
          vi.mocked(isReasoningModel).mockReturnValue(true)

          const assistant = createAssistantWithReasoning('xhigh')
          const result = getReasoningEffort(assistant, magistralModel)
          expect(result).toEqual({})
        })

        it('should return {} for magistral-medium with auto effort', async () => {
          const { isReasoningModel } = await import('@renderer/config/models')
          vi.mocked(isReasoningModel).mockReturnValue(true)

          const assistant = createAssistantWithReasoning('auto')
          const result = getReasoningEffort(assistant, magistralModel)
          expect(result).toEqual({})
        })
      })

      describe('edge cases', () => {
        it('should return {} for non-reasoning Mistral models', async () => {
          // isReasoningModel returns false by default in the top-level mock
          const nonReasoningModel = createMistralModel('mistral-large-2407')
          const assistant = createAssistantWithReasoning('high')
          const result = getReasoningEffort(assistant, nonReasoningModel)
          expect(result).toEqual({})
        })

        it('should handle model ID with different case', async () => {
          // getLowerBaseModelName converts to lowercase, so case shouldn't matter
          const { isReasoningModel } = await import('@renderer/config/models')
          vi.mocked(isReasoningModel).mockReturnValue(true)

          const upperCaseModel = createMistralModel('MISTRAL-SMALL-2603')
          const assistant = createAssistantWithReasoning('high')
          const result = getReasoningEffort(assistant, upperCaseModel)
          expect(result).toEqual({ reasoningEffort: 'high' })
        })
      })
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

    it('should return disabled thinking when reasoning effort is none', async () => {
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
        settings: {
          reasoning_effort: 'none'
        }
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
          budgetTokens: 4096
        }
      })
    })

    it('should use adaptive thinking with native xhigh effort and summarized display for Claude Opus 4.7', async () => {
      const { isReasoningModel, isSupportedThinkingTokenClaudeModel } = await import('@renderer/config/models')

      vi.mocked(isReasoningModel).mockReturnValue(true)
      vi.mocked(isSupportedThinkingTokenClaudeModel).mockReturnValue(true)

      const model: Model = {
        id: 'claude-opus-4-7',
        name: 'Claude Opus 4.7',
        provider: SystemProviderIds.anthropic
      } as Model

      const assistant: Assistant = {
        id: 'test',
        name: 'Test',
        settings: { reasoning_effort: 'xhigh' }
      } as Assistant

      const result = getAnthropicReasoningParams(assistant, model)
      expect(result).toEqual({
        thinking: { type: 'adaptive', display: 'summarized' },
        effort: 'xhigh'
      })
    })

    it('should use adaptive thinking with summarized display even without explicit effort for Claude Opus 4.7', async () => {
      const { isReasoningModel, isSupportedThinkingTokenClaudeModel } = await import('@renderer/config/models')

      vi.mocked(isReasoningModel).mockReturnValue(true)
      vi.mocked(isSupportedThinkingTokenClaudeModel).mockReturnValue(true)

      const model: Model = {
        id: 'claude-opus-4-7',
        name: 'Claude Opus 4.7',
        provider: SystemProviderIds.anthropic
      } as Model

      const assistant: Assistant = {
        id: 'test',
        name: 'Test',
        settings: { reasoning_effort: 'auto' }
      } as Assistant

      const result = getAnthropicReasoningParams(assistant, model)
      expect(result).toEqual({
        thinking: { type: 'adaptive', display: 'summarized' }
      })
    })

    it('should use fallback budgetTokens when findTokenLimit returns undefined for Claude model', async () => {
      const { isReasoningModel, isSupportedThinkingTokenClaudeModel, findTokenLimit } = await import(
        '@renderer/config/models'
      )

      vi.mocked(isReasoningModel).mockReturnValue(true)
      vi.mocked(isSupportedThinkingTokenClaudeModel).mockReturnValue(true)
      vi.mocked(findTokenLimit).mockReturnValue(undefined)

      const model: Model = {
        id: 'claude-unknown-model',
        name: 'Claude Unknown',
        provider: SystemProviderIds.anthropic
      } as Model

      const assistant: Assistant = {
        id: 'test',
        name: 'Test',
        settings: {
          reasoning_effort: 'high',
          maxTokens: 8192
        }
      } as Assistant

      const result = getAnthropicReasoningParams(assistant, model)
      expect(result).toEqual({
        thinking: {
          type: 'enabled',
          budgetTokens: expect.any(Number)
        }
      })
      // budgetTokens must be present and >= 1024 (the minimum enforced by computeBudgetTokens)
      const thinking = result.thinking as { type: 'enabled'; budgetTokens?: number }
      expect(thinking.budgetTokens).toBeGreaterThanOrEqual(1024)
    })

    it('should use fallback budgetTokens for non-Claude model on Anthropic endpoint when token limit is unknown', async () => {
      const { isReasoningModel, isSupportedThinkingTokenClaudeModel, findTokenLimit } = await import(
        '@renderer/config/models'
      )

      vi.mocked(isReasoningModel).mockReturnValue(true)
      vi.mocked(isSupportedThinkingTokenClaudeModel).mockReturnValue(false)
      vi.mocked(findTokenLimit).mockReturnValue(undefined)

      const model: Model = {
        id: 'kimi-reasoning-model',
        name: 'Kimi Reasoning',
        provider: 'custom-provider'
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
      // Non-Claude models on Anthropic endpoint should also get fallback budgetTokens
      expect(result).toEqual({
        thinking: {
          type: 'enabled',
          budgetTokens: expect.any(Number)
        },
        sendReasoning: true
      })
      const thinking = result.thinking as { type: 'enabled'; budgetTokens?: number }
      expect(thinking.budgetTokens).toBeGreaterThanOrEqual(1024)
    })

    it('should produce different fallback budgetTokens for different effort levels', async () => {
      const { isReasoningModel, isSupportedThinkingTokenClaudeModel, findTokenLimit } = await import(
        '@renderer/config/models'
      )

      vi.mocked(isReasoningModel).mockReturnValue(true)
      vi.mocked(isSupportedThinkingTokenClaudeModel).mockReturnValue(true)
      vi.mocked(findTokenLimit).mockReturnValue(undefined)

      const model: Model = {
        id: 'claude-unknown-model',
        name: 'Claude Unknown',
        provider: SystemProviderIds.anthropic
      } as Model

      const lowAssistant: Assistant = {
        id: 'test',
        name: 'Test',
        settings: { reasoning_effort: 'low', maxTokens: 4096 }
      } as Assistant

      const highAssistant: Assistant = {
        id: 'test',
        name: 'Test',
        settings: { reasoning_effort: 'high', maxTokens: 4096 }
      } as Assistant

      const lowResult = getAnthropicReasoningParams(lowAssistant, model)
      const highResult = getAnthropicReasoningParams(highAssistant, model)

      // Higher effort should produce higher or equal budgetTokens
      const lowThinking = lowResult.thinking as { type: 'enabled'; budgetTokens?: number }
      const highThinking = highResult.thinking as { type: 'enabled'; budgetTokens?: number }
      expect(highThinking.budgetTokens).toBeGreaterThanOrEqual(lowThinking.budgetTokens!)
    })

    it('should map DeepSeek V4+ xhigh effort to max on the Claude endpoint', async () => {
      const { isReasoningModel, isSupportedThinkingTokenClaudeModel, isDeepSeekV4PlusModel, findTokenLimit } =
        await import('@renderer/config/models')

      vi.mocked(isReasoningModel).mockReturnValue(true)
      vi.mocked(isSupportedThinkingTokenClaudeModel).mockReturnValue(false)
      vi.mocked(isDeepSeekV4PlusModel).mockReturnValue(true)
      vi.mocked(findTokenLimit).mockReturnValue(undefined)

      const model: Model = {
        id: 'deepseek-v4-pro',
        name: 'DeepSeek V4 Pro',
        provider: 'deepseek'
      } as Model

      const assistant: Assistant = {
        id: 'test',
        name: 'Test',
        settings: { reasoning_effort: 'xhigh', maxTokens: 4096 }
      } as Assistant

      const result = getAnthropicReasoningParams(assistant, model)
      expect(result).toEqual({
        thinking: { type: 'enabled', budgetTokens: expect.any(Number) },
        sendReasoning: true,
        effort: 'max'
      })
    })

    it('should map DeepSeek V4+ high effort to high on the Claude endpoint', async () => {
      const { isReasoningModel, isSupportedThinkingTokenClaudeModel, isDeepSeekV4PlusModel, findTokenLimit } =
        await import('@renderer/config/models')

      vi.mocked(isReasoningModel).mockReturnValue(true)
      vi.mocked(isSupportedThinkingTokenClaudeModel).mockReturnValue(false)
      vi.mocked(isDeepSeekV4PlusModel).mockReturnValue(true)
      vi.mocked(findTokenLimit).mockReturnValue(undefined)

      const model: Model = {
        id: 'deepseek-v4',
        name: 'DeepSeek V4',
        provider: 'deepseek'
      } as Model

      const assistant: Assistant = {
        id: 'test',
        name: 'Test',
        settings: { reasoning_effort: 'high', maxTokens: 4096 }
      } as Assistant

      const result = getAnthropicReasoningParams(assistant, model)
      expect(result).toEqual({
        thinking: { type: 'enabled', budgetTokens: expect.any(Number) },
        sendReasoning: true,
        effort: 'high'
      })
    })

    it('should not add effort for DeepSeek V4+ when effort is outside the documented set', async () => {
      // Guard against silent downgrade: if MODEL_SUPPORTED_REASONING_EFFORT.deepseek_v4 ever gains
      // new levels (low/medium/auto), the explicit effortMap must be extended — otherwise effort
      // is omitted here rather than being silently mapped to 'high'.
      const { isReasoningModel, isSupportedThinkingTokenClaudeModel, isDeepSeekV4PlusModel, findTokenLimit } =
        await import('@renderer/config/models')

      vi.mocked(isReasoningModel).mockReturnValue(true)
      vi.mocked(isSupportedThinkingTokenClaudeModel).mockReturnValue(false)
      vi.mocked(isDeepSeekV4PlusModel).mockReturnValue(true)
      vi.mocked(findTokenLimit).mockReturnValue(undefined)

      const model: Model = {
        id: 'deepseek-v4',
        name: 'DeepSeek V4',
        provider: 'deepseek'
      } as Model

      const assistant: Assistant = {
        id: 'test',
        name: 'Test',
        settings: { reasoning_effort: 'medium', maxTokens: 4096 }
      } as Assistant

      const result = getAnthropicReasoningParams(assistant, model)
      expect(result).toEqual({
        thinking: { type: 'enabled', budgetTokens: expect.any(Number) },
        sendReasoning: true
      })
      expect(result).not.toHaveProperty('effort')
    })

    it('should not add effort for non-DeepSeek models on the Claude endpoint', async () => {
      const { isReasoningModel, isSupportedThinkingTokenClaudeModel, isDeepSeekV4PlusModel, findTokenLimit } =
        await import('@renderer/config/models')

      vi.mocked(isReasoningModel).mockReturnValue(true)
      vi.mocked(isSupportedThinkingTokenClaudeModel).mockReturnValue(false)
      vi.mocked(isDeepSeekV4PlusModel).mockReturnValue(false)
      vi.mocked(findTokenLimit).mockReturnValue(undefined)

      const model: Model = {
        id: 'kimi-k2-reasoning',
        name: 'Kimi K2 Reasoning',
        provider: 'custom-provider'
      } as Model

      const assistant: Assistant = {
        id: 'test',
        name: 'Test',
        settings: { reasoning_effort: 'xhigh', maxTokens: 4096 }
      } as Assistant

      const result = getAnthropicReasoningParams(assistant, model)
      expect(result).toEqual({
        thinking: { type: 'enabled', budgetTokens: expect.any(Number) },
        sendReasoning: true
      })
      expect(result).not.toHaveProperty('effort')
    })
  })

  describe('getGeminiReasoningParams', () => {
    // Use beforeAll to avoid per-test dynamic imports while keeping compatibility
    // with the async vi.mock factory (static imports of the mocked module break other tests)
    let mockModels: any

    beforeAll(async () => {
      mockModels = await import('@renderer/config/models')
    })

    it('should return empty for non-reasoning model', () => {
      vi.mocked(mockModels.isReasoningModel).mockReturnValue(false)

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

    it('should return empty when isReasoningModel is true but not a Gemini thinking model', () => {
      vi.mocked(mockModels.isReasoningModel).mockReturnValue(true)
      vi.mocked(mockModels.isSupportedThinkingTokenGeminiModel).mockReturnValue(false)

      const model: Model = {
        id: 'some-reasoning-model',
        name: 'Some Model',
        provider: SystemProviderIds.gemini
      } as Model

      const assistant: Assistant = {
        id: 'test',
        name: 'Test',
        settings: { reasoning_effort: 'high' }
      } as Assistant

      const result = getGeminiReasoningParams(assistant, model)
      expect(result).toEqual({})
    })

    it('should return empty when reasoning effort is not set', () => {
      vi.mocked(mockModels.isReasoningModel).mockReturnValue(true)
      vi.mocked(mockModels.isSupportedThinkingTokenGeminiModel).mockReturnValue(true)

      const model: Model = {
        id: 'gemini-2.5-pro',
        name: 'Gemini 2.5 Pro',
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

    it('should return empty when reasoning effort is default', () => {
      vi.mocked(mockModels.isReasoningModel).mockReturnValue(true)
      vi.mocked(mockModels.isSupportedThinkingTokenGeminiModel).mockReturnValue(true)

      const model: Model = {
        id: 'gemini-2.5-pro',
        name: 'Gemini 2.5 Pro',
        provider: SystemProviderIds.gemini
      } as Model

      const assistant: Assistant = {
        id: 'test',
        name: 'Test',
        settings: { reasoning_effort: 'default' }
      } as Assistant

      const result = getGeminiReasoningParams(assistant, model)
      expect(result).toEqual({})
    })

    it('should disable thinking for Flash models when reasoning effort is none', () => {
      vi.mocked(mockModels.isReasoningModel).mockReturnValue(true)
      vi.mocked(mockModels.isSupportedThinkingTokenGeminiModel).mockReturnValue(true)

      const model: Model = {
        id: 'gemini-2.5-flash',
        name: 'Gemini 2.5 Flash',
        provider: SystemProviderIds.gemini
      } as Model

      const assistant: Assistant = {
        id: 'test',
        name: 'Test',
        settings: {
          reasoning_effort: 'none'
        }
      } as Assistant

      const result = getGeminiReasoningParams(assistant, model)
      expect(result).toEqual({
        thinkingConfig: {
          includeThoughts: false,
          thinkingBudget: 0
        }
      })
    })

    it('should disable thinking for non-Flash models when reasoning effort is none (no thinkingBudget)', () => {
      vi.mocked(mockModels.isReasoningModel).mockReturnValue(true)
      vi.mocked(mockModels.isSupportedThinkingTokenGeminiModel).mockReturnValue(true)

      const model: Model = {
        id: 'gemini-2.5-pro',
        name: 'Gemini 2.5 Pro',
        provider: SystemProviderIds.gemini
      } as Model

      const assistant: Assistant = {
        id: 'test',
        name: 'Test',
        settings: {
          reasoning_effort: 'none'
        }
      } as Assistant

      const result = getGeminiReasoningParams(assistant, model)
      expect(result).toEqual({
        thinkingConfig: {
          includeThoughts: false
        }
      })
    })

    it('should include thinkingLevel for Gemini 3 model with none effort', () => {
      vi.mocked(mockModels.isReasoningModel).mockReturnValue(true)
      vi.mocked(mockModels.isSupportedThinkingTokenGeminiModel).mockReturnValue(true)
      vi.mocked(mockModels.isGemini3ThinkingTokenModel).mockReturnValue(true)

      const model: Model = {
        id: 'gemini-3-flash-preview',
        name: 'Gemini 3 Flash',
        provider: SystemProviderIds.gemini
      } as Model

      const assistant: Assistant = {
        id: 'test',
        name: 'Test',
        settings: { reasoning_effort: 'none' }
      } as Assistant

      const result = getGeminiReasoningParams(assistant, model)
      expect(result).toEqual({
        thinkingConfig: {
          includeThoughts: false,
          thinkingLevel: 'minimal'
        }
      })
    })

    it('should return thinkingLevel for Gemini 3 model with low effort', () => {
      vi.mocked(mockModels.isReasoningModel).mockReturnValue(true)
      vi.mocked(mockModels.isSupportedThinkingTokenGeminiModel).mockReturnValue(true)
      vi.mocked(mockModels.isGemini3ThinkingTokenModel).mockReturnValue(true)

      const model: Model = {
        id: 'gemini-3-flash-preview',
        name: 'Gemini 3 Flash',
        provider: SystemProviderIds.gemini
      } as Model

      const assistant: Assistant = {
        id: 'test',
        name: 'Test',
        settings: { reasoning_effort: 'low' }
      } as Assistant

      const result = getGeminiReasoningParams(assistant, model)
      expect(result).toEqual({
        thinkingConfig: {
          includeThoughts: true,
          thinkingLevel: 'low'
        }
      })
    })

    it('should return thinkingLevel medium for Gemini 3 model with medium effort', () => {
      vi.mocked(mockModels.isReasoningModel).mockReturnValue(true)
      vi.mocked(mockModels.isSupportedThinkingTokenGeminiModel).mockReturnValue(true)
      vi.mocked(mockModels.isGemini3ThinkingTokenModel).mockReturnValue(true)

      const model: Model = {
        id: 'gemini-3-flash-preview',
        name: 'Gemini 3 Flash',
        provider: SystemProviderIds.gemini
      } as Model

      const assistant: Assistant = {
        id: 'test',
        name: 'Test',
        settings: { reasoning_effort: 'medium' }
      } as Assistant

      const result = getGeminiReasoningParams(assistant, model)
      expect(result).toEqual({
        thinkingConfig: {
          includeThoughts: true,
          thinkingLevel: 'medium'
        }
      })
    })

    it('should return thinkingLevel high for Gemini 3 model with high effort', () => {
      vi.mocked(mockModels.isReasoningModel).mockReturnValue(true)
      vi.mocked(mockModels.isSupportedThinkingTokenGeminiModel).mockReturnValue(true)
      vi.mocked(mockModels.isGemini3ThinkingTokenModel).mockReturnValue(true)

      const model: Model = {
        id: 'gemini-3-flash-preview',
        name: 'Gemini 3 Flash',
        provider: SystemProviderIds.gemini
      } as Model

      const assistant: Assistant = {
        id: 'test',
        name: 'Test',
        settings: { reasoning_effort: 'high' }
      } as Assistant

      const result = getGeminiReasoningParams(assistant, model)
      expect(result).toEqual({
        thinkingConfig: {
          includeThoughts: true,
          thinkingLevel: 'high'
        }
      })
    })

    it('should return thinkingLevel high for Gemini 3 model with xhigh effort', () => {
      vi.mocked(mockModels.isReasoningModel).mockReturnValue(true)
      vi.mocked(mockModels.isSupportedThinkingTokenGeminiModel).mockReturnValue(true)
      vi.mocked(mockModels.isGemini3ThinkingTokenModel).mockReturnValue(true)

      const model: Model = {
        id: 'gemini-3-flash-preview',
        name: 'Gemini 3 Flash',
        provider: SystemProviderIds.gemini
      } as Model

      const assistant: Assistant = {
        id: 'test',
        name: 'Test',
        settings: { reasoning_effort: 'xhigh' }
      } as Assistant

      const result = getGeminiReasoningParams(assistant, model)
      expect(result).toEqual({
        thinkingConfig: {
          includeThoughts: true,
          thinkingLevel: 'high'
        }
      })
    })

    it('should use undefined thinkingLevel for Gemini 3 model with auto effort', () => {
      vi.mocked(mockModels.isReasoningModel).mockReturnValue(true)
      vi.mocked(mockModels.isSupportedThinkingTokenGeminiModel).mockReturnValue(true)
      vi.mocked(mockModels.isGemini3ThinkingTokenModel).mockReturnValue(true)

      const model: Model = {
        id: 'gemini-3-flash-preview',
        name: 'Gemini 3 Flash',
        provider: SystemProviderIds.gemini
      } as Model

      const assistant: Assistant = {
        id: 'test',
        name: 'Test',
        settings: { reasoning_effort: 'auto' }
      } as Assistant

      const result = getGeminiReasoningParams(assistant, model)
      // auto maps to undefined thinkingLevel (let API decide), stays in Gemini 3 branch
      expect(result).toEqual({
        thinkingConfig: {
          includeThoughts: true,
          thinkingLevel: undefined
        }
      })
    })

    it('should return thinkingLevel minimal for Gemini 3 model with minimal effort', () => {
      vi.mocked(mockModels.isReasoningModel).mockReturnValue(true)
      vi.mocked(mockModels.isSupportedThinkingTokenGeminiModel).mockReturnValue(true)
      vi.mocked(mockModels.isGemini3ThinkingTokenModel).mockReturnValue(true)

      const model: Model = {
        id: 'gemini-3-flash-preview',
        name: 'Gemini 3 Flash',
        provider: SystemProviderIds.gemini
      } as Model

      const assistant: Assistant = {
        id: 'test',
        name: 'Test',
        settings: { reasoning_effort: 'minimal' }
      } as Assistant

      const result = getGeminiReasoningParams(assistant, model)
      expect(result).toEqual({
        thinkingConfig: {
          includeThoughts: true,
          thinkingLevel: 'minimal'
        }
      })
    })

    it('should map hosted Gemma 4 minimal effort to minimal thinkingLevel without thoughts', () => {
      vi.mocked(mockModels.isReasoningModel).mockReturnValue(true)
      vi.mocked(mockModels.isSupportedThinkingTokenGeminiModel).mockReturnValue(true)
      vi.mocked(mockModels.isHostedGemma4ThinkingModel).mockReturnValue(true)

      const model: Model = {
        id: 'gemma-4-31b-it',
        name: 'Gemma 4 31B',
        provider: SystemProviderIds.gemini
      } as Model

      const assistant: Assistant = {
        id: 'test',
        name: 'Test',
        settings: { reasoning_effort: 'minimal' }
      } as Assistant

      const result = getGeminiReasoningParams(assistant, model)
      expect(result).toEqual({
        thinkingConfig: {
          includeThoughts: false,
          thinkingLevel: 'minimal'
        }
      })
    })

    it('should map hosted Gemma 4 high effort to high thinkingLevel with thoughts', () => {
      vi.mocked(mockModels.isReasoningModel).mockReturnValue(true)
      vi.mocked(mockModels.isSupportedThinkingTokenGeminiModel).mockReturnValue(true)
      vi.mocked(mockModels.isHostedGemma4ThinkingModel).mockReturnValue(true)

      const model: Model = {
        id: 'gemma-4-31b-it',
        name: 'Gemma 4 31B',
        provider: SystemProviderIds.gemini
      } as Model

      const assistant: Assistant = {
        id: 'test',
        name: 'Test',
        settings: { reasoning_effort: 'high' }
      } as Assistant

      const result = getGeminiReasoningParams(assistant, model)
      expect(result).toEqual({
        thinkingConfig: {
          includeThoughts: true,
          thinkingLevel: 'high'
        }
      })
    })

    it('should enable thinking with budget for reasoning effort', () => {
      vi.mocked(mockModels.isReasoningModel).mockReturnValue(true)
      vi.mocked(mockModels.isSupportedThinkingTokenGeminiModel).mockReturnValue(true)

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
          thinkingBudget: expect.any(Number),
          includeThoughts: true
        }
      })
    })

    it('should compute thinkingBudget for old models with xhigh effort', () => {
      vi.mocked(mockModels.isReasoningModel).mockReturnValue(true)
      vi.mocked(mockModels.isSupportedThinkingTokenGeminiModel).mockReturnValue(true)

      const model: Model = {
        id: 'gemini-2.5-pro',
        name: 'Gemini 2.5 Pro',
        provider: SystemProviderIds.gemini
      } as Model

      const assistant: Assistant = {
        id: 'test',
        name: 'Test',
        settings: { reasoning_effort: 'xhigh' }
      } as Assistant

      const result = getGeminiReasoningParams(assistant, model)
      // EFFORT_RATIO['xhigh'] = 0.9, which is NOT > 1, so it should compute a budget
      expect(result).toEqual({
        thinkingConfig: {
          thinkingBudget: expect.any(Number),
          includeThoughts: true
        }
      })
    })

    it('should return thinkingBudget -1 for old models with auto effort', () => {
      vi.mocked(mockModels.isReasoningModel).mockReturnValue(true)
      vi.mocked(mockModels.isSupportedThinkingTokenGeminiModel).mockReturnValue(true)

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
          includeThoughts: true,
          thinkingBudget: -1
        }
      })
    })

    it('should omit thinkingBudget for old models when no token limit is found', () => {
      vi.mocked(mockModels.isReasoningModel).mockReturnValue(true)
      vi.mocked(mockModels.isSupportedThinkingTokenGeminiModel).mockReturnValue(true)
      vi.mocked(mockModels.findTokenLimit).mockReturnValue(undefined)

      const model: Model = {
        id: 'gemini-2.5-pro-unknown',
        name: 'Gemini 2.5 Pro Unknown',
        provider: SystemProviderIds.gemini
      } as Model

      const assistant: Assistant = {
        id: 'test',
        name: 'Test',
        settings: { reasoning_effort: 'medium' }
      } as Assistant

      const result = getGeminiReasoningParams(assistant, model)
      // budget = Math.floor((0 - 0) * 0.5 + 0) = 0, so no thinkingBudget
      expect(result).toEqual({
        thinkingConfig: {
          includeThoughts: true
        }
      })
    })

    it('should calculate correct thinkingBudget for low effort', () => {
      vi.mocked(mockModels.isReasoningModel).mockReturnValue(true)
      vi.mocked(mockModels.isSupportedThinkingTokenGeminiModel).mockReturnValue(true)
      vi.mocked(mockModels.findTokenLimit).mockReturnValue({ min: 1024, max: 32768 })

      const model: Model = {
        id: 'gemini-2.5-pro',
        name: 'Gemini 2.5 Pro',
        provider: SystemProviderIds.gemini
      } as Model

      const assistant: Assistant = {
        id: 'test',
        name: 'Test',
        settings: { reasoning_effort: 'low' }
      } as Assistant

      const result = getGeminiReasoningParams(assistant, model)
      // EFFORT_RATIO['low'] = 0.05
      // budget = Math.floor((32768 - 1024) * 0.05 + 1024) = Math.floor(1587.2 + 1024) = 2611
      expect(result).toEqual({
        thinkingConfig: {
          thinkingBudget: 2611,
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
          budgetTokens: 4096
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

  describe('getThinkingBudget', () => {
    it('should return undefined when reasoningEffort is undefined', async () => {
      const result = getThinkingBudget(4096, undefined, 'claude-3-7-sonnet')
      expect(result).toBeUndefined()
    })

    it('should return undefined when reasoningEffort is none', async () => {
      const result = getThinkingBudget(4096, 'none', 'claude-3-7-sonnet')
      expect(result).toBeUndefined()
    })

    it('should return undefined when tokenLimit is not found', async () => {
      const { findTokenLimit } = await import('@renderer/config/models')
      vi.mocked(findTokenLimit).mockReturnValue(undefined)

      const result = getThinkingBudget(4096, 'medium', 'unknown-model')
      expect(result).toBeUndefined()
    })

    it('should calculate budget correctly when maxTokens is provided', async () => {
      const { findTokenLimit } = await import('@renderer/config/models')
      vi.mocked(findTokenLimit).mockReturnValue({ min: 1024, max: 32768 })

      const result = getThinkingBudget(4096, 'medium', 'claude-3-7-sonnet')
      // EFFORT_RATIO['medium'] = 0.5
      // budget = Math.floor((32768 - 1024) * 0.5 + 1024)
      // = Math.floor(31744 * 0.5 + 1024) = Math.floor(15872 + 1024) = 16896
      // budgetTokens = Math.min(16896, 4096) = 4096
      // result = Math.max(1024, 4096) = 4096
      expect(result).toBe(4096)
    })

    it('should use tokenLimit.max when maxTokens is undefined', async () => {
      const { findTokenLimit } = await import('@renderer/config/models')
      vi.mocked(findTokenLimit).mockReturnValue({ min: 1024, max: 32768 })

      const result = getThinkingBudget(undefined, 'medium', 'claude-3-7-sonnet')
      // When maxTokens is undefined, budget is not constrained by maxTokens
      // EFFORT_RATIO['medium'] = 0.5
      // budget = Math.floor((32768 - 1024) * 0.5 + 1024)
      // = Math.floor(31744 * 0.5 + 1024) = Math.floor(15872 + 1024) = 16896
      // result = Math.max(1024, 16896) = 16896
      expect(result).toBe(16896)
    })

    it('should enforce minimum budget of 1024', async () => {
      const { findTokenLimit } = await import('@renderer/config/models')
      vi.mocked(findTokenLimit).mockReturnValue({ min: 100, max: 1000 })

      const result = getThinkingBudget(500, 'low', 'claude-3-7-sonnet')
      // EFFORT_RATIO['low'] = 0.05
      // budget = Math.floor((1000 - 100) * 0.05 + 100)
      // = Math.floor(900 * 0.05 + 100) = Math.floor(45 + 100) = 145
      // budgetTokens = Math.min(145, 500) = 145
      // result = Math.max(1024, 145) = 1024
      expect(result).toBe(1024)
    })

    it('should respect effort ratio for high reasoning effort', async () => {
      const { findTokenLimit } = await import('@renderer/config/models')
      vi.mocked(findTokenLimit).mockReturnValue({ min: 1024, max: 32768 })

      const result = getThinkingBudget(8192, 'high', 'claude-3-7-sonnet')
      // EFFORT_RATIO['high'] = 0.8
      // budget = Math.floor((32768 - 1024) * 0.8 + 1024)
      // = Math.floor(31744 * 0.8 + 1024) = Math.floor(25395.2 + 1024) = 26419
      // budgetTokens = Math.min(26419, 8192) = 8192
      // result = Math.max(1024, 8192) = 8192
      expect(result).toBe(8192)
    })

    it('should use full token limit when maxTokens is undefined and reasoning effort is high', async () => {
      const { findTokenLimit } = await import('@renderer/config/models')
      vi.mocked(findTokenLimit).mockReturnValue({ min: 1024, max: 32768 })

      const result = getThinkingBudget(undefined, 'high', 'claude-3-7-sonnet')
      // When maxTokens is undefined, budget is not constrained by maxTokens
      // EFFORT_RATIO['high'] = 0.8
      // budget = Math.floor((32768 - 1024) * 0.8 + 1024)
      // = Math.floor(31744 * 0.8 + 1024) = Math.floor(25395.2 + 1024) = 26419
      // result = Math.max(1024, 26419) = 26419
      expect(result).toBe(26419)
    })
  })
})
