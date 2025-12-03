/**
 * options.ts Unit Tests
 * Tests for building provider-specific options
 */

import type { Assistant, Model, Provider } from '@renderer/types'
import { OpenAIServiceTiers, SystemProviderIds } from '@renderer/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { buildProviderOptions } from '../options'

// Mock dependencies
vi.mock('@cherrystudio/ai-core/provider', async (importOriginal) => {
  const actual = (await importOriginal()) as object
  return {
    ...actual,
    baseProviderIdSchema: {
      safeParse: vi.fn((id) => {
        const baseProviders = [
          'openai',
          'openai-chat',
          'azure',
          'azure-responses',
          'huggingface',
          'anthropic',
          'google',
          'xai',
          'deepseek',
          'openrouter',
          'openai-compatible'
        ]
        if (baseProviders.includes(id)) {
          return { success: true, data: id }
        }
        return { success: false }
      })
    },
    customProviderIdSchema: {
      safeParse: vi.fn((id) => {
        const customProviders = ['google-vertex', 'google-vertex-anthropic', 'bedrock', 'gateway']
        if (customProviders.includes(id)) {
          return { success: true, data: id }
        }
        return { success: false, error: new Error('Invalid provider') }
      })
    }
  }
})

vi.mock('../provider/factory', () => ({
  getAiSdkProviderId: vi.fn((provider) => {
    // Simulate the provider ID mapping
    const mapping: Record<string, string> = {
      [SystemProviderIds.gemini]: 'google',
      [SystemProviderIds.openai]: 'openai',
      [SystemProviderIds.anthropic]: 'anthropic',
      [SystemProviderIds.grok]: 'xai',
      [SystemProviderIds.deepseek]: 'deepseek',
      [SystemProviderIds.openrouter]: 'openrouter',
      [SystemProviderIds.gateway]: 'gateway'
    }
    return mapping[provider.id] || provider.id
  })
}))

vi.mock('@renderer/config/models', async (importOriginal) => ({
  ...(await importOriginal()),
  isOpenAIModel: vi.fn((model) => model.id.includes('gpt') || model.id.includes('o1')),
  isQwenMTModel: vi.fn(() => false),
  isSupportFlexServiceTierModel: vi.fn(() => true),
  isOpenAILLMModel: vi.fn(() => true),
  SYSTEM_MODELS: {
    defaultModel: [
      { id: 'default-1', name: 'Default 1' },
      { id: 'default-2', name: 'Default 2' },
      { id: 'default-3', name: 'Default 3' }
    ]
  }
}))

vi.mock(import('@renderer/utils/provider'), async (importOriginal) => {
  return {
    ...(await importOriginal()),
    isSupportServiceTierProvider: vi.fn((provider) => {
      return [SystemProviderIds.openai, SystemProviderIds.groq].includes(provider.id)
    })
  }
})

vi.mock('@renderer/store/settings', () => ({
  default: (state = { settings: {} }) => state
}))

vi.mock('@renderer/hooks/useSettings', () => ({
  getStoreSetting: vi.fn((key) => {
    if (key === 'openAI') {
      return { summaryText: 'off', verbosity: 'medium' } as any
    }
    return {}
  })
}))

vi.mock('@renderer/services/AssistantService', () => ({
  getDefaultAssistant: vi.fn(() => ({
    id: 'default',
    name: 'Default Assistant',
    settings: {}
  })),
  getAssistantSettings: vi.fn(() => ({
    reasoning_effort: 'medium',
    maxTokens: 4096
  })),
  getProviderByModel: vi.fn((model: Model) => ({
    id: model.provider,
    name: 'Mock Provider'
  }))
}))

vi.mock('../reasoning', () => ({
  getOpenAIReasoningParams: vi.fn(() => ({ reasoningEffort: 'medium' })),
  getAnthropicReasoningParams: vi.fn(() => ({
    thinking: { type: 'enabled', budgetTokens: 5000 }
  })),
  getGeminiReasoningParams: vi.fn(() => ({
    thinkingConfig: { include_thoughts: true }
  })),
  getXAIReasoningParams: vi.fn(() => ({ reasoningEffort: 'high' })),
  getBedrockReasoningParams: vi.fn(() => ({
    reasoningConfig: { type: 'enabled', budgetTokens: 5000 }
  })),
  getReasoningEffort: vi.fn(() => ({ reasoningEffort: 'medium' })),
  getCustomParameters: vi.fn(() => ({})),
  extractAiSdkStandardParams: vi.fn((customParams: Record<string, any>) => {
    const AI_SDK_STANDARD_PARAMS = ['topK', 'frequencyPenalty', 'presencePenalty', 'stopSequences', 'seed']
    const standardParams: Record<string, any> = {}
    const providerParams: Record<string, any> = {}
    for (const [key, value] of Object.entries(customParams)) {
      if (AI_SDK_STANDARD_PARAMS.includes(key)) {
        standardParams[key] = value
      } else {
        providerParams[key] = value
      }
    }
    return { standardParams, providerParams }
  })
}))

vi.mock('../image', () => ({
  buildGeminiGenerateImageParams: vi.fn(() => ({
    responseModalities: ['TEXT', 'IMAGE']
  }))
}))

vi.mock('../websearch', () => ({
  getWebSearchParams: vi.fn(() => ({ enable_search: true }))
}))

vi.mock('../../prepareParams/header', () => ({
  addAnthropicHeaders: vi.fn(() => ['context-1m-2025-08-07'])
}))

const ensureWindowApi = () => {
  const globalWindow = window as any
  globalWindow.api = globalWindow.api || {}
  globalWindow.api.getAppInfo = globalWindow.api.getAppInfo || vi.fn(async () => ({ notesPath: '' }))
}

ensureWindowApi()

describe('options utils', () => {
  const mockAssistant: Assistant = {
    id: 'test-assistant',
    name: 'Test Assistant',
    settings: {}
  } as Assistant

  const mockModel: Model = {
    id: 'gpt-4',
    name: 'GPT-4',
    provider: SystemProviderIds.openai
  } as Model

  beforeEach(async () => {
    vi.clearAllMocks()
    // Reset getCustomParameters to return empty object by default
    const { getCustomParameters } = await import('../reasoning')
    vi.mocked(getCustomParameters).mockReturnValue({})
  })

  describe('buildProviderOptions', () => {
    describe('OpenAI provider', () => {
      const openaiProvider: Provider = {
        id: SystemProviderIds.openai,
        name: 'OpenAI',
        type: 'openai-response',
        apiKey: 'test-key',
        apiHost: 'https://api.openai.com/v1',
        isSystem: true
      } as Provider

      it('should build basic OpenAI options', () => {
        const result = buildProviderOptions(mockAssistant, mockModel, openaiProvider, {
          enableReasoning: false,
          enableWebSearch: false,
          enableGenerateImage: false
        })

        expect(result.providerOptions).toHaveProperty('openai')
        expect(result.providerOptions.openai).toBeDefined()
        expect(result.standardParams).toBeDefined()
      })

      it('should include reasoning parameters when enabled', () => {
        const result = buildProviderOptions(mockAssistant, mockModel, openaiProvider, {
          enableReasoning: true,
          enableWebSearch: false,
          enableGenerateImage: false
        })

        expect(result.providerOptions.openai).toHaveProperty('reasoningEffort')
        expect(result.providerOptions.openai.reasoningEffort).toBe('medium')
      })

      it('should include service tier when supported', () => {
        const providerWithServiceTier: Provider = {
          ...openaiProvider,
          serviceTier: OpenAIServiceTiers.auto
        }

        const result = buildProviderOptions(mockAssistant, mockModel, providerWithServiceTier, {
          enableReasoning: false,
          enableWebSearch: false,
          enableGenerateImage: false
        })

        expect(result.providerOptions.openai).toHaveProperty('serviceTier')
        expect(result.providerOptions.openai.serviceTier).toBe(OpenAIServiceTiers.auto)
      })
    })

    describe('Anthropic provider', () => {
      const anthropicProvider: Provider = {
        id: SystemProviderIds.anthropic,
        name: 'Anthropic',
        type: 'anthropic',
        apiKey: 'test-key',
        apiHost: 'https://api.anthropic.com',
        isSystem: true
      } as Provider

      const anthropicModel: Model = {
        id: 'claude-3-5-sonnet-20241022',
        name: 'Claude 3.5 Sonnet',
        provider: SystemProviderIds.anthropic
      } as Model

      it('should build basic Anthropic options', () => {
        const result = buildProviderOptions(mockAssistant, anthropicModel, anthropicProvider, {
          enableReasoning: false,
          enableWebSearch: false,
          enableGenerateImage: false
        })

        expect(result.providerOptions).toHaveProperty('anthropic')
        expect(result.providerOptions.anthropic).toBeDefined()
      })

      it('should include reasoning parameters when enabled', () => {
        const result = buildProviderOptions(mockAssistant, anthropicModel, anthropicProvider, {
          enableReasoning: true,
          enableWebSearch: false,
          enableGenerateImage: false
        })

        expect(result.providerOptions.anthropic).toHaveProperty('thinking')
        expect(result.providerOptions.anthropic.thinking).toEqual({
          type: 'enabled',
          budgetTokens: 5000
        })
      })
    })

    describe('Google provider', () => {
      const googleProvider: Provider = {
        id: SystemProviderIds.gemini,
        name: 'Google',
        type: 'gemini',
        apiKey: 'test-key',
        apiHost: 'https://generativelanguage.googleapis.com',
        isSystem: true,
        models: [{ id: 'gemini-2.0-flash-exp' }] as Model[]
      } as Provider

      const googleModel: Model = {
        id: 'gemini-2.0-flash-exp',
        name: 'Gemini 2.0 Flash',
        provider: SystemProviderIds.gemini
      } as Model

      it('should build basic Google options', () => {
        const result = buildProviderOptions(mockAssistant, googleModel, googleProvider, {
          enableReasoning: false,
          enableWebSearch: false,
          enableGenerateImage: false
        })

        expect(result.providerOptions).toHaveProperty('google')
        expect(result.providerOptions.google).toBeDefined()
      })

      it('should include reasoning parameters when enabled', () => {
        const result = buildProviderOptions(mockAssistant, googleModel, googleProvider, {
          enableReasoning: true,
          enableWebSearch: false,
          enableGenerateImage: false
        })

        expect(result.providerOptions.google).toHaveProperty('thinkingConfig')
        expect(result.providerOptions.google.thinkingConfig).toEqual({
          include_thoughts: true
        })
      })

      it('should include image generation parameters when enabled', () => {
        const result = buildProviderOptions(mockAssistant, googleModel, googleProvider, {
          enableReasoning: false,
          enableWebSearch: false,
          enableGenerateImage: true
        })

        expect(result.providerOptions.google).toHaveProperty('responseModalities')
        expect(result.providerOptions.google.responseModalities).toEqual(['TEXT', 'IMAGE'])
      })
    })

    describe('xAI provider', () => {
      const xaiProvider = {
        id: SystemProviderIds.grok,
        name: 'xAI',
        type: 'new-api',
        apiKey: 'test-key',
        apiHost: 'https://api.x.ai/v1',
        isSystem: true,
        models: [] as Model[]
      } as Provider

      const xaiModel: Model = {
        id: 'grok-2-latest',
        name: 'Grok 2',
        provider: SystemProviderIds.grok
      } as Model

      it('should build basic xAI options', () => {
        const result = buildProviderOptions(mockAssistant, xaiModel, xaiProvider, {
          enableReasoning: false,
          enableWebSearch: false,
          enableGenerateImage: false
        })

        expect(result.providerOptions).toHaveProperty('xai')
        expect(result.providerOptions.xai).toBeDefined()
      })

      it('should include reasoning parameters when enabled', () => {
        const result = buildProviderOptions(mockAssistant, xaiModel, xaiProvider, {
          enableReasoning: true,
          enableWebSearch: false,
          enableGenerateImage: false
        })

        expect(result.providerOptions.xai).toHaveProperty('reasoningEffort')
        expect(result.providerOptions.xai.reasoningEffort).toBe('high')
      })
    })

    describe('DeepSeek provider', () => {
      const deepseekProvider: Provider = {
        id: SystemProviderIds.deepseek,
        name: 'DeepSeek',
        type: 'openai',
        apiKey: 'test-key',
        apiHost: 'https://api.deepseek.com',
        isSystem: true
      } as Provider

      const deepseekModel: Model = {
        id: 'deepseek-chat',
        name: 'DeepSeek Chat',
        provider: SystemProviderIds.deepseek
      } as Model

      it('should build basic DeepSeek options', () => {
        const result = buildProviderOptions(mockAssistant, deepseekModel, deepseekProvider, {
          enableReasoning: false,
          enableWebSearch: false,
          enableGenerateImage: false
        })
        expect(result.providerOptions).toHaveProperty('deepseek')
        expect(result.providerOptions.deepseek).toBeDefined()
      })
    })

    describe('OpenRouter provider', () => {
      const openrouterProvider: Provider = {
        id: SystemProviderIds.openrouter,
        name: 'OpenRouter',
        type: 'openai',
        apiKey: 'test-key',
        apiHost: 'https://openrouter.ai/api/v1',
        isSystem: true
      } as Provider

      const openrouterModel: Model = {
        id: 'openai/gpt-4',
        name: 'GPT-4',
        provider: SystemProviderIds.openrouter
      } as Model

      it('should build basic OpenRouter options', () => {
        const result = buildProviderOptions(mockAssistant, openrouterModel, openrouterProvider, {
          enableReasoning: false,
          enableWebSearch: false,
          enableGenerateImage: false
        })

        expect(result.providerOptions).toHaveProperty('openrouter')
        expect(result.providerOptions.openrouter).toBeDefined()
      })

      it('should include web search parameters when enabled', () => {
        const result = buildProviderOptions(mockAssistant, openrouterModel, openrouterProvider, {
          enableReasoning: false,
          enableWebSearch: true,
          enableGenerateImage: false
        })

        expect(result.providerOptions.openrouter).toHaveProperty('enable_search')
      })
    })

    describe('Custom parameters', () => {
      it('should merge custom provider-specific parameters', async () => {
        const { getCustomParameters } = await import('../reasoning')

        vi.mocked(getCustomParameters).mockReturnValue({
          custom_param: 'custom_value',
          another_param: 123
        })

        const result = buildProviderOptions(
          mockAssistant,
          mockModel,
          {
            id: SystemProviderIds.openai,
            name: 'OpenAI',
            type: 'openai',
            apiKey: 'test-key',
            apiHost: 'https://api.openai.com/v1'
          } as Provider,
          {
            enableReasoning: false,
            enableWebSearch: false,
            enableGenerateImage: false
          }
        )

        expect(result.providerOptions).toStrictEqual({
          openai: {
            custom_param: 'custom_value',
            another_param: 123,
            serviceTier: undefined,
            textVerbosity: undefined
          }
        })
      })

      it('should extract AI SDK standard params from custom parameters', async () => {
        const { getCustomParameters } = await import('../reasoning')

        vi.mocked(getCustomParameters).mockReturnValue({
          topK: 5,
          frequencyPenalty: 0.5,
          presencePenalty: 0.3,
          seed: 42,
          custom_param: 'custom_value'
        })

        const result = buildProviderOptions(
          mockAssistant,
          mockModel,
          {
            id: SystemProviderIds.gemini,
            name: 'Google',
            type: 'gemini',
            apiKey: 'test-key',
            apiHost: 'https://generativelanguage.googleapis.com'
          } as Provider,
          {
            enableReasoning: false,
            enableWebSearch: false,
            enableGenerateImage: false
          }
        )

        // Standard params should be extracted and returned separately
        expect(result.standardParams).toEqual({
          topK: 5,
          frequencyPenalty: 0.5,
          presencePenalty: 0.3,
          seed: 42
        })

        // Provider-specific params should still be in providerOptions
        expect(result.providerOptions.google).toHaveProperty('custom_param')
        expect(result.providerOptions.google.custom_param).toBe('custom_value')

        // Standard params should NOT be in providerOptions
        expect(result.providerOptions.google).not.toHaveProperty('topK')
        expect(result.providerOptions.google).not.toHaveProperty('frequencyPenalty')
        expect(result.providerOptions.google).not.toHaveProperty('presencePenalty')
        expect(result.providerOptions.google).not.toHaveProperty('seed')
      })

      it('should handle stopSequences in custom parameters', async () => {
        const { getCustomParameters } = await import('../reasoning')

        vi.mocked(getCustomParameters).mockReturnValue({
          stopSequences: ['STOP', 'END'],
          custom_param: 'value'
        })

        const result = buildProviderOptions(
          mockAssistant,
          mockModel,
          {
            id: SystemProviderIds.gemini,
            name: 'Google',
            type: 'gemini',
            apiKey: 'test-key',
            apiHost: 'https://generativelanguage.googleapis.com'
          } as Provider,
          {
            enableReasoning: false,
            enableWebSearch: false,
            enableGenerateImage: false
          }
        )

        expect(result.standardParams).toEqual({
          stopSequences: ['STOP', 'END']
        })
        expect(result.providerOptions.google).not.toHaveProperty('stopSequences')
      })
    })

    describe('Multiple capabilities', () => {
      const googleProvider = {
        id: SystemProviderIds.gemini,
        name: 'Google',
        type: 'gemini',
        apiKey: 'test-key',
        apiHost: 'https://generativelanguage.googleapis.com',
        isSystem: true,
        models: [] as Model[]
      } as Provider

      const googleModel: Model = {
        id: 'gemini-2.0-flash-exp',
        name: 'Gemini 2.0 Flash',
        provider: SystemProviderIds.gemini
      } as Model

      it('should combine reasoning and image generation', () => {
        const result = buildProviderOptions(mockAssistant, googleModel, googleProvider, {
          enableReasoning: true,
          enableWebSearch: false,
          enableGenerateImage: true
        })

        expect(result.providerOptions.google).toHaveProperty('thinkingConfig')
        expect(result.providerOptions.google).toHaveProperty('responseModalities')
      })

      it('should handle all capabilities enabled', () => {
        const result = buildProviderOptions(mockAssistant, googleModel, googleProvider, {
          enableReasoning: true,
          enableWebSearch: true,
          enableGenerateImage: true
        })

        expect(result.providerOptions.google).toBeDefined()
        expect(Object.keys(result.providerOptions.google).length).toBeGreaterThan(0)
      })
    })

    describe('Vertex AI providers', () => {
      it('should map google-vertex to google', () => {
        const vertexProvider = {
          id: 'google-vertex',
          name: 'Vertex AI',
          type: 'vertexai',
          apiKey: 'test-key',
          apiHost: 'https://vertex-ai.googleapis.com',
          models: [] as Model[]
        } as Provider

        const vertexModel: Model = {
          id: 'gemini-2.0-flash-exp',
          name: 'Gemini 2.0 Flash',
          provider: 'google-vertex'
        } as Model

        const result = buildProviderOptions(mockAssistant, vertexModel, vertexProvider, {
          enableReasoning: false,
          enableWebSearch: false,
          enableGenerateImage: false
        })

        expect(result.providerOptions).toHaveProperty('google')
      })

      it('should map google-vertex-anthropic to anthropic', () => {
        const vertexAnthropicProvider = {
          id: 'google-vertex-anthropic',
          name: 'Vertex AI Anthropic',
          type: 'vertex-anthropic',
          apiKey: 'test-key',
          apiHost: 'https://vertex-ai.googleapis.com',
          models: [] as Model[]
        } as Provider

        const vertexModel: Model = {
          id: 'claude-3-5-sonnet-20241022',
          name: 'Claude 3.5 Sonnet',
          provider: 'google-vertex-anthropic'
        } as Model

        const result = buildProviderOptions(mockAssistant, vertexModel, vertexAnthropicProvider, {
          enableReasoning: false,
          enableWebSearch: false,
          enableGenerateImage: false
        })

        expect(result.providerOptions).toHaveProperty('anthropic')
      })
    })

    describe('AWS Bedrock provider', () => {
      const bedrockProvider = {
        id: 'bedrock',
        name: 'AWS Bedrock',
        type: 'aws-bedrock',
        apiKey: 'test-key',
        apiHost: 'https://bedrock.us-east-1.amazonaws.com',
        models: [] as Model[]
      } as Provider

      const bedrockModel: Model = {
        id: 'anthropic.claude-sonnet-4-20250514-v1:0',
        name: 'Claude Sonnet 4',
        provider: 'bedrock'
      } as Model

      it('should build basic Bedrock options', () => {
        const result = buildProviderOptions(mockAssistant, bedrockModel, bedrockProvider, {
          enableReasoning: false,
          enableWebSearch: false,
          enableGenerateImage: false
        })

        expect(result.providerOptions).toHaveProperty('bedrock')
        expect(result.providerOptions.bedrock).toBeDefined()
      })

      it('should include anthropicBeta when Anthropic headers are needed', async () => {
        const { addAnthropicHeaders } = await import('../../prepareParams/header')
        vi.mocked(addAnthropicHeaders).mockReturnValue(['interleaved-thinking-2025-05-14', 'context-1m-2025-08-07'])

        const result = buildProviderOptions(mockAssistant, bedrockModel, bedrockProvider, {
          enableReasoning: false,
          enableWebSearch: false,
          enableGenerateImage: false
        })

        expect(result.providerOptions.bedrock).toHaveProperty('anthropicBeta')
        expect(result.providerOptions.bedrock.anthropicBeta).toEqual([
          'interleaved-thinking-2025-05-14',
          'context-1m-2025-08-07'
        ])
      })

      it('should include reasoning parameters when enabled', () => {
        const result = buildProviderOptions(mockAssistant, bedrockModel, bedrockProvider, {
          enableReasoning: true,
          enableWebSearch: false,
          enableGenerateImage: false
        })

        expect(result.providerOptions.bedrock).toHaveProperty('reasoningConfig')
        expect(result.providerOptions.bedrock.reasoningConfig).toEqual({
          type: 'enabled',
          budgetTokens: 5000
        })
      })
    })

    describe('AI Gateway provider', () => {
      const gatewayProvider: Provider = {
        id: SystemProviderIds.gateway,
        name: 'Vercel AI Gateway',
        type: 'gateway',
        apiKey: 'test-key',
        apiHost: 'https://gateway.vercel.com',
        isSystem: true
      } as Provider

      it('should build OpenAI options for OpenAI models through gateway', () => {
        const openaiModel: Model = {
          id: 'openai/gpt-4',
          name: 'GPT-4',
          provider: SystemProviderIds.gateway
        } as Model

        const result = buildProviderOptions(mockAssistant, openaiModel, gatewayProvider, {
          enableReasoning: false,
          enableWebSearch: false,
          enableGenerateImage: false
        })

        expect(result.providerOptions).toHaveProperty('openai')
        expect(result.providerOptions.openai).toBeDefined()
      })

      it('should build Anthropic options for Anthropic models through gateway', () => {
        const anthropicModel: Model = {
          id: 'anthropic/claude-3-5-sonnet-20241022',
          name: 'Claude 3.5 Sonnet',
          provider: SystemProviderIds.gateway
        } as Model

        const result = buildProviderOptions(mockAssistant, anthropicModel, gatewayProvider, {
          enableReasoning: false,
          enableWebSearch: false,
          enableGenerateImage: false
        })

        expect(result.providerOptions).toHaveProperty('anthropic')
        expect(result.providerOptions.anthropic).toBeDefined()
      })

      it('should build Google options for Gemini models through gateway', () => {
        const geminiModel: Model = {
          id: 'google/gemini-2.0-flash-exp',
          name: 'Gemini 2.0 Flash',
          provider: SystemProviderIds.gateway
        } as Model

        const result = buildProviderOptions(mockAssistant, geminiModel, gatewayProvider, {
          enableReasoning: false,
          enableWebSearch: false,
          enableGenerateImage: false
        })

        expect(result.providerOptions).toHaveProperty('google')
        expect(result.providerOptions.google).toBeDefined()
      })

      it('should build xAI options for Grok models through gateway', () => {
        const grokModel: Model = {
          id: 'xai/grok-2-latest',
          name: 'Grok 2',
          provider: SystemProviderIds.gateway
        } as Model

        const result = buildProviderOptions(mockAssistant, grokModel, gatewayProvider, {
          enableReasoning: false,
          enableWebSearch: false,
          enableGenerateImage: false
        })

        expect(result.providerOptions).toHaveProperty('xai')
        expect(result.providerOptions.xai).toBeDefined()
      })

      it('should include reasoning parameters for Anthropic models when enabled', () => {
        const anthropicModel: Model = {
          id: 'anthropic/claude-3-5-sonnet-20241022',
          name: 'Claude 3.5 Sonnet',
          provider: SystemProviderIds.gateway
        } as Model

        const result = buildProviderOptions(mockAssistant, anthropicModel, gatewayProvider, {
          enableReasoning: true,
          enableWebSearch: false,
          enableGenerateImage: false
        })

        expect(result.providerOptions.anthropic).toHaveProperty('thinking')
        expect(result.providerOptions.anthropic.thinking).toEqual({
          type: 'enabled',
          budgetTokens: 5000
        })
      })

      it('should merge gateway routing options from custom parameters', async () => {
        const { getCustomParameters } = await import('../reasoning')

        vi.mocked(getCustomParameters).mockReturnValue({
          gateway: {
            order: ['vertex', 'anthropic'],
            only: ['vertex', 'anthropic']
          }
        })

        const anthropicModel: Model = {
          id: 'anthropic/claude-3-5-sonnet-20241022',
          name: 'Claude 3.5 Sonnet',
          provider: SystemProviderIds.gateway
        } as Model

        const result = buildProviderOptions(mockAssistant, anthropicModel, gatewayProvider, {
          enableReasoning: false,
          enableWebSearch: false,
          enableGenerateImage: false
        })

        // Should have both anthropic provider options and gateway routing options
        expect(result.providerOptions).toHaveProperty('anthropic')
        expect(result.providerOptions).toHaveProperty('gateway')
        expect(result.providerOptions.gateway).toEqual({
          order: ['vertex', 'anthropic'],
          only: ['vertex', 'anthropic']
        })
      })

      it('should combine provider-specific options with gateway routing options', async () => {
        const { getCustomParameters } = await import('../reasoning')

        vi.mocked(getCustomParameters).mockReturnValue({
          gateway: {
            order: ['openai', 'anthropic']
          }
        })

        const openaiModel: Model = {
          id: 'openai/gpt-4',
          name: 'GPT-4',
          provider: SystemProviderIds.gateway
        } as Model

        const result = buildProviderOptions(mockAssistant, openaiModel, gatewayProvider, {
          enableReasoning: true,
          enableWebSearch: false,
          enableGenerateImage: false
        })

        // Should have OpenAI provider options with reasoning
        expect(result.providerOptions.openai).toBeDefined()
        expect(result.providerOptions.openai).toHaveProperty('reasoningEffort')

        // Should also have gateway routing options
        expect(result.providerOptions.gateway).toBeDefined()
        expect(result.providerOptions.gateway.order).toEqual(['openai', 'anthropic'])
      })

      it('should build generic options for unknown model types through gateway', () => {
        const unknownModel: Model = {
          id: 'unknown-provider/model-name',
          name: 'Unknown Model',
          provider: SystemProviderIds.gateway
        } as Model

        const result = buildProviderOptions(mockAssistant, unknownModel, gatewayProvider, {
          enableReasoning: false,
          enableWebSearch: false,
          enableGenerateImage: false
        })

        expect(result.providerOptions).toHaveProperty('openai-compatible')
        expect(result.providerOptions['openai-compatible']).toBeDefined()
      })
    })
  })
})
