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
        const customProviders = ['google-vertex', 'google-vertex-anthropic', 'bedrock']
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
      [SystemProviderIds.openrouter]: 'openrouter'
    }
    return mapping[provider.id] || provider.id
  })
}))

vi.mock('@renderer/config/models', () => ({
  isOpenAIModel: vi.fn((model) => model.id.includes('gpt') || model.id.includes('o1')),
  isQwenMTModel: vi.fn(() => false),
  isSupportFlexServiceTierModel: vi.fn(() => true)
}))

vi.mock('@renderer/config/providers', () => ({
  isSupportServiceTierProvider: vi.fn((provider) => {
    return [SystemProviderIds.openai, SystemProviderIds.groq].includes(provider.id)
  })
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
  getCustomParameters: vi.fn(() => ({}))
}))

vi.mock('../image', () => ({
  buildGeminiGenerateImageParams: vi.fn(() => ({
    responseModalities: ['TEXT', 'IMAGE']
  }))
}))

vi.mock('../websearch', () => ({
  getWebSearchParams: vi.fn(() => ({ enable_search: true }))
}))

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

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('buildProviderOptions', () => {
    describe('OpenAI provider', () => {
      const openaiProvider: Provider = {
        id: SystemProviderIds.openai,
        name: 'OpenAI',
        type: 'openai',
        apiKey: 'test-key',
        apiHost: 'https://api.openai.com/v1'
      } as Provider

      it('should build basic OpenAI options', () => {
        const result = buildProviderOptions(mockAssistant, mockModel, openaiProvider, {
          enableReasoning: false,
          enableWebSearch: false,
          enableGenerateImage: false
        })

        expect(result).toHaveProperty('openai')
        expect(result.openai).toBeDefined()
      })

      it('should include reasoning parameters when enabled', () => {
        const result = buildProviderOptions(mockAssistant, mockModel, openaiProvider, {
          enableReasoning: true,
          enableWebSearch: false,
          enableGenerateImage: false
        })

        expect(result.openai).toHaveProperty('reasoningEffort')
        expect(result.openai.reasoningEffort).toBe('medium')
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

        expect(result.openai).toHaveProperty('serviceTier')
        expect(result.openai.serviceTier).toBe(OpenAIServiceTiers.auto)
      })
    })

    describe('Anthropic provider', () => {
      const anthropicProvider: Provider = {
        id: SystemProviderIds.anthropic,
        name: 'Anthropic',
        type: 'anthropic',
        apiKey: 'test-key',
        apiHost: 'https://api.anthropic.com'
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

        expect(result).toHaveProperty('anthropic')
        expect(result.anthropic).toBeDefined()
      })

      it('should include reasoning parameters when enabled', () => {
        const result = buildProviderOptions(mockAssistant, anthropicModel, anthropicProvider, {
          enableReasoning: true,
          enableWebSearch: false,
          enableGenerateImage: false
        })

        expect(result.anthropic).toHaveProperty('thinking')
        expect(result.anthropic.thinking).toEqual({
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

        expect(result).toHaveProperty('google')
        expect(result.google).toBeDefined()
      })

      it('should include reasoning parameters when enabled', () => {
        const result = buildProviderOptions(mockAssistant, googleModel, googleProvider, {
          enableReasoning: true,
          enableWebSearch: false,
          enableGenerateImage: false
        })

        expect(result.google).toHaveProperty('thinkingConfig')
        expect(result.google.thinkingConfig).toEqual({
          include_thoughts: true
        })
      })

      it('should include image generation parameters when enabled', () => {
        const result = buildProviderOptions(mockAssistant, googleModel, googleProvider, {
          enableReasoning: false,
          enableWebSearch: false,
          enableGenerateImage: true
        })

        expect(result.google).toHaveProperty('responseModalities')
        expect(result.google.responseModalities).toEqual(['TEXT', 'IMAGE'])
      })
    })

    describe('xAI provider', () => {
      const xaiProvider = {
        id: SystemProviderIds.grok,
        name: 'xAI',
        type: 'new-api',
        apiKey: 'test-key',
        apiHost: 'https://api.x.ai/v1',
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

        expect(result).toHaveProperty('xai')
        expect(result.xai).toBeDefined()
      })

      it('should include reasoning parameters when enabled', () => {
        const result = buildProviderOptions(mockAssistant, xaiModel, xaiProvider, {
          enableReasoning: true,
          enableWebSearch: false,
          enableGenerateImage: false
        })

        expect(result.xai).toHaveProperty('reasoningEffort')
        expect(result.xai.reasoningEffort).toBe('high')
      })
    })

    describe('DeepSeek provider', () => {
      const deepseekProvider: Provider = {
        id: SystemProviderIds.deepseek,
        name: 'DeepSeek',
        type: 'openai',
        apiKey: 'test-key',
        apiHost: 'https://api.deepseek.com'
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

        expect(result).toHaveProperty('deepseek')
        expect(result.deepseek).toBeDefined()
      })
    })

    describe('OpenRouter provider', () => {
      const openrouterProvider: Provider = {
        id: SystemProviderIds.openrouter,
        name: 'OpenRouter',
        type: 'openai',
        apiKey: 'test-key',
        apiHost: 'https://openrouter.ai/api/v1'
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

        expect(result).toHaveProperty('openrouter')
        expect(result.openrouter).toBeDefined()
      })

      it('should include web search parameters when enabled', () => {
        const result = buildProviderOptions(mockAssistant, openrouterModel, openrouterProvider, {
          enableReasoning: false,
          enableWebSearch: true,
          enableGenerateImage: false
        })

        expect(result.openrouter).toHaveProperty('enable_search')
      })
    })

    describe('Custom parameters', () => {
      it('should merge custom parameters', async () => {
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

        expect(result.openai).toHaveProperty('custom_param')
        expect(result.openai.custom_param).toBe('custom_value')
        expect(result.openai).toHaveProperty('another_param')
        expect(result.openai.another_param).toBe(123)
      })
    })

    describe('Multiple capabilities', () => {
      const googleProvider = {
        id: SystemProviderIds.gemini,
        name: 'Google',
        type: 'gemini',
        apiKey: 'test-key',
        apiHost: 'https://generativelanguage.googleapis.com',
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

        expect(result.google).toHaveProperty('thinkingConfig')
        expect(result.google).toHaveProperty('responseModalities')
      })

      it('should handle all capabilities enabled', () => {
        const result = buildProviderOptions(mockAssistant, googleModel, googleProvider, {
          enableReasoning: true,
          enableWebSearch: true,
          enableGenerateImage: true
        })

        expect(result.google).toBeDefined()
        expect(Object.keys(result.google).length).toBeGreaterThan(0)
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

        expect(result).toHaveProperty('google')
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

        expect(result).toHaveProperty('anthropic')
      })
    })
  })
})
