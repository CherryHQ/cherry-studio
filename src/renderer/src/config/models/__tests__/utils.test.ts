import { isEmbeddingModel, isRerankModel } from '@renderer/config/models/embedding'
import type { Model } from '@renderer/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  isGPT5ProModel,
  isGPT5SeriesModel,
  isGPT5SeriesReasoningModel,
  isGPT51SeriesModel,
  isOpenAIChatCompletionOnlyModel,
  isOpenAILLMModel,
  isOpenAIModel,
  isOpenAIOpenWeightModel,
  isOpenAIReasoningModel,
  isSupportVerbosityModel
} from '../openai'
import { isQwenMTModel } from '../qwen'
import { isFunctionCallingModel } from '../tooluse'
import {
  agentModelFilter,
  getModelSupportedVerbosity,
  groupQwenModels,
  isAnthropicModel,
  isGeminiModel,
  isGemmaModel,
  isGenerateImageModels,
  isMaxTemperatureOneModel,
  isNotSupportSystemMessageModel,
  isNotSupportTextDeltaModel,
  isSupportedFlexServiceTier,
  isSupportedModel,
  isSupportFlexServiceTierModel,
  isSupportTemperatureModel,
  isSupportTopPModel,
  isTemperatureTopPMutuallyExclusiveModel,
  isVisionModels,
  isZhipuModel
} from '../utils'
import { isGenerateImageModel, isTextToImageModel, isVisionModel } from '../vision'
import { isOpenAIWebSearchChatCompletionOnlyModel } from '../websearch'

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

vi.mock('@renderer/i18n', () => ({
  __esModule: true,
  default: {
    t: vi.fn((key: string) => key)
  }
}))

vi.mock('@renderer/services/AssistantService', () => ({
  getProviderByModel: vi.fn().mockReturnValue({
    id: 'openai',
    type: 'openai',
    name: 'OpenAI',
    models: []
  }),
  getAssistantSettings: vi.fn(),
  getDefaultAssistant: vi.fn().mockReturnValue({
    id: 'default',
    name: 'Default Assistant',
    prompt: '',
    settings: {}
  })
}))

vi.mock('@renderer/hooks/useSettings', () => ({
  useSettings: vi.fn(() => ({})),
  useNavbarPosition: vi.fn(() => ({ navbarPosition: 'left' })),
  useMessageStyle: vi.fn(() => ({ isBubbleStyle: false })),
  getStoreSetting: vi.fn()
}))

vi.mock('@renderer/config/models/embedding', () => ({
  isEmbeddingModel: vi.fn(),
  isRerankModel: vi.fn()
}))

vi.mock('../vision', () => ({
  isGenerateImageModel: vi.fn(),
  isTextToImageModel: vi.fn(),
  isVisionModel: vi.fn()
}))

vi.mock(import('../openai'), async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    isOpenAIReasoningModel: vi.fn()
  }
})

vi.mock('../websearch', () => ({
  isOpenAIWebSearchChatCompletionOnlyModel: vi.fn()
}))

vi.mock('../tooluse', () => ({
  isFunctionCallingModel: vi.fn()
}))

const createModel = (overrides: Partial<Model> = {}): Model => ({
  id: 'gpt-4o',
  name: 'gpt-4o',
  provider: 'openai',
  group: 'OpenAI',
  ...overrides
})

const embeddingMock = vi.mocked(isEmbeddingModel)
const rerankMock = vi.mocked(isRerankModel)
const visionMock = vi.mocked(isVisionModel)
const textToImageMock = vi.mocked(isTextToImageModel)
const generateImageMock = vi.mocked(isGenerateImageModel)
const reasoningMock = vi.mocked(isOpenAIReasoningModel)
const openAIWebSearchOnlyMock = vi.mocked(isOpenAIWebSearchChatCompletionOnlyModel)
const isFunctionCallingModelMock = vi.mocked(isFunctionCallingModel)

describe('model utils', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    embeddingMock.mockReturnValue(false)
    rerankMock.mockReturnValue(false)
    visionMock.mockReturnValue(true)
    textToImageMock.mockReturnValue(false)
    generateImageMock.mockReturnValue(false)
    reasoningMock.mockReturnValue(false)
    openAIWebSearchOnlyMock.mockReturnValue(false)
    isFunctionCallingModelMock.mockReturnValue(true)
  })

  describe('OpenAI model detection', () => {
    describe('isOpenAILLMModel', () => {
      it('returns false for undefined model', () => {
        expect(isOpenAILLMModel(undefined as unknown as Model)).toBe(false)
      })

      it('returns false for image generation models', () => {
        expect(isOpenAILLMModel(createModel({ id: 'gpt-4o-image' }))).toBe(false)
      })

      it('returns true for reasoning models', () => {
        reasoningMock.mockReturnValueOnce(true)
        expect(isOpenAILLMModel(createModel({ id: 'o1-preview' }))).toBe(true)
      })

      it('returns true for GPT-prefixed models', () => {
        expect(isOpenAILLMModel(createModel({ id: 'GPT-5-turbo' }))).toBe(true)
      })
    })

    describe('isOpenAIModel', () => {
      it('detects models via GPT prefix', () => {
        expect(isOpenAIModel(createModel({ id: 'gpt-4.1' }))).toBe(true)
      })

      it('detects models via reasoning support', () => {
        reasoningMock.mockReturnValueOnce(true)
        expect(isOpenAIModel(createModel({ id: 'o3' }))).toBe(true)
      })
    })

    describe('isOpenAIChatCompletionOnlyModel', () => {
      it('identifies chat-completion-only models', () => {
        expect(isOpenAIChatCompletionOnlyModel(createModel({ id: 'gpt-4o-search-preview' }))).toBe(true)
        expect(isOpenAIChatCompletionOnlyModel(createModel({ id: 'o1-mini' }))).toBe(true)
      })

      it('returns false for general models', () => {
        expect(isOpenAIChatCompletionOnlyModel(createModel({ id: 'gpt-4o' }))).toBe(false)
      })
    })
  })

  describe('GPT-5 family detection', () => {
    describe('isGPT5SeriesModel', () => {
      it('returns true for GPT-5 models', () => {
        expect(isGPT5SeriesModel(createModel({ id: 'gpt-5-preview' }))).toBe(true)
      })

      it('returns false for GPT-5.1 models', () => {
        expect(isGPT5SeriesModel(createModel({ id: 'gpt-5.1-preview' }))).toBe(false)
      })
    })

    describe('isGPT51SeriesModel', () => {
      it('returns true for GPT-5.1 models', () => {
        expect(isGPT51SeriesModel(createModel({ id: 'gpt-5.1-mini' }))).toBe(true)
      })
    })

    describe('isGPT5SeriesReasoningModel', () => {
      it('returns true for GPT-5 reasoning models', () => {
        expect(isGPT5SeriesReasoningModel(createModel({ id: 'gpt-5' }))).toBe(true)
      })
      it('returns false for gpt-5-chat', () => {
        expect(isGPT5SeriesReasoningModel(createModel({ id: 'gpt-5-chat' }))).toBe(false)
      })
    })

    describe('isGPT5ProModel', () => {
      it('returns true for GPT-5 Pro models', () => {
        expect(isGPT5ProModel(createModel({ id: 'gpt-5-pro' }))).toBe(true)
      })

      it('returns false for non-Pro GPT-5 models', () => {
        expect(isGPT5ProModel(createModel({ id: 'gpt-5-preview' }))).toBe(false)
      })
    })
  })

  describe('Verbosity support', () => {
    describe('isSupportVerbosityModel', () => {
      it('returns true for GPT-5 models', () => {
        expect(isSupportVerbosityModel(createModel({ id: 'gpt-5' }))).toBe(true)
      })

      it('returns false for GPT-5 chat models', () => {
        expect(isSupportVerbosityModel(createModel({ id: 'gpt-5-chat' }))).toBe(false)
      })

      it('returns true for GPT-5.1 models', () => {
        expect(isSupportVerbosityModel(createModel({ id: 'gpt-5.1-preview' }))).toBe(true)
      })
    })

    describe('getModelSupportedVerbosity', () => {
      it('returns only "high" for GPT-5 Pro models', () => {
        expect(getModelSupportedVerbosity(createModel({ id: 'gpt-5-pro' }))).toEqual([undefined, null, 'high'])
        expect(getModelSupportedVerbosity(createModel({ id: 'gpt-5-pro-2025-10-06' }))).toEqual([
          undefined,
          null,
          'high'
        ])
      })

      it('returns all levels for non-Pro GPT-5 models', () => {
        const previewModel = createModel({ id: 'gpt-5-preview' })
        expect(getModelSupportedVerbosity(previewModel)).toEqual([undefined, null, 'low', 'medium', 'high'])
      })

      it('returns all levels for GPT-5.1 models', () => {
        const gpt51Model = createModel({ id: 'gpt-5.1-preview' })
        expect(getModelSupportedVerbosity(gpt51Model)).toEqual([undefined, null, 'low', 'medium', 'high'])
      })

      it('returns only undefined for non-GPT-5 models', () => {
        expect(getModelSupportedVerbosity(createModel({ id: 'gpt-4o' }))).toEqual([undefined])
        expect(getModelSupportedVerbosity(createModel({ id: 'claude-3.5' }))).toEqual([undefined])
      })

      it('returns only undefined for undefiend/null input', () => {
        expect(getModelSupportedVerbosity(undefined)).toEqual([undefined])
        expect(getModelSupportedVerbosity(null)).toEqual([undefined])
      })
    })
  })

  describe('Flex service tier support', () => {
    describe('isSupportFlexServiceTierModel', () => {
      it('returns true for supported models', () => {
        expect(isSupportFlexServiceTierModel(createModel({ id: 'o3' }))).toBe(true)
        expect(isSupportFlexServiceTierModel(createModel({ id: 'o4-mini' }))).toBe(true)
        expect(isSupportFlexServiceTierModel(createModel({ id: 'gpt-5-preview' }))).toBe(true)
      })

      it('returns false for unsupported models', () => {
        expect(isSupportFlexServiceTierModel(createModel({ id: 'o3-mini' }))).toBe(false)
      })
    })

    describe('isSupportedFlexServiceTier', () => {
      it('returns false for non-flex models', () => {
        expect(isSupportedFlexServiceTier(createModel({ id: 'gpt-4o' }))).toBe(false)
      })
    })
  })

  describe('Temperature and top-p support', () => {
    describe('isSupportTemperatureModel', () => {
      it('returns false for reasoning models (non-open weight)', () => {
        const model = createModel({ id: 'o1' })
        reasoningMock.mockReturnValue(true)
        expect(isSupportTemperatureModel(model)).toBe(false)
      })

      it('returns true for open weight models', () => {
        const openWeight = createModel({ id: 'gpt-oss-debug' })
        expect(isSupportTemperatureModel(openWeight)).toBe(true)
      })

      it('returns false for chat-only models', () => {
        const chatOnly = createModel({ id: 'o1-preview' })
        expect(isSupportTemperatureModel(chatOnly)).toBe(false)
      })

      it('returns false for Qwen MT models', () => {
        const qwenMt = createModel({ id: 'qwen-mt-large', provider: 'aliyun' })
        expect(isSupportTemperatureModel(qwenMt)).toBe(false)
      })

      it('returns false for null/undefined models', () => {
        expect(isSupportTemperatureModel(null)).toBe(false)
        expect(isSupportTemperatureModel(undefined)).toBe(false)
      })

      it('returns true for regular GPT models', () => {
        const model = createModel({ id: 'gpt-4' })
        expect(isSupportTemperatureModel(model)).toBe(true)
      })
    })

    describe('isSupportTopPModel', () => {
      it('returns false for reasoning models (non-open weight)', () => {
        const model = createModel({ id: 'o1' })
        reasoningMock.mockReturnValue(true)
        expect(isSupportTopPModel(model)).toBe(false)
      })

      it('returns true for open weight models', () => {
        const openWeight = createModel({ id: 'gpt-oss-debug' })
        expect(isSupportTopPModel(openWeight)).toBe(true)
      })

      it('returns false for chat-only models', () => {
        const chatOnly = createModel({ id: 'o1-preview' })
        expect(isSupportTopPModel(chatOnly)).toBe(false)
      })

      it('returns false for Qwen MT models', () => {
        const qwenMt = createModel({ id: 'qwen-mt-large', provider: 'aliyun' })
        expect(isSupportTopPModel(qwenMt)).toBe(false)
      })

      it('returns false for null/undefined models', () => {
        expect(isSupportTopPModel(null)).toBe(false)
        expect(isSupportTopPModel(undefined)).toBe(false)
      })

      it('returns true for regular GPT models', () => {
        const model = createModel({ id: 'gpt-4' })
        expect(isSupportTopPModel(model)).toBe(true)
      })
    })

    describe('isTemperatureTopPMutuallyExclusiveModel', () => {
      it('returns true for Claude 4.5 reasoning models', () => {
        const claude45Sonnet = createModel({ id: 'claude-sonnet-4.5-20250514' })
        expect(isTemperatureTopPMutuallyExclusiveModel(claude45Sonnet)).toBe(true)

        const claude45Opus = createModel({ id: 'claude-opus-4.5-20250514' })
        expect(isTemperatureTopPMutuallyExclusiveModel(claude45Opus)).toBe(true)
      })

      it('returns false for Claude 4 models', () => {
        const claude4Sonnet = createModel({ id: 'claude-sonnet-4-20250514' })
        expect(isTemperatureTopPMutuallyExclusiveModel(claude4Sonnet)).toBe(false)
      })

      it('returns false for Claude 3.x models', () => {
        const claude35Sonnet = createModel({ id: 'claude-3-5-sonnet-20241022' })
        expect(isTemperatureTopPMutuallyExclusiveModel(claude35Sonnet)).toBe(false)

        const claude3Opus = createModel({ id: 'claude-3-opus-20240229' })
        expect(isTemperatureTopPMutuallyExclusiveModel(claude3Opus)).toBe(false)
      })

      it('returns false for other AI models', () => {
        expect(isTemperatureTopPMutuallyExclusiveModel(createModel({ id: 'gpt-4o' }))).toBe(false)
        expect(isTemperatureTopPMutuallyExclusiveModel(createModel({ id: 'o1' }))).toBe(false)
        expect(isTemperatureTopPMutuallyExclusiveModel(createModel({ id: 'gemini-2.0-flash' }))).toBe(false)
        expect(isTemperatureTopPMutuallyExclusiveModel(createModel({ id: 'qwen-max' }))).toBe(false)
      })

      it('returns false for null/undefined models', () => {
        expect(isTemperatureTopPMutuallyExclusiveModel(null)).toBe(false)
        expect(isTemperatureTopPMutuallyExclusiveModel(undefined)).toBe(false)
      })
    })
  })

  describe('Text delta support', () => {
    describe('isNotSupportTextDeltaModel', () => {
      it('returns true for qwen-mt-turbo and qwen-mt-plus models', () => {
        expect(isNotSupportTextDeltaModel(createModel({ id: 'qwen-mt-turbo' }))).toBe(true)
        expect(isNotSupportTextDeltaModel(createModel({ id: 'qwen-mt-plus' }))).toBe(true)
        expect(isNotSupportTextDeltaModel(createModel({ id: 'Qwen-MT-Turbo' }))).toBe(true)
        expect(isNotSupportTextDeltaModel(createModel({ id: 'QWEN-MT-PLUS' }))).toBe(true)
      })

      it('returns false for qwen-mt-flash and other models', () => {
        expect(isNotSupportTextDeltaModel(createModel({ id: 'qwen-mt-flash' }))).toBe(false)
        expect(isNotSupportTextDeltaModel(createModel({ id: 'Qwen-MT-Flash' }))).toBe(false)
        expect(isNotSupportTextDeltaModel(createModel({ id: 'qwen-turbo' }))).toBe(false)
        expect(isNotSupportTextDeltaModel(createModel({ id: 'qwen-plus' }))).toBe(false)
        expect(isNotSupportTextDeltaModel(createModel({ id: 'qwen-max' }))).toBe(false)
        expect(isNotSupportTextDeltaModel(createModel({ id: 'qwen2.5-72b' }))).toBe(false)
        expect(isNotSupportTextDeltaModel(createModel({ id: 'qwen-vl-plus' }))).toBe(false)
      })

      it('returns false for non-qwen models', () => {
        expect(isNotSupportTextDeltaModel(createModel({ id: 'gpt-4o' }))).toBe(false)
        expect(isNotSupportTextDeltaModel(createModel({ id: 'claude-3.5' }))).toBe(false)
        expect(isNotSupportTextDeltaModel(createModel({ id: 'glm-4-plus' }))).toBe(false)
      })

      it('handles models with version suffixes', () => {
        expect(isNotSupportTextDeltaModel(createModel({ id: 'qwen-mt-turbo-1201' }))).toBe(true)
        expect(isNotSupportTextDeltaModel(createModel({ id: 'qwen-mt-plus-0828' }))).toBe(true)
        expect(isNotSupportTextDeltaModel(createModel({ id: 'qwen-turbo-0828' }))).toBe(false)
        expect(isNotSupportTextDeltaModel(createModel({ id: 'qwen-plus-latest' }))).toBe(false)
      })
    })
  })

  describe('Model provider detection', () => {
    describe('isGemmaModel', () => {
      it('detects Gemma models by ID', () => {
        expect(isGemmaModel(createModel({ id: 'Gemma-3-27B' }))).toBe(true)
      })

      it('detects Gemma models by group', () => {
        expect(isGemmaModel(createModel({ group: 'Gemma' }))).toBe(true)
      })

      it('returns false for non-Gemma models', () => {
        expect(isGemmaModel(createModel({ id: 'gpt-4o' }))).toBe(false)
      })
    })

    describe('isGeminiModel', () => {
      it('detects Gemini models', () => {
        expect(isGeminiModel(createModel({ id: 'Gemini-2.0' }))).toBe(true)
      })
    })

    describe('isZhipuModel', () => {
      it('detects Zhipu models by provider', () => {
        expect(isZhipuModel(createModel({ provider: 'zhipu' }))).toBe(true)
      })

      it('returns false for non-Zhipu models', () => {
        expect(isZhipuModel(createModel({ provider: 'openai' }))).toBe(false)
      })
    })

    describe('isAnthropicModel', () => {
      it('detects Anthropic models', () => {
        expect(isAnthropicModel(createModel({ id: 'claude-3.5' }))).toBe(true)
      })
    })

    describe('isQwenMTModel', () => {
      it('detects Qwen MT models', () => {
        expect(isQwenMTModel(createModel({ id: 'qwen-mt-plus' }))).toBe(true)
      })
    })

    describe('isOpenAIOpenWeightModel', () => {
      it('detects OpenAI open weight models', () => {
        expect(isOpenAIOpenWeightModel(createModel({ id: 'gpt-oss-free' }))).toBe(true)
      })
    })
  })

  describe('System message support', () => {
    describe('isNotSupportSystemMessageModel', () => {
      it('returns true for models that do not support system messages', () => {
        expect(isNotSupportSystemMessageModel(createModel({ id: 'gemma-moe' }))).toBe(true)
      })
    })
  })

  describe('Model grouping', () => {
    describe('groupQwenModels', () => {
      it('groups qwen models by prefix', () => {
        const qwen = createModel({ id: 'Qwen-7B', provider: 'qwen', name: 'Qwen-7B' })
        const qwenOmni = createModel({ id: 'qwen2.5-omni', name: 'qwen2.5-omni' })
        const other = createModel({ id: 'deepseek-v3', group: 'DeepSeek' })

        const grouped = groupQwenModels([qwen, qwenOmni, other])
        expect(Object.keys(grouped)).toContain('qwen-7b')
        expect(Object.keys(grouped)).toContain('qwen2.5')
        expect(grouped.DeepSeek).toContain(other)
      })
    })
  })

  describe('Vision and image generation', () => {
    describe('isVisionModels', () => {
      it('returns true when all models support vision', () => {
        const models = [createModel({ id: 'gpt-4o' }), createModel({ id: 'gpt-4o-mini' })]
        expect(isVisionModels(models)).toBe(true)
      })

      it('returns false when some models do not support vision', () => {
        const models = [createModel({ id: 'gpt-4o' }), createModel({ id: 'gpt-4o-mini' })]
        visionMock.mockReturnValueOnce(true).mockReturnValueOnce(false)
        expect(isVisionModels(models)).toBe(false)
      })
    })

    describe('isGenerateImageModels', () => {
      it('returns true when all models support image generation', () => {
        const models = [createModel({ id: 'gpt-4o' }), createModel({ id: 'gpt-4o-mini' })]
        generateImageMock.mockReturnValue(true)
        expect(isGenerateImageModels(models)).toBe(true)
      })

      it('returns false when some models do not support image generation', () => {
        const models = [createModel({ id: 'gpt-4o' }), createModel({ id: 'gpt-4o-mini' })]
        generateImageMock.mockReturnValueOnce(true).mockReturnValueOnce(false)
        expect(isGenerateImageModels(models)).toBe(false)
      })
    })
  })

  describe('Model filtering', () => {
    describe('isSupportedModel', () => {
      it('filters supported OpenAI catalog entries', () => {
        expect(isSupportedModel({ id: 'gpt-4', object: 'model' } as any)).toBe(true)
      })

      it('filters unsupported OpenAI catalog entries', () => {
        expect(isSupportedModel({ id: 'tts-1', object: 'model' } as any)).toBe(false)
      })
    })

    describe('agentModelFilter', () => {
      it('returns true for regular models', () => {
        expect(agentModelFilter(createModel())).toBe(true)
      })

      it('filters out embedding models', () => {
        embeddingMock.mockReturnValueOnce(true)
        expect(agentModelFilter(createModel({ id: 'text-embedding' }))).toBe(false)
      })

      it('filters out rerank models', () => {
        embeddingMock.mockReturnValue(false)
        rerankMock.mockReturnValueOnce(true)
        expect(agentModelFilter(createModel({ id: 'rerank' }))).toBe(false)
      })

      it('filters out non-function-call models', () => {
        rerankMock.mockReturnValue(false)
        isFunctionCallingModelMock.mockReturnValueOnce(false)
        expect(agentModelFilter(createModel({ id: 'DeepSeek R1' }))).toBe(false)
      })

      it('filters out text-to-image models', () => {
        rerankMock.mockReturnValue(false)
        textToImageMock.mockReturnValueOnce(true)
        expect(agentModelFilter(createModel({ id: 'gpt-image-1' }))).toBe(false)
      })
    })

    textToImageMock.mockReturnValue(false)
    generateImageMock.mockReturnValueOnce(true)
    expect(agentModelFilter(createModel({ id: 'dall-e-3' }))).toBe(false)
  })

  describe('Temperature limits', () => {
    describe('isMaxTemperatureOneModel', () => {
      it('returns true for Zhipu models', () => {
        expect(isMaxTemperatureOneModel(createModel({ id: 'glm-4' }))).toBe(true)
        expect(isMaxTemperatureOneModel(createModel({ id: 'GLM-4-Plus' }))).toBe(true)
        expect(isMaxTemperatureOneModel(createModel({ id: 'glm-3-turbo' }))).toBe(true)
      })

      it('returns true for Anthropic models', () => {
        expect(isMaxTemperatureOneModel(createModel({ id: 'claude-3.5-sonnet' }))).toBe(true)
        expect(isMaxTemperatureOneModel(createModel({ id: 'Claude-3-opus' }))).toBe(true)
        expect(isMaxTemperatureOneModel(createModel({ id: 'claude-2.1' }))).toBe(true)
      })

      it('returns true for Moonshot models', () => {
        expect(isMaxTemperatureOneModel(createModel({ id: 'moonshot-1.0' }))).toBe(true)
        expect(isMaxTemperatureOneModel(createModel({ id: 'kimi-k2-thinking' }))).toBe(true)
        expect(isMaxTemperatureOneModel(createModel({ id: 'Moonshot-Pro' }))).toBe(true)
      })

      it('returns false for other models', () => {
        expect(isMaxTemperatureOneModel(createModel({ id: 'gpt-4o' }))).toBe(false)
        expect(isMaxTemperatureOneModel(createModel({ id: 'gpt-4-turbo' }))).toBe(false)
        expect(isMaxTemperatureOneModel(createModel({ id: 'qwen-max' }))).toBe(false)
        expect(isMaxTemperatureOneModel(createModel({ id: 'gemini-pro' }))).toBe(false)
      })
    })
  })
})
