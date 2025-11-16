import type { Model } from '@renderer/types'
import { SystemProviderIds } from '@renderer/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  isHunyuanSearchModel,
  isMandatoryWebSearchModel,
  isOpenAIDeepResearchModel,
  isOpenAIWebSearchChatCompletionOnlyModel,
  isOpenAIWebSearchModel,
  isOpenRouterBuiltInWebSearchModel,
  isWebSearchModel
} from '../websearch'

const getProviderByModel = vi.hoisted(() => vi.fn())
vi.mock('@renderer/services/AssistantService', () => ({
  getProviderByModel
}))

const isEmbeddingModel = vi.hoisted(() => vi.fn())
const isRerankModel = vi.hoisted(() => vi.fn())
vi.mock('../embedding', () => ({
  isEmbeddingModel: (...args: any[]) => isEmbeddingModel(...args),
  isRerankModel: (...args: any[]) => isRerankModel(...args)
}))

const isPureGenerateImageModel = vi.hoisted(() => vi.fn())
const isTextToImageModel = vi.hoisted(() => vi.fn())
const isGenerateImageModel = vi.hoisted(() => vi.fn())
vi.mock('../vision', () => ({
  isPureGenerateImageModel: (...args: any[]) => isPureGenerateImageModel(...args),
  isTextToImageModel: (...args: any[]) => isTextToImageModel(...args),
  isGenerateImageModel: (...args: any[]) => isGenerateImageModel(...args)
}))

const providerMocks = vi.hoisted(() => ({
  isGeminiProvider: vi.fn(),
  isNewApiProvider: vi.fn(),
  isOpenAICompatibleProvider: vi.fn(),
  isOpenAIProvider: vi.fn()
}))
vi.mock('../../providers', () => providerMocks)

vi.mock('@renderer/hooks/useStore', () => ({
  getStoreProviders: vi.fn(() => [])
}))

vi.mock('@renderer/store', () => ({
  __esModule: true,
  default: {
    getState: () => ({
      llm: { providers: [] },
      settings: {}
    })
  },
  useAppDispatch: vi.fn(),
  useAppSelector: vi.fn()
}))

vi.mock('@renderer/store/settings', () => {
  const noop = vi.fn()
  return new Proxy(
    {},
    {
      get: (_target, prop) => {
        if (prop === 'initialState') {
          return {}
        }
        return noop
      }
    }
  )
})

vi.mock('@renderer/hooks/useSettings', () => ({
  useSettings: vi.fn(() => ({})),
  useNavbarPosition: vi.fn(() => ({ navbarPosition: 'left' })),
  useMessageStyle: vi.fn(() => ({ isBubbleStyle: false })),
  getStoreSetting: vi.fn()
}))

const createModel = (overrides: Partial<Model> = {}): Model => ({
  id: 'gpt-4o',
  name: 'gpt-4o',
  provider: 'openai',
  group: 'OpenAI',
  ...overrides
})

const resetMocks = () => {
  getProviderByModel.mockReturnValue({ id: 'openai', type: 'openai-response' })
  isEmbeddingModel.mockReturnValue(false)
  isRerankModel.mockReturnValue(false)
  isPureGenerateImageModel.mockReturnValue(false)
  isTextToImageModel.mockReturnValue(false)
  providerMocks.isGeminiProvider.mockReturnValue(false)
  providerMocks.isNewApiProvider.mockReturnValue(false)
  providerMocks.isOpenAICompatibleProvider.mockReturnValue(false)
  providerMocks.isOpenAIProvider.mockReturnValue(false)
}

describe('websearch helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetMocks()
  })

  describe('isOpenAIDeepResearchModel', () => {
    it('detects deep research ids for OpenAI only', () => {
      expect(isOpenAIDeepResearchModel(createModel({ id: 'openai/deep-research-preview' }))).toBe(true)
      expect(isOpenAIDeepResearchModel(createModel({ provider: 'openai', id: 'gpt-4o' }))).toBe(false)
      expect(isOpenAIDeepResearchModel(createModel({ provider: 'openrouter', id: 'deep-research' }))).toBe(false)
    })
  })

  describe('isWebSearchModel', () => {
    it('returns false for embedding/rerank/image models', () => {
      isEmbeddingModel.mockReturnValueOnce(true)
      expect(isWebSearchModel(createModel())).toBe(false)

      resetMocks()
      isRerankModel.mockReturnValueOnce(true)
      expect(isWebSearchModel(createModel())).toBe(false)

      resetMocks()
      isTextToImageModel.mockReturnValueOnce(true)
      expect(isWebSearchModel(createModel())).toBe(false)
    })

    it('honors user overrides', () => {
      const enabled = createModel({ capabilities: [{ type: 'web_search', isUserSelected: true }] })
      expect(isWebSearchModel(enabled)).toBe(true)

      const disabled = createModel({ capabilities: [{ type: 'web_search', isUserSelected: false }] })
      expect(isWebSearchModel(disabled)).toBe(false)
    })

    it('returns false when provider lookup fails', () => {
      getProviderByModel.mockReturnValueOnce(undefined)
      expect(isWebSearchModel(createModel())).toBe(false)
    })

    it('handles Anthropic providers on unsupported platforms', () => {
      getProviderByModel.mockReturnValueOnce({ id: SystemProviderIds['aws-bedrock'] })
      const model = createModel({ id: 'claude-2-sonnet' })
      expect(isWebSearchModel(model)).toBe(false)
    })

    it('returns true for first-party Anthropic provider', () => {
      getProviderByModel.mockReturnValueOnce({ id: 'anthropic' })
      const model = createModel({ id: 'claude-3.5-sonnet-latest', provider: 'anthropic' })
      expect(isWebSearchModel(model)).toBe(true)
    })

    it('detects OpenAI preview search models only when supported', () => {
      providerMocks.isOpenAIProvider.mockReturnValue(true)
      const model = createModel({ id: 'gpt-4o-search-preview' })
      expect(isWebSearchModel(model)).toBe(true)

      const nonSearch = createModel({ id: 'gpt-4o-image' })
      expect(isWebSearchModel(nonSearch)).toBe(false)
    })

    it('supports Perplexity sonar families including mandatory variants', () => {
      getProviderByModel.mockReturnValueOnce({ id: SystemProviderIds.perplexity })
      expect(isWebSearchModel(createModel({ id: 'sonar-deep-research' }))).toBe(true)
    })

    it('handles AIHubMix Gemini and OpenAI search models', () => {
      getProviderByModel.mockReturnValueOnce({ id: SystemProviderIds.aihubmix })
      expect(isWebSearchModel(createModel({ id: 'gemini-2.5-pro-preview' }))).toBe(true)

      getProviderByModel.mockReturnValueOnce({ id: SystemProviderIds.aihubmix })
      const openaiSearch = createModel({ id: 'gpt-4o-search-preview' })
      expect(isWebSearchModel(openaiSearch)).toBe(true)
    })

    it('supports OpenAI-compatible or new API providers for Gemini/OpenAI models', () => {
      const model = createModel({ id: 'gemini-2.5-flash-lite-latest' })
      getProviderByModel.mockReturnValueOnce({ id: 'custom' })
      providerMocks.isOpenAICompatibleProvider.mockReturnValueOnce(true)
      expect(isWebSearchModel(model)).toBe(true)

      resetMocks()
      getProviderByModel.mockReturnValueOnce({ id: 'custom' })
      providerMocks.isNewApiProvider.mockReturnValueOnce(true)
      expect(isWebSearchModel(createModel({ id: 'gpt-4o-search-preview' }))).toBe(true)
    })

    it('falls back to Gemini/Vertex provider regex matching', () => {
      getProviderByModel.mockReturnValueOnce({ id: SystemProviderIds.vertexai })
      providerMocks.isGeminiProvider.mockReturnValueOnce(true)
      expect(isWebSearchModel(createModel({ id: 'gemini-2.0-flash-latest' }))).toBe(true)
    })

    it('evaluates hunyuan/zhipu/dashscope/openrouter/grok providers', () => {
      getProviderByModel.mockReturnValueOnce({ id: 'hunyuan' })
      expect(isWebSearchModel(createModel({ id: 'hunyuan-pro' }))).toBe(true)
      expect(isWebSearchModel(createModel({ id: 'hunyuan-lite', provider: 'hunyuan' }))).toBe(false)

      getProviderByModel.mockReturnValueOnce({ id: 'zhipu' })
      expect(isWebSearchModel(createModel({ id: 'glm-4-air' }))).toBe(true)

      getProviderByModel.mockReturnValueOnce({ id: 'dashscope' })
      expect(isWebSearchModel(createModel({ id: 'qwen-max-latest' }))).toBe(true)

      getProviderByModel.mockReturnValueOnce({ id: 'openrouter' })
      expect(isWebSearchModel(createModel())).toBe(true)

      getProviderByModel.mockReturnValueOnce({ id: 'grok' })
      expect(isWebSearchModel(createModel({ id: 'grok-2' }))).toBe(true)
    })
  })

  describe('isMandatoryWebSearchModel', () => {
    it('requires sonar ids for perplexity/openrouter providers', () => {
      getProviderByModel.mockReturnValueOnce({ id: SystemProviderIds.perplexity })
      expect(isMandatoryWebSearchModel(createModel({ id: 'sonar-pro' }))).toBe(true)

      getProviderByModel.mockReturnValueOnce({ id: SystemProviderIds.openrouter })
      expect(isMandatoryWebSearchModel(createModel({ id: 'sonar-reasoning' }))).toBe(true)

      getProviderByModel.mockReturnValueOnce({ id: 'openai' })
      expect(isMandatoryWebSearchModel(createModel({ id: 'sonar-pro' }))).toBe(false)
    })

    it.each([
      ['perplexity', 'non-sonar'],
      ['openrouter', 'gpt-4o-search-preview']
    ])('returns false for %s provider when id is %s', (providerId, modelId) => {
      getProviderByModel.mockReturnValueOnce({ id: providerId })
      expect(isMandatoryWebSearchModel(createModel({ id: modelId }))).toBe(false)
    })
  })

  describe('isOpenRouterBuiltInWebSearchModel', () => {
    it('checks for sonar ids or OpenAI chat-completion-only variants', () => {
      getProviderByModel.mockReturnValueOnce({ id: 'openrouter' })
      expect(isOpenRouterBuiltInWebSearchModel(createModel({ id: 'sonar-reasoning' }))).toBe(true)

      getProviderByModel.mockReturnValueOnce({ id: 'openrouter' })
      expect(isOpenRouterBuiltInWebSearchModel(createModel({ id: 'gpt-4o-search-preview' }))).toBe(true)

      getProviderByModel.mockReturnValueOnce({ id: 'custom' })
      expect(isOpenRouterBuiltInWebSearchModel(createModel({ id: 'sonar-reasoning' }))).toBe(false)
    })
  })

  describe('OpenAI web search helpers', () => {
    it('detects chat completion only variants and openai search ids', () => {
      expect(isOpenAIWebSearchChatCompletionOnlyModel(createModel({ id: 'gpt-4o-search-preview' }))).toBe(true)
      expect(isOpenAIWebSearchChatCompletionOnlyModel(createModel({ id: 'gpt-4o-mini-search-preview' }))).toBe(true)
      expect(isOpenAIWebSearchChatCompletionOnlyModel(createModel({ id: 'gpt-4o' }))).toBe(false)

      expect(isOpenAIWebSearchModel(createModel({ id: 'gpt-4.1-turbo' }))).toBe(true)
      expect(isOpenAIWebSearchModel(createModel({ id: 'gpt-4o-image' }))).toBe(false)
      expect(isOpenAIWebSearchModel(createModel({ id: 'gpt-5.1-chat' }))).toBe(false)
      expect(isOpenAIWebSearchModel(createModel({ id: 'o3-mini' }))).toBe(true)
    })

    it.each(['gpt-4.1-preview', 'gpt-4o-2024-05-13', 'o4-mini', 'gpt-5-explorer'])(
      'treats %s as an OpenAI web search model',
      (id) => {
        expect(isOpenAIWebSearchModel(createModel({ id }))).toBe(true)
      }
    )

    it.each(['gpt-4o-image-preview', 'gpt-4.1-nano', 'gpt-5.1-chat', 'gpt-image-1'])(
      'excludes %s from OpenAI web search',
      (id) => {
        expect(isOpenAIWebSearchModel(createModel({ id }))).toBe(false)
      }
    )

    it.each(['gpt-4o-search-preview', 'gpt-4o-mini-search-preview'])('flags %s as chat-completion-only', (id) => {
      expect(isOpenAIWebSearchChatCompletionOnlyModel(createModel({ id }))).toBe(true)
    })
  })

  describe('isHunyuanSearchModel', () => {
    it('identifies hunyuan models except lite', () => {
      expect(isHunyuanSearchModel(createModel({ id: 'hunyuan-pro', provider: 'hunyuan' }))).toBe(true)
      expect(isHunyuanSearchModel(createModel({ id: 'hunyuan-lite', provider: 'hunyuan' }))).toBe(false)
      expect(isHunyuanSearchModel(createModel())).toBe(false)
    })

    it.each(['hunyuan-standard', 'hunyuan-advanced'])('accepts %s', (suffix) => {
      expect(isHunyuanSearchModel(createModel({ id: suffix, provider: 'hunyuan' }))).toBe(true)
    })
  })

  describe('provider-specific regex coverage', () => {
    it.each(['qwen-turbo', 'qwen-max-0919', 'qwen3-max', 'qwen-plus-2024', 'qwq-32b'])(
      'dashscope treats %s as searchable',
      (id) => {
        getProviderByModel.mockReturnValue({ id: 'dashscope' })
        expect(isWebSearchModel(createModel({ id }))).toBe(true)
      }
    )

    it.each(['qwen-1.5-chat', 'custom-model'])('dashscope ignores %s', (id) => {
      getProviderByModel.mockReturnValue({ id: 'dashscope' })
      expect(isWebSearchModel(createModel({ id }))).toBe(false)
    })

    it.each(['sonar', 'sonar-pro', 'sonar-reasoning-pro', 'sonar-deep-research'])(
      'perplexity provider supports %s',
      (id) => {
        getProviderByModel.mockReturnValue({ id: SystemProviderIds.perplexity })
        expect(isWebSearchModel(createModel({ id }))).toBe(true)
      }
    )

    it.each([
      'gemini-2.0-flash-latest',
      'gemini-2.5-flash-lite-latest',
      'gemini-flash-lite-latest',
      'gemini-pro-latest'
    ])('Gemini provider supports %s', (id) => {
      getProviderByModel.mockReturnValue({ id: SystemProviderIds.vertexai })
      providerMocks.isGeminiProvider.mockReturnValue(true)
      expect(isWebSearchModel(createModel({ id }))).toBe(true)
    })
  })
})
