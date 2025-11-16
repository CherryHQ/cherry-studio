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
import {
  agentModelFilter,
  getModelSupportedVerbosity,
  groupQwenModels,
  isAnthropicModel,
  isGeminiModel,
  isGemmaModel,
  isGenerateImageModels,
  isMaxTemperatureOneModel,
  isNotSupportedTextDelta,
  isNotSupportSystemMessageModel,
  isNotSupportTemperatureAndTopP,
  isSupportedFlexServiceTier,
  isSupportedModel,
  isSupportFlexServiceTierModel,
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

describe('model utils', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    embeddingMock.mockReturnValue(false)
    rerankMock.mockReturnValue(false)
    visionMock.mockReturnValue(true)
    textToImageMock.mockReturnValue(false)
    generateImageMock.mockReturnValue(true)
    reasoningMock.mockReturnValue(false)
    openAIWebSearchOnlyMock.mockReturnValue(false)
  })

  it('detects OpenAI LLM models through reasoning and GPT prefix', () => {
    expect(isOpenAILLMModel(undefined as unknown as Model)).toBe(false)
    expect(isOpenAILLMModel(createModel({ id: 'gpt-4o-image' }))).toBe(false)

    reasoningMock.mockReturnValueOnce(true)
    expect(isOpenAILLMModel(createModel({ id: 'o1-preview' }))).toBe(true)

    expect(isOpenAILLMModel(createModel({ id: 'GPT-5-turbo' }))).toBe(true)
  })

  it('detects OpenAI models via GPT prefix or reasoning support', () => {
    expect(isOpenAIModel(createModel({ id: 'gpt-4.1' }))).toBe(true)
    reasoningMock.mockReturnValueOnce(true)
    expect(isOpenAIModel(createModel({ id: 'o3' }))).toBe(true)
  })

  it('evaluates support for flex service tier and alias helper', () => {
    expect(isSupportFlexServiceTierModel(createModel({ id: 'o3' }))).toBe(true)
    expect(isSupportFlexServiceTierModel(createModel({ id: 'o3-mini' }))).toBe(false)
    expect(isSupportFlexServiceTierModel(createModel({ id: 'o4-mini' }))).toBe(true)
    expect(isSupportFlexServiceTierModel(createModel({ id: 'gpt-5-preview' }))).toBe(true)
    expect(isSupportedFlexServiceTier(createModel({ id: 'gpt-4o' }))).toBe(false)
  })

  it('detects verbosity support for GPT-5+ families', () => {
    expect(isSupportVerbosityModel(createModel({ id: 'gpt-5' }))).toBe(true)
    expect(isSupportVerbosityModel(createModel({ id: 'gpt-5-chat' }))).toBe(false)
    expect(isSupportVerbosityModel(createModel({ id: 'gpt-5.1-preview' }))).toBe(true)
  })

  it('limits verbosity controls for GPT-5 Pro models', () => {
    const proModel = createModel({ id: 'gpt-5-pro' })
    const previewModel = createModel({ id: 'gpt-5-preview' })
    expect(getModelSupportedVerbosity(proModel)).toEqual(['high'])
    expect(getModelSupportedVerbosity(previewModel)).toEqual(['low', 'medium', 'high'])
    expect(isGPT5ProModel(proModel)).toBe(true)
    expect(isGPT5ProModel(previewModel)).toBe(false)
  })

  it('identifies OpenAI chat-completion-only models', () => {
    expect(isOpenAIChatCompletionOnlyModel(createModel({ id: 'gpt-4o-search-preview' }))).toBe(true)
    expect(isOpenAIChatCompletionOnlyModel(createModel({ id: 'o1-mini' }))).toBe(true)
    expect(isOpenAIChatCompletionOnlyModel(createModel({ id: 'gpt-4o' }))).toBe(false)
  })

  it('filters unsupported OpenAI catalog entries', () => {
    expect(isSupportedModel({ id: 'gpt-4', object: 'model' } as any)).toBe(true)
    expect(isSupportedModel({ id: 'tts-1', object: 'model' } as any)).toBe(false)
  })

  it('calculates temperature/top-p support correctly', () => {
    const model = createModel({ id: 'o1' })
    reasoningMock.mockReturnValue(true)
    expect(isNotSupportTemperatureAndTopP(model)).toBe(true)

    const openWeight = createModel({ id: 'gpt-oss-debug' })
    expect(isNotSupportTemperatureAndTopP(openWeight)).toBe(false)

    const chatOnly = createModel({ id: 'o1-preview' })
    reasoningMock.mockReturnValue(false)
    expect(isNotSupportTemperatureAndTopP(chatOnly)).toBe(true)

    const qwenMt = createModel({ id: 'qwen-mt-large', provider: 'aliyun' })
    expect(isNotSupportTemperatureAndTopP(qwenMt)).toBe(true)
  })

  it('handles gemma and gemini detections plus zhipu tagging', () => {
    expect(isGemmaModel(createModel({ id: 'Gemma-3-27B' }))).toBe(true)
    expect(isGemmaModel(createModel({ group: 'Gemma' }))).toBe(true)
    expect(isGemmaModel(createModel({ id: 'gpt-4o' }))).toBe(false)

    expect(isGeminiModel(createModel({ id: 'Gemini-2.0' }))).toBe(true)

    expect(isZhipuModel(createModel({ provider: 'zhipu' }))).toBe(true)
    expect(isZhipuModel(createModel({ provider: 'openai' }))).toBe(false)
  })

  it('groups qwen models by prefix', () => {
    const qwen = createModel({ id: 'Qwen-7B', provider: 'qwen', name: 'Qwen-7B' })
    const qwenOmni = createModel({ id: 'qwen2.5-omni', name: 'qwen2.5-omni' })
    const other = createModel({ id: 'deepseek-v3', group: 'DeepSeek' })

    const grouped = groupQwenModels([qwen, qwenOmni, other])
    expect(Object.keys(grouped)).toContain('qwen-7b')
    expect(Object.keys(grouped)).toContain('qwen2.5')
    expect(grouped.DeepSeek).toContain(other)
  })

  it('aggregates boolean helpers based on regex rules', () => {
    expect(isAnthropicModel(createModel({ id: 'claude-3.5' }))).toBe(true)
    expect(isQwenMTModel(createModel({ id: 'qwen-mt-large' }))).toBe(true)
    expect(isNotSupportedTextDelta(createModel({ id: 'qwen-mt-large' }))).toBe(true)
    expect(isNotSupportSystemMessageModel(createModel({ id: 'gemma-moe' }))).toBe(true)
    expect(isOpenAIOpenWeightModel(createModel({ id: 'gpt-oss-free' }))).toBe(true)
  })

  it('evaluates GPT-5 family helpers', () => {
    expect(isGPT5SeriesModel(createModel({ id: 'gpt-5-preview' }))).toBe(true)
    expect(isGPT5SeriesModel(createModel({ id: 'gpt-5.1-preview' }))).toBe(false)
    expect(isGPT51SeriesModel(createModel({ id: 'gpt-5.1-mini' }))).toBe(true)
    expect(isGPT5SeriesReasoningModel(createModel({ id: 'gpt-5-prompt' }))).toBe(true)
    expect(isSupportVerbosityModel(createModel({ id: 'gpt-5-chat' }))).toBe(false)
  })

  it('wraps generate/vision helpers that operate on arrays', () => {
    const models = [createModel({ id: 'gpt-4o' }), createModel({ id: 'gpt-4o-mini' })]
    expect(isVisionModels(models)).toBe(true)
    visionMock.mockReturnValueOnce(true).mockReturnValueOnce(false)
    expect(isVisionModels(models)).toBe(false)

    expect(isGenerateImageModels(models)).toBe(true)
    generateImageMock.mockReturnValueOnce(true).mockReturnValueOnce(false)
    expect(isGenerateImageModels(models)).toBe(false)
  })

  it('filters models for agent usage', () => {
    expect(agentModelFilter(createModel())).toBe(true)

    embeddingMock.mockReturnValueOnce(true)
    expect(agentModelFilter(createModel({ id: 'text-embedding' }))).toBe(false)

    embeddingMock.mockReturnValue(false)
    rerankMock.mockReturnValueOnce(true)
    expect(agentModelFilter(createModel({ id: 'rerank' }))).toBe(false)

    rerankMock.mockReturnValue(false)
    textToImageMock.mockReturnValueOnce(true)
    expect(agentModelFilter(createModel({ id: 'gpt-image-1' }))).toBe(false)
  })

  it('identifies models with maximum temperature of 1.0', () => {
    // Zhipu models should have max temperature of 1.0
    expect(isMaxTemperatureOneModel(createModel({ id: 'glm-4' }))).toBe(true)
    expect(isMaxTemperatureOneModel(createModel({ id: 'GLM-4-Plus' }))).toBe(true)
    expect(isMaxTemperatureOneModel(createModel({ id: 'glm-3-turbo' }))).toBe(true)

    // Anthropic models should have max temperature of 1.0
    expect(isMaxTemperatureOneModel(createModel({ id: 'claude-3.5-sonnet' }))).toBe(true)
    expect(isMaxTemperatureOneModel(createModel({ id: 'Claude-3-opus' }))).toBe(true)
    expect(isMaxTemperatureOneModel(createModel({ id: 'claude-2.1' }))).toBe(true)

    // Moonshot models should have max temperature of 1.0
    expect(isMaxTemperatureOneModel(createModel({ id: 'moonshot-1.0' }))).toBe(true)
    expect(isMaxTemperatureOneModel(createModel({ id: 'kimi-k2-thinking' }))).toBe(true)
    expect(isMaxTemperatureOneModel(createModel({ id: 'Moonshot-Pro' }))).toBe(true)

    // Other models should return false
    expect(isMaxTemperatureOneModel(createModel({ id: 'gpt-4o' }))).toBe(false)
    expect(isMaxTemperatureOneModel(createModel({ id: 'gpt-4-turbo' }))).toBe(false)
    expect(isMaxTemperatureOneModel(createModel({ id: 'qwen-max' }))).toBe(false)
    expect(isMaxTemperatureOneModel(createModel({ id: 'gemini-pro' }))).toBe(false)
  })
})
