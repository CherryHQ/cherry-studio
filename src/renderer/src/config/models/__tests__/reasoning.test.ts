import type { Model } from '@renderer/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { isEmbeddingModel, isRerankModel } from '../embedding'
import { isOpenAIReasoningModel, isSupportedReasoningEffortOpenAIModel } from '../openai'
import {
  findTokenLimit,
  getModelSupportedReasoningEffort,
  getThinkModelType,
  isClaude4SeriesModel,
  isClaude45ReasoningModel,
  isClaudeReasoningModel,
  isDeepSeekHybridInferenceModel,
  isDoubaoSeedAfter251015,
  isDoubaoThinkingAutoModel,
  isFixedReasoningModel,
  isGeminiReasoningModel,
  isGrok4FastReasoningModel,
  isHunyuanReasoningModel,
  isLingReasoningModel,
  isMiniMaxReasoningModel,
  isPerplexityReasoningModel,
  isQwenAlwaysThinkModel,
  isReasoningModel,
  isStepReasoningModel,
  isSupportedReasoningEffortGrokModel,
  isSupportedReasoningEffortModel,
  isSupportedReasoningEffortPerplexityModel,
  isSupportedThinkingTokenDoubaoModel,
  isSupportedThinkingTokenGeminiModel,
  isSupportedThinkingTokenModel,
  isSupportedThinkingTokenQwenModel,
  isSupportedThinkingTokenZhipuModel,
  isZhipuReasoningModel,
  MODEL_SUPPORTED_OPTIONS,
  MODEL_SUPPORTED_REASONING_EFFORT
} from '../reasoning'
import { isGemini3ThinkingTokenModel } from '../utils'
import { isTextToImageModel } from '../vision'

vi.mock('@renderer/store', () => ({
  default: {
    getState: () => ({
      llm: {
        settings: {}
      }
    })
  }
}))

// FIXME: Idk why it's imported. Maybe circular dependency somewhere
vi.mock('@renderer/services/AssistantService.ts', () => ({
  getDefaultAssistant: () => {
    return {
      id: 'default',
      name: 'default',
      emoji: '😀',
      prompt: '',
      topics: [],
      messages: [],
      type: 'assistant',
      regularPhrases: [],
      settings: {}
    }
  }
}))

vi.mock('../embedding', () => ({
  isEmbeddingModel: vi.fn(),
  isRerankModel: vi.fn()
}))

vi.mock('../vision', () => ({
  isTextToImageModel: vi.fn(),
  isPureGenerateImageModel: vi.fn(),
  isModernGenerateImageModel: vi.fn()
}))

describe('Doubao Models', () => {
  describe('isDoubaoThinkingAutoModel', () => {
    it('should return false for invalid models', () => {
      expect(
        isDoubaoThinkingAutoModel({
          id: 'doubao-seed-1-6-251015',
          name: 'doubao-seed-1-6-251015',
          provider: '',
          group: ''
        })
      ).toBe(false)
      expect(
        isDoubaoThinkingAutoModel({
          id: 'doubao-seed-1-6-lite-251015',
          name: 'doubao-seed-1-6-lite-251015',
          provider: '',
          group: ''
        })
      ).toBe(false)
      expect(
        isDoubaoThinkingAutoModel({
          id: 'doubao-seed-1-6-thinking-250715',
          name: 'doubao-seed-1-6-thinking-250715',
          provider: '',
          group: ''
        })
      ).toBe(false)
      expect(
        isDoubaoThinkingAutoModel({
          id: 'doubao-seed-1-6-flash',
          name: 'doubao-seed-1-6-flash',
          provider: '',
          group: ''
        })
      ).toBe(false)
      expect(
        isDoubaoThinkingAutoModel({
          id: 'doubao-seed-1-6-thinking',
          name: 'doubao-seed-1-6-thinking',
          provider: '',
          group: ''
        })
      ).toBe(false)
    })

    it('should return true for valid models', () => {
      expect(
        isDoubaoThinkingAutoModel({
          id: 'doubao-seed-1-6-250615',
          name: 'doubao-seed-1-6-250615',
          provider: '',
          group: ''
        })
      ).toBe(true)
      expect(
        isDoubaoThinkingAutoModel({
          id: 'Doubao-Seed-1.6',
          name: 'Doubao-Seed-1.6',
          provider: '',
          group: ''
        })
      ).toBe(true)
      expect(
        isDoubaoThinkingAutoModel({
          id: 'doubao-1-5-thinking-pro-m',
          name: 'doubao-1-5-thinking-pro-m',
          provider: '',
          group: ''
        })
      ).toBe(true)
      expect(
        isDoubaoThinkingAutoModel({
          id: 'doubao-seed-1.6-lite',
          name: 'doubao-seed-1.6-lite',
          provider: '',
          group: ''
        })
      ).toBe(true)
      expect(
        isDoubaoThinkingAutoModel({
          id: 'doubao-1-5-thinking-pro-m-12345',
          name: 'doubao-1-5-thinking-pro-m-12345',
          provider: '',
          group: ''
        })
      ).toBe(true)
    })
  })

  describe('isDoubaoSeedAfter251015', () => {
    it('should return true for models matching the pattern', () => {
      expect(
        isDoubaoSeedAfter251015({
          id: 'doubao-seed-1-6-251015',
          name: '',
          provider: '',
          group: ''
        })
      ).toBe(true)
      expect(
        isDoubaoSeedAfter251015({
          id: 'doubao-seed-1-6-lite-251015',
          name: '',
          provider: '',
          group: ''
        })
      ).toBe(true)
    })

    it('should return false for models not matching the pattern', () => {
      expect(
        isDoubaoSeedAfter251015({
          id: 'doubao-seed-1-6-250615',
          name: '',
          provider: '',
          group: ''
        })
      ).toBe(false)
      expect(
        isDoubaoSeedAfter251015({
          id: 'Doubao-Seed-1.6',
          name: '',
          provider: '',
          group: ''
        })
      ).toBe(false)
      expect(
        isDoubaoSeedAfter251015({
          id: 'doubao-1-5-thinking-pro-m',
          name: '',
          provider: '',
          group: ''
        })
      ).toBe(false)
      expect(
        isDoubaoSeedAfter251015({
          id: 'doubao-seed-1-6-lite-251016',
          name: '',
          provider: '',
          group: ''
        })
      ).toBe(false)
    })
  })
})

describe('Doubao Thinking Support', () => {
  it('detects thinking token support by id or name', () => {
    expect(isSupportedThinkingTokenDoubaoModel(createModel({ id: 'doubao-seed-1.6-flash' }))).toBe(true)
    expect(
      isSupportedThinkingTokenDoubaoModel(createModel({ id: 'custom', name: 'Doubao-1-5-Thinking-Pro-M-Extra' }))
    ).toBe(true)
    expect(isSupportedThinkingTokenDoubaoModel(undefined)).toBe(false)
    expect(isSupportedThinkingTokenDoubaoModel(createModel({ id: 'doubao-standard' }))).toBe(false)
  })
})

const createModel = (overrides: Partial<Model> = {}): Model => ({
  id: 'test-model',
  name: 'Test Model',
  provider: 'openai',
  group: 'Test',
  ...overrides
})

const embeddingMock = vi.mocked(isEmbeddingModel)
const rerankMock = vi.mocked(isRerankModel)
const textToImageMock = vi.mocked(isTextToImageModel)

beforeEach(() => {
  embeddingMock.mockReturnValue(false)
  rerankMock.mockReturnValue(false)
  textToImageMock.mockReturnValue(false)
})
describe('Ling Models', () => {
  describe('isLingReasoningModel', () => {
    it('should return false for ling variants', () => {
      expect(
        isLingReasoningModel({
          id: 'ling-1t',
          name: '',
          provider: '',
          group: ''
        })
      ).toBe(false)
      expect(
        isLingReasoningModel({
          id: 'ling-flash-2.0',
          name: '',
          provider: '',
          group: ''
        })
      ).toBe(false)
      expect(
        isLingReasoningModel({
          id: 'ling-mini-2.0',
          name: '',
          provider: '',
          group: ''
        })
      ).toBe(false)
    })

    it('should return true for ring variants', () => {
      expect(
        isLingReasoningModel({
          id: 'ring-1t',
          name: '',
          provider: '',
          group: ''
        })
      ).toBe(true)
      expect(
        isLingReasoningModel({
          id: 'ring-flash-2.0',
          name: '',
          provider: '',
          group: ''
        })
      ).toBe(true)
      expect(
        isLingReasoningModel({
          id: 'ring-mini-2.0',
          name: '',
          provider: '',
          group: ''
        })
      ).toBe(true)
    })
  })
})

describe('Claude & regional providers', () => {
  it('identifies claude 4.5 variants', () => {
    expect(isClaude45ReasoningModel(createModel({ id: 'claude-sonnet-4.5-preview' }))).toBe(true)
    expect(isClaude4SeriesModel(createModel({ id: 'claude-sonnet-4-5@20250929' }))).toBe(true)
    expect(isClaude45ReasoningModel(createModel({ id: 'claude-3-sonnet' }))).toBe(false)
  })

  it('identifies claude 4 variants', () => {
    expect(isClaude4SeriesModel(createModel({ id: 'claude-opus-4' }))).toBe(true)
    expect(isClaude4SeriesModel(createModel({ id: 'claude-sonnet-4@20250514' }))).toBe(true)
    expect(isClaude4SeriesModel(createModel({ id: 'anthropic.claude-sonnet-4-20250514-v1:0' }))).toBe(true)
    expect(isClaude4SeriesModel(createModel({ id: 'claude-4.2-sonnet-variant' }))).toBe(false)
    expect(isClaude4SeriesModel(createModel({ id: 'claude-3-haiku' }))).toBe(false)
  })

  it('detects general claude reasoning support', () => {
    expect(isClaudeReasoningModel(createModel({ id: 'claude-3.7-sonnet' }))).toBe(true)
    expect(isClaudeReasoningModel(createModel({ id: 'claude-3-haiku' }))).toBe(false)
  })

  it('covers hunyuan reasoning heuristics', () => {
    expect(isHunyuanReasoningModel(createModel({ id: 'hunyuan-a13b', provider: 'hunyuan' }))).toBe(true)
    expect(isHunyuanReasoningModel(createModel({ id: 'hunyuan-lite', provider: 'hunyuan' }))).toBe(false)
  })

  it('covers perplexity reasoning detectors', () => {
    expect(isPerplexityReasoningModel(createModel({ id: 'sonar-deep-research', provider: 'perplexity' }))).toBe(true)
    expect(isSupportedReasoningEffortPerplexityModel(createModel({ id: 'sonar-deep-research' }))).toBe(true)
    expect(isPerplexityReasoningModel(createModel({ id: 'sonar-lite' }))).toBe(false)
  })

  it('covers zhipu/minimax/step specific classifiers', () => {
    expect(isSupportedThinkingTokenZhipuModel(createModel({ id: 'glm-4.6-pro' }))).toBe(true)
    expect(isZhipuReasoningModel(createModel({ id: 'glm-z1' }))).toBe(true)
    expect(isStepReasoningModel(createModel({ id: 'step-r1-v-mini' }))).toBe(true)
    expect(isMiniMaxReasoningModel(createModel({ id: 'minimax-m2-pro' }))).toBe(true)
  })
})

describe('DeepSeek & Thinking Tokens', () => {
  it('detects deepseek hybrid inference patterns and allowed providers', () => {
    expect(
      isDeepSeekHybridInferenceModel(
        createModel({
          id: 'deepseek-v3.1-alpha',
          provider: 'openrouter'
        })
      )
    ).toBe(true)
    expect(isDeepSeekHybridInferenceModel(createModel({ id: 'deepseek-v2' }))).toBe(false)
    expect(isDeepSeekHybridInferenceModel(createModel({ id: 'deepseek-v3.2' }))).toBe(true)
    expect(isDeepSeekHybridInferenceModel(createModel({ id: 'agent/deepseek-v3.2' }))).toBe(true)
    expect(isDeepSeekHybridInferenceModel(createModel({ id: 'deepseek-chat' }))).toBe(true)
    expect(isDeepSeekHybridInferenceModel(createModel({ id: 'deepseek-v3.2-speciale' }))).toBe(false)

    const allowed = createModel({ id: 'deepseek-v3.1', provider: 'doubao' })
    expect(isSupportedThinkingTokenModel(allowed)).toBe(true)

    const disallowed = createModel({ id: 'deepseek-v3.1', provider: 'unknown' })
    expect(isSupportedThinkingTokenModel(disallowed)).toBe(false)
  })

  it('supports DeepSeek v3.1+ models from newly added providers', () => {
    // Test newly added providers for DeepSeek thinking token support
    const newProviders = ['deepseek', 'cherryin', 'new-api', 'aihubmix', 'sophnet', 'dmxapi']

    newProviders.forEach((provider) => {
      const model = createModel({ id: 'deepseek-v3.1', provider })
      expect(
        isSupportedThinkingTokenModel(model),
        `Provider ${provider} should support thinking tokens for deepseek-v3.1`
      ).toBe(true)
    })
  })

  it('tests various prefix patterns for isDeepSeekHybridInferenceModel', () => {
    // Test with custom prefixes
    expect(isDeepSeekHybridInferenceModel(createModel({ id: 'custom-deepseek-v3.2' }))).toBe(true)
    expect(isDeepSeekHybridInferenceModel(createModel({ id: 'prefix-deepseek-v3.1' }))).toBe(true)
    expect(isDeepSeekHybridInferenceModel(createModel({ id: 'agent/deepseek-v3.2' }))).toBe(true)

    // Test that speciale is properly excluded
    expect(isDeepSeekHybridInferenceModel(createModel({ id: 'custom-deepseek-v3.2-speciale' }))).toBe(false)
    expect(isDeepSeekHybridInferenceModel(createModel({ id: 'agent/deepseek-v3.2-speciale' }))).toBe(false)

    // Test basic deepseek-chat
    expect(isDeepSeekHybridInferenceModel(createModel({ id: 'deepseek-chat' }))).toBe(true)

    // Test version variations
    expect(isDeepSeekHybridInferenceModel(createModel({ id: 'deepseek-v3.1.2' }))).toBe(true)
    expect(isDeepSeekHybridInferenceModel(createModel({ id: 'deepseek-v3-1' }))).toBe(true)
  })

  it('supports Gemini thinking models while filtering image variants', () => {
    expect(isSupportedThinkingTokenModel(createModel({ id: 'gemini-2.5-flash-latest' }))).toBe(true)
    expect(isSupportedThinkingTokenModel(createModel({ id: 'gemini-2.5-flash-image' }))).toBe(false)
  })
})

describe('Qwen & Gemini thinking coverage', () => {
  it.each([
    'qwen-plus',
    'qwen-plus-2025-07-14',
    'qwen-plus-2025-09-11',
    'qwen-turbo',
    'qwen-turbo-2025-04-28',
    'qwen-flash',
    'qwen3-8b',
    'qwen3-72b'
  ])('supports thinking tokens for %s', (id) => {
    expect(isSupportedThinkingTokenQwenModel(createModel({ id }))).toBe(true)
  })

  it.each(['qwen3-thinking', 'qwen3-instruct', 'qwen3-max', 'qwen3-vl-thinking'])(
    'blocks thinking tokens for %s',
    (id) => {
      expect(isSupportedThinkingTokenQwenModel(createModel({ id }))).toBe(false)
    }
  )

  it.each(['qwen3-thinking', 'qwen3-vl-235b-thinking'])('always thinks for %s', (id) => {
    expect(isQwenAlwaysThinkModel(createModel({ id }))).toBe(true)
  })

  it.each(['gemini-2.5-flash-latest', 'gemini-pro-latest', 'gemini-flash-lite-latest'])(
    'Gemini supports thinking tokens for %s',
    (id) => {
      expect(isSupportedThinkingTokenGeminiModel(createModel({ id }))).toBe(true)
    }
  )

  it.each(['gemini-2.5-flash-image', 'gemini-2.0-tts', 'custom-model'])('Gemini excludes %s', (id) => {
    expect(isSupportedThinkingTokenGeminiModel(createModel({ id }))).toBe(false)
  })
})

describe('GPT-5.1 Series Models', () => {
  describe('getThinkModelType', () => {
    it('should return gpt5_1 for GPT-5.1 models', () => {
      expect(getThinkModelType(createModel({ id: 'gpt-5.1' }))).toBe('gpt5_1')
      expect(getThinkModelType(createModel({ id: 'gpt-5.1-preview' }))).toBe('gpt5_1')
      expect(getThinkModelType(createModel({ id: 'gpt-5.1-mini' }))).toBe('gpt5_1')
    })

    it('should return gpt5_1_codex for GPT-5.1 codex models', () => {
      expect(getThinkModelType(createModel({ id: 'gpt-5.1-codex' }))).toBe('gpt5_1_codex')
      expect(getThinkModelType(createModel({ id: 'gpt-5.1-codex-mini' }))).toBe('gpt5_1_codex')
      expect(getThinkModelType(createModel({ id: 'gpt-5.1-codex-preview' }))).toBe('gpt5_1_codex')
    })

    it('should not misclassify GPT-5.1 chat models as reasoning', () => {
      expect(isSupportedReasoningEffortOpenAIModel(createModel({ id: 'gpt-5.1-chat' }))).toBe(false)
    })
  })

  describe('isSupportedReasoningEffortOpenAIModel', () => {
    it('should support GPT-5.1 reasoning models', () => {
      expect(isSupportedReasoningEffortOpenAIModel(createModel({ id: 'gpt-5.1' }))).toBe(true)
      expect(isSupportedReasoningEffortOpenAIModel(createModel({ id: 'gpt-5.1-preview' }))).toBe(true)
      expect(isSupportedReasoningEffortOpenAIModel(createModel({ id: 'gpt-5.1-codex' }))).toBe(true)
      expect(isSupportedReasoningEffortOpenAIModel(createModel({ id: 'gpt-5.1-codex-mini' }))).toBe(true)
    })

    it('should not support GPT-5.1 chat models', () => {
      expect(isSupportedReasoningEffortOpenAIModel(createModel({ id: 'gpt-5.1-chat' }))).toBe(false)
    })
  })

  describe('isOpenAIReasoningModel', () => {
    it('should recognize GPT-5.1 series as reasoning models', () => {
      expect(isOpenAIReasoningModel(createModel({ id: 'gpt-5.1' }))).toBe(true)
      expect(isOpenAIReasoningModel(createModel({ id: 'gpt-5.1-preview' }))).toBe(true)
      expect(isOpenAIReasoningModel(createModel({ id: 'gpt-5.1-codex' }))).toBe(true)
      expect(isOpenAIReasoningModel(createModel({ id: 'gpt-5.1-codex-mini' }))).toBe(true)
    })
  })

  describe('isReasoningModel', () => {
    it('should classify GPT-5.1 models as reasoning models', () => {
      expect(isReasoningModel(createModel({ id: 'gpt-5.1' }))).toBe(true)
      expect(isReasoningModel(createModel({ id: 'gpt-5.1-preview' }))).toBe(true)
      expect(isReasoningModel(createModel({ id: 'gpt-5.1-mini' }))).toBe(true)
      expect(isReasoningModel(createModel({ id: 'gpt-5.1-codex' }))).toBe(true)
      expect(isReasoningModel(createModel({ id: 'gpt-5.1-codex-mini' }))).toBe(true)
    })

    it('should not classify GPT-5.1 chat models as reasoning models', () => {
      expect(isReasoningModel(createModel({ id: 'gpt-5.1-chat' }))).toBe(false)
    })
  })
})

describe('Reasoning effort helpers', () => {
  it('evaluates OpenAI-specific reasoning toggles', () => {
    expect(isSupportedReasoningEffortOpenAIModel(createModel({ id: 'o3-mini' }))).toBe(true)
    expect(isSupportedReasoningEffortOpenAIModel(createModel({ id: 'o1-mini' }))).toBe(false)
    expect(isSupportedReasoningEffortOpenAIModel(createModel({ id: 'gpt-oss-reasoning' }))).toBe(true)
    expect(isSupportedReasoningEffortOpenAIModel(createModel({ id: 'gpt-5-chat' }))).toBe(false)
    expect(isSupportedReasoningEffortOpenAIModel(createModel({ id: 'gpt-5.1' }))).toBe(true)
  })

  it('detects OpenAI reasoning models even when not supported by effort helper', () => {
    expect(isOpenAIReasoningModel(createModel({ id: 'o1-preview' }))).toBe(true)
    expect(isOpenAIReasoningModel(createModel({ id: 'custom-model' }))).toBe(false)
  })

  it('aggregates other reasoning effort families', () => {
    expect(isSupportedReasoningEffortModel(createModel({ id: 'o3' }))).toBe(true)
    expect(isSupportedReasoningEffortModel(createModel({ id: 'grok-3-mini' }))).toBe(true)
    expect(isSupportedReasoningEffortModel(createModel({ id: 'sonar-deep-research', provider: 'perplexity' }))).toBe(
      true
    )
    expect(isSupportedReasoningEffortModel(createModel({ id: 'gpt-4o' }))).toBe(false)
  })

  it('flags grok specific helpers correctly', () => {
    expect(isSupportedReasoningEffortGrokModel(createModel({ id: 'grok-3-mini' }))).toBe(true)
    expect(
      isSupportedReasoningEffortGrokModel(createModel({ id: 'grok-4-fast-openrouter', provider: 'openrouter' }))
    ).toBe(true)
    expect(isSupportedReasoningEffortGrokModel(createModel({ id: 'grok-4' }))).toBe(false)

    expect(isGrok4FastReasoningModel(createModel({ id: 'grok-4-fast' }))).toBe(true)
    expect(isGrok4FastReasoningModel(createModel({ id: 'grok-4-fast-non-reasoning' }))).toBe(false)
  })
})

describe('isReasoningModel', () => {
  it('returns false for embedding/rerank/text-to-image models', () => {
    embeddingMock.mockReturnValueOnce(true)
    expect(isReasoningModel(createModel())).toBe(false)

    embeddingMock.mockReturnValue(false)
    rerankMock.mockReturnValueOnce(true)
    expect(isReasoningModel(createModel())).toBe(false)

    rerankMock.mockReturnValue(false)
    textToImageMock.mockReturnValueOnce(true)
    expect(isReasoningModel(createModel())).toBe(false)
  })

  it('respects manual overrides', () => {
    const forced = createModel({
      capabilities: [{ type: 'reasoning', isUserSelected: true }]
    })
    expect(isReasoningModel(forced)).toBe(true)

    const disabled = createModel({
      capabilities: [{ type: 'reasoning', isUserSelected: false }]
    })
    expect(isReasoningModel(disabled)).toBe(false)
  })

  it('handles doubao-specific and generic matches', () => {
    const doubao = createModel({
      id: 'doubao-seed-1-6-thinking',
      provider: 'doubao',
      name: 'doubao-seed-1-6-thinking'
    })
    expect(isReasoningModel(doubao)).toBe(true)

    const magistral = createModel({ id: 'magistral-reasoning' })
    expect(isReasoningModel(magistral)).toBe(true)
  })

  it('identifies fixed reasoning models', () => {
    const models = [
      'deepseek-reasoner',
      'o1-preview',
      'o1-mini',
      'qwq-32b-preview',
      'step-3-minimax',
      'generic-reasoning-model',
      'some-random-model-thinking',
      'some-random-model-think',
      'deepseek-v3.2-speciale'
    ]

    models.forEach((id) => {
      const model = createModel({ id })
      expect(isFixedReasoningModel(model), `Model ${id} should be reasoning`).toBe(true)
    })
  })

  it('excludes non-fixed reasoning models from isFixedReasoningModel', () => {
    // Models that support thinking tokens or reasoning effort should NOT be fixed reasoning models
    const nonFixedModels = [
      { id: 'deepseek-v3.2', provider: 'deepseek' }, // Supports thinking tokens
      { id: 'deepseek-chat', provider: 'deepseek' }, // Supports thinking tokens
      { id: 'claude-3-opus-20240229', provider: 'anthropic' }, // Supports thinking tokens via extended_thinking
      { id: 'gpt-4o', provider: 'openai' }, // Not a reasoning model at all
      { id: 'gpt-4', provider: 'openai' } // Not a reasoning model at all
    ]

    nonFixedModels.forEach(({ id, provider }) => {
      const model = createModel({ id, provider })
      expect(isFixedReasoningModel(model), `Model ${id} should NOT be fixed reasoning`).toBe(false)
    })
  })
})

describe('Thinking model classification', () => {
  it('maps gpt-5 codex and name-based fallbacks', () => {
    expect(getThinkModelType(createModel({ id: 'gpt-5-codex' }))).toBe('gpt5_codex')
    expect(
      getThinkModelType(
        createModel({
          id: 'custom-id',
          name: 'Grok-4-fast Reasoning'
        })
      )
    ).toBe('grok4_fast')
  })
})

describe('Reasoning option configuration', () => {
  it('allows GPT-5.1 series models to disable reasoning', () => {
    expect(MODEL_SUPPORTED_OPTIONS.gpt5_1).toContain('none')
    expect(MODEL_SUPPORTED_OPTIONS.gpt5_1_codex).toContain('none')
  })

  it('restricts GPT-5 Pro reasoning to high effort only', () => {
    expect(MODEL_SUPPORTED_REASONING_EFFORT.gpt5pro).toEqual(['high'])
    expect(MODEL_SUPPORTED_OPTIONS.gpt5pro).toEqual(['high'])
  })
})

describe('getThinkModelType - Comprehensive Coverage', () => {
  describe('OpenAI Deep Research models', () => {
    it('should return openai_deep_research for deep research models', () => {
      expect(getThinkModelType(createModel({ id: 'gpt-4o-deep-research' }))).toBe('openai_deep_research')
      expect(getThinkModelType(createModel({ id: 'gpt-4o-deep-research-preview' }))).toBe('openai_deep_research')
    })
  })

  describe('GPT-5.1 series models', () => {
    it('should return gpt5_1_codex for GPT-5.1 codex models', () => {
      expect(getThinkModelType(createModel({ id: 'gpt-5.1-codex' }))).toBe('gpt5_1_codex')
      expect(getThinkModelType(createModel({ id: 'gpt-5.1-codex-mini' }))).toBe('gpt5_1_codex')
      expect(getThinkModelType(createModel({ id: 'gpt-5.1-codex-preview' }))).toBe('gpt5_1_codex')
    })

    it('should return gpt5_1 for non-codex GPT-5.1 models', () => {
      expect(getThinkModelType(createModel({ id: 'gpt-5.1' }))).toBe('gpt5_1')
      expect(getThinkModelType(createModel({ id: 'gpt-5.1-preview' }))).toBe('gpt5_1')
      expect(getThinkModelType(createModel({ id: 'gpt-5.1-mini' }))).toBe('gpt5_1')
    })
  })

  describe('GPT-5 series models', () => {
    it('should return gpt5_codex for GPT-5 codex models', () => {
      expect(getThinkModelType(createModel({ id: 'gpt-5-codex' }))).toBe('gpt5_codex')
      expect(getThinkModelType(createModel({ id: 'gpt-5-codex-mini' }))).toBe('gpt5_codex')
    })

    it('should return gpt5 for non-codex GPT-5 models', () => {
      expect(getThinkModelType(createModel({ id: 'gpt-5' }))).toBe('gpt5')
      expect(getThinkModelType(createModel({ id: 'gpt-5-preview' }))).toBe('gpt5')
    })

    it('should return gpt5pro for GPT-5 Pro models', () => {
      expect(getThinkModelType(createModel({ id: 'gpt-5-pro' }))).toBe('gpt5pro')
      expect(getThinkModelType(createModel({ id: 'gpt-5-pro-preview' }))).toBe('gpt5pro')
    })
  })

  describe('OpenAI O-series models', () => {
    it('should return o for supported reasoning effort OpenAI models', () => {
      expect(getThinkModelType(createModel({ id: 'o3' }))).toBe('o')
      expect(getThinkModelType(createModel({ id: 'o3-mini' }))).toBe('o')
      expect(getThinkModelType(createModel({ id: 'o4' }))).toBe('o')
      expect(getThinkModelType(createModel({ id: 'gpt-oss-reasoning' }))).toBe('o')
    })
  })

  describe('Grok models', () => {
    it('should return grok4_fast for Grok 4 Fast models', () => {
      expect(getThinkModelType(createModel({ id: 'grok-4-fast' }))).toBe('grok4_fast')
      expect(getThinkModelType(createModel({ id: 'grok-4-fast-preview' }))).toBe('grok4_fast')
    })

    it('should return grok for other supported Grok models', () => {
      expect(getThinkModelType(createModel({ id: 'grok-3-mini' }))).toBe('grok')
    })
  })

  describe('Gemini models', () => {
    it('should return gemini for Flash models', () => {
      expect(getThinkModelType(createModel({ id: 'gemini-2.5-flash-latest' }))).toBe('gemini')
      expect(getThinkModelType(createModel({ id: 'gemini-flash-latest' }))).toBe('gemini')
      expect(getThinkModelType(createModel({ id: 'gemini-flash-lite-latest' }))).toBe('gemini')
    })

    it('should return gemini_pro for Pro models', () => {
      expect(getThinkModelType(createModel({ id: 'gemini-2.5-pro-latest' }))).toBe('gemini_pro')
      expect(getThinkModelType(createModel({ id: 'gemini-pro-latest' }))).toBe('gemini_pro')
    })
  })

  describe('Qwen models', () => {
    it('should return qwen for supported Qwen models with thinking control', () => {
      expect(getThinkModelType(createModel({ id: 'qwen-plus' }))).toBe('qwen')
      expect(getThinkModelType(createModel({ id: 'qwen-turbo' }))).toBe('qwen')
      expect(getThinkModelType(createModel({ id: 'qwen-flash' }))).toBe('qwen')
      expect(getThinkModelType(createModel({ id: 'qwen3-8b' }))).toBe('qwen')
    })

    it('should return default for always-thinking Qwen models (not controllable)', () => {
      // qwen3-thinking and qwen3-vl-thinking always think and don't support thinking token control
      expect(getThinkModelType(createModel({ id: 'qwen3-thinking' }))).toBe('default')
      expect(getThinkModelType(createModel({ id: 'qwen3-vl-235b-thinking' }))).toBe('default')
    })
  })

  describe('Doubao models', () => {
    it('should return doubao for auto-thinking Doubao models', () => {
      expect(getThinkModelType(createModel({ id: 'doubao-seed-1.6' }))).toBe('doubao')
      expect(getThinkModelType(createModel({ id: 'doubao-1-5-thinking-pro-m' }))).toBe('doubao')
    })

    it('should return doubao_after_251015 for seed models after 251015', () => {
      expect(getThinkModelType(createModel({ id: 'doubao-seed-1-6-251015' }))).toBe('doubao_after_251015')
      expect(getThinkModelType(createModel({ id: 'doubao-seed-1-6-lite-251015' }))).toBe('doubao_after_251015')
    })

    it('should return doubao_no_auto for other Doubao thinking models', () => {
      expect(getThinkModelType(createModel({ id: 'doubao-1.5-thinking-vision-pro' }))).toBe('doubao_no_auto')
    })
  })

  describe('Hunyuan models', () => {
    it('should return hunyuan for supported Hunyuan models', () => {
      expect(getThinkModelType(createModel({ id: 'hunyuan-a13b' }))).toBe('hunyuan')
    })
  })

  describe('Perplexity models', () => {
    it('should return perplexity for supported Perplexity models', () => {
      expect(getThinkModelType(createModel({ id: 'sonar-pro', provider: 'perplexity' }))).toBe('default')
    })

    it('should return openai_deep_research for sonar-deep-research (matches deep-research regex)', () => {
      // Note: sonar-deep-research is caught by isOpenAIDeepResearchModel first
      expect(getThinkModelType(createModel({ id: 'sonar-deep-research' }))).toBe('openai_deep_research')
    })
  })

  describe('Zhipu models', () => {
    it('should return zhipu for supported Zhipu models', () => {
      expect(getThinkModelType(createModel({ id: 'glm-4.5' }))).toBe('zhipu')
      expect(getThinkModelType(createModel({ id: 'glm-4.6' }))).toBe('zhipu')
    })
  })

  describe('DeepSeek models', () => {
    it('should return deepseek_hybrid for DeepSeek V3.1 models', () => {
      expect(getThinkModelType(createModel({ id: 'deepseek-v3.1' }))).toBe('deepseek_hybrid')
      expect(getThinkModelType(createModel({ id: 'deepseek-v3.1-alpha' }))).toBe('deepseek_hybrid')
      expect(getThinkModelType(createModel({ id: 'deepseek-chat-v3.1' }))).toBe('deepseek_hybrid')
    })
  })

  describe('Default case', () => {
    it('should return default for unsupported models', () => {
      expect(getThinkModelType(createModel({ id: 'gpt-4o' }))).toBe('default')
      expect(getThinkModelType(createModel({ id: 'claude-3-opus' }))).toBe('default')
      expect(getThinkModelType(createModel({ id: 'unknown-model' }))).toBe('default')
    })
  })

  describe('Name-based fallback', () => {
    it('should fall back to name when id does not match', () => {
      expect(
        getThinkModelType(
          createModel({
            id: 'custom-id',
            name: 'grok-4-fast'
          })
        )
      ).toBe('grok4_fast')

      expect(
        getThinkModelType(
          createModel({
            id: 'custom-id',
            name: 'gpt-5.1-codex'
          })
        )
      ).toBe('gpt5_1_codex')

      expect(
        getThinkModelType(
          createModel({
            id: 'custom-id',
            name: 'gemini-2.5-flash-latest'
          })
        )
      ).toBe('gemini')
    })

    it('should use id result when id matches', () => {
      expect(
        getThinkModelType(
          createModel({
            id: 'gpt-5.1',
            name: 'Different Name'
          })
        )
      ).toBe('gpt5_1')
    })
  })

  describe('Edge cases and priority', () => {
    it('should prioritize openai_deep_research over other matches', () => {
      // deep-research regex is checked first
      expect(getThinkModelType(createModel({ id: 'gpt-4o-deep-research', provider: 'openai' }))).toBe(
        'openai_deep_research'
      )
    })

    it('should handle case insensitivity correctly', () => {
      expect(getThinkModelType(createModel({ id: 'GPT-5.1' }))).toBe('gpt5_1')
      expect(getThinkModelType(createModel({ id: 'Gemini-2.5-Flash-Latest' }))).toBe('gemini')
      expect(getThinkModelType(createModel({ id: 'DeepSeek-V3.1' }))).toBe('deepseek_hybrid')
    })

    it('should handle special characters and separators', () => {
      expect(getThinkModelType(createModel({ id: 'doubao-seed-1.6' }))).toBe('doubao')
      expect(getThinkModelType(createModel({ id: 'doubao-seed-1-6' }))).toBe('doubao')
      expect(getThinkModelType(createModel({ id: 'gpt-5.1' }))).toBe('gpt5_1')
      expect(getThinkModelType(createModel({ id: 'deepseek-v3.1' }))).toBe('deepseek_hybrid')
      expect(getThinkModelType(createModel({ id: 'deepseek-v3-1' }))).toBe('deepseek_hybrid')
    })

    it('should return default for empty or null-like inputs', () => {
      expect(getThinkModelType(createModel({ id: '' }))).toBe('default')
      expect(getThinkModelType(createModel({ id: 'unknown' }))).toBe('default')
    })

    it('should handle models with version suffixes', () => {
      expect(getThinkModelType(createModel({ id: 'gpt-5-preview-2024' }))).toBe('gpt5')
      expect(getThinkModelType(createModel({ id: 'o3-mini-2024' }))).toBe('o')
      expect(getThinkModelType(createModel({ id: 'gemini-2.5-flash-latest-001' }))).toBe('gemini')
    })

    it('should prioritize GPT-5.1 over GPT-5 detection', () => {
      // GPT-5.1 should be detected before GPT-5
      expect(getThinkModelType(createModel({ id: 'gpt-5.1-anything' }))).toBe('gpt5_1')
      expect(getThinkModelType(createModel({ id: 'gpt-5-anything' }))).toBe('gpt5')
    })

    it('should handle Doubao priority correctly', () => {
      // auto > after_251015 > no_auto
      expect(getThinkModelType(createModel({ id: 'doubao-seed-1.6' }))).toBe('doubao')
      expect(getThinkModelType(createModel({ id: 'doubao-seed-1-6-251015' }))).toBe('doubao_after_251015')
      expect(getThinkModelType(createModel({ id: 'doubao-1.5-thinking-vision-pro' }))).toBe('doubao_no_auto')
    })

    it('should handle Qwen thinking detection correctly', () => {
      // qwen3-thinking models don't support thinking control (not in isSupportedThinkingTokenQwenModel)
      expect(getThinkModelType(createModel({ id: 'qwen3-thinking' }))).toBe('default')
      // but qwen-plus supports thinking control
      expect(getThinkModelType(createModel({ id: 'qwen-plus' }))).toBe('qwen')
    })
  })
})

describe('Gemini Models', () => {
  describe('isSupportedThinkingTokenGeminiModel', () => {
    it('should return true for gemini 2.5 models', () => {
      expect(
        isSupportedThinkingTokenGeminiModel({
          id: 'gemini-2.5-flash',
          name: '',
          provider: '',
          group: ''
        })
      ).toBe(true)
      expect(
        isSupportedThinkingTokenGeminiModel({
          id: 'gemini-2.5-pro',
          name: '',
          provider: '',
          group: ''
        })
      ).toBe(true)
      expect(
        isSupportedThinkingTokenGeminiModel({
          id: 'gemini-2.5-flash-latest',
          name: '',
          provider: '',
          group: ''
        })
      ).toBe(true)
      expect(
        isSupportedThinkingTokenGeminiModel({
          id: 'gemini-2.5-pro-latest',
          name: '',
          provider: '',
          group: ''
        })
      ).toBe(true)
    })

    it('should return true for gemini latest models', () => {
      expect(
        isSupportedThinkingTokenGeminiModel({
          id: 'gemini-flash-latest',
          name: '',
          provider: '',
          group: ''
        })
      ).toBe(true)
      expect(
        isSupportedThinkingTokenGeminiModel({
          id: 'gemini-pro-latest',
          name: '',
          provider: '',
          group: ''
        })
      ).toBe(true)
      expect(
        isSupportedThinkingTokenGeminiModel({
          id: 'gemini-flash-lite-latest',
          name: '',
          provider: '',
          group: ''
        })
      ).toBe(true)
    })

    it('should return true for gemini 3 models', () => {
      // Preview versions
      expect(
        isSupportedThinkingTokenGeminiModel({
          id: 'gemini-3-pro-preview',
          name: '',
          provider: '',
          group: ''
        })
      ).toBe(true)
      expect(
        isSupportedThinkingTokenGeminiModel({
          id: 'google/gemini-3-pro-preview',
          name: '',
          provider: '',
          group: ''
        })
      ).toBe(true)
      // Future stable versions
      expect(
        isSupportedThinkingTokenGeminiModel({
          id: 'gemini-3-flash',
          name: '',
          provider: '',
          group: ''
        })
      ).toBe(true)
      expect(
        isSupportedThinkingTokenGeminiModel({
          id: 'gemini-3-pro',
          name: '',
          provider: '',
          group: ''
        })
      ).toBe(true)
      expect(
        isSupportedThinkingTokenGeminiModel({
          id: 'google/gemini-3-flash',
          name: '',
          provider: '',
          group: ''
        })
      ).toBe(true)
      expect(
        isSupportedThinkingTokenGeminiModel({
          id: 'google/gemini-3-pro',
          name: '',
          provider: '',
          group: ''
        })
      ).toBe(true)
      // Version with decimals
      expect(
        isSupportedThinkingTokenGeminiModel({
          id: 'gemini-3.0-flash',
          name: '',
          provider: '',
          group: ''
        })
      ).toBe(true)
      expect(
        isSupportedThinkingTokenGeminiModel({
          id: 'gemini-3.5-pro-preview',
          name: '',
          provider: '',
          group: ''
        })
      ).toBe(true)
    })

    it('should return true for gemini-3 image models', () => {
      expect(
        isSupportedThinkingTokenGeminiModel({
          id: 'gemini-3-pro-image-preview',
          name: '',
          provider: '',
          group: ''
        })
      ).toBe(true)
      expect(
        isSupportedThinkingTokenGeminiModel({
          id: 'gemini-3.0-flash-image-preview',
          name: '',
          provider: '',
          group: ''
        })
      ).toBe(false)
      expect(
        isSupportedThinkingTokenGeminiModel({
          id: 'gemini-3.5-pro-image-preview',
          name: '',
          provider: '',
          group: ''
        })
      ).toBe(false)
    })

    it('should return false for gemini-2.x image models', () => {
      expect(
        isSupportedThinkingTokenGeminiModel({
          id: 'gemini-2.5-flash-image-preview',
          name: '',
          provider: '',
          group: ''
        })
      ).toBe(false)
      expect(
        isSupportedThinkingTokenGeminiModel({
          id: 'gemini-2.0-pro-image-preview',
          name: '',
          provider: '',
          group: ''
        })
      ).toBe(false)
    })

    it('should return false for image and tts models', () => {
      expect(
        isSupportedThinkingTokenGeminiModel({
          id: 'gemini-2.5-flash-image',
          name: '',
          provider: '',
          group: ''
        })
      ).toBe(false)
      expect(
        isSupportedThinkingTokenGeminiModel({
          id: 'gemini-2.5-flash-preview-tts',
          name: '',
          provider: '',
          group: ''
        })
      ).toBe(false)
      expect(
        isSupportedThinkingTokenGeminiModel({
          id: 'gemini-3-flash-tts',
          name: '',
          provider: '',
          group: ''
        })
      ).toBe(false)
    })

    it('should return false for older gemini models', () => {
      expect(
        isSupportedThinkingTokenGeminiModel({
          id: 'gemini-1.5-flash',
          name: '',
          provider: '',
          group: ''
        })
      ).toBe(false)
      expect(
        isSupportedThinkingTokenGeminiModel({
          id: 'gemini-1.5-pro',
          name: '',
          provider: '',
          group: ''
        })
      ).toBe(false)
      expect(
        isSupportedThinkingTokenGeminiModel({
          id: 'gemini-1.0-pro',
          name: '',
          provider: '',
          group: ''
        })
      ).toBe(false)
    })
  })

  describe('isGeminiReasoningModel', () => {
    it('should return true for gemini thinking models', () => {
      expect(
        isGeminiReasoningModel({
          id: 'gemini-2.0-flash-thinking',
          name: '',
          provider: '',
          group: ''
        })
      ).toBe(true)
      expect(
        isGeminiReasoningModel({
          id: 'gemini-thinking-exp',
          name: '',
          provider: '',
          group: ''
        })
      ).toBe(true)
    })

    it('should return true for supported thinking token gemini models', () => {
      expect(
        isGeminiReasoningModel({
          id: 'gemini-2.5-flash',
          name: '',
          provider: '',
          group: ''
        })
      ).toBe(true)
      expect(
        isGeminiReasoningModel({
          id: 'gemini-2.5-pro',
          name: '',
          provider: '',
          group: ''
        })
      ).toBe(true)
    })

    it('should return true for gemini-3 models', () => {
      // Preview versions
      expect(
        isGeminiReasoningModel({
          id: 'gemini-3-pro-preview',
          name: '',
          provider: '',
          group: ''
        })
      ).toBe(true)
      expect(
        isGeminiReasoningModel({
          id: 'google/gemini-3-pro-preview',
          name: '',
          provider: '',
          group: ''
        })
      ).toBe(true)
      // Future stable versions
      expect(
        isGeminiReasoningModel({
          id: 'gemini-3-flash',
          name: '',
          provider: '',
          group: ''
        })
      ).toBe(true)
      expect(
        isGeminiReasoningModel({
          id: 'gemini-3-pro',
          name: '',
          provider: '',
          group: ''
        })
      ).toBe(true)
      expect(
        isGeminiReasoningModel({
          id: 'google/gemini-3-flash',
          name: '',
          provider: '',
          group: ''
        })
      ).toBe(true)
      expect(
        isGeminiReasoningModel({
          id: 'google/gemini-3-pro',
          name: '',
          provider: '',
          group: ''
        })
      ).toBe(true)
      // Version with decimals
      expect(
        isGeminiReasoningModel({
          id: 'gemini-3.0-flash',
          name: '',
          provider: '',
          group: ''
        })
      ).toBe(true)
      expect(
        isGeminiReasoningModel({
          id: 'gemini-3.5-pro-preview',
          name: '',
          provider: '',
          group: ''
        })
      ).toBe(true)
      // Image models
      expect(
        isGeminiReasoningModel({
          id: 'gemini-3-pro-image-preview',
          name: '',
          provider: '',
          group: ''
        })
      ).toBe(true)
      expect(
        isGeminiReasoningModel({
          id: 'gemini-3.5-flash-image-preview',
          name: '',
          provider: '',
          group: ''
        })
      ).toBe(false)
    })

    it('should return false for older gemini models without thinking', () => {
      expect(
        isGeminiReasoningModel({
          id: 'gemini-1.5-flash',
          name: '',
          provider: '',
          group: ''
        })
      ).toBe(false)
      expect(
        isGeminiReasoningModel({
          id: 'gemini-1.5-pro',
          name: '',
          provider: '',
          group: ''
        })
      ).toBe(false)
    })

    it('should return false for undefined model', () => {
      expect(isGeminiReasoningModel(undefined)).toBe(false)
    })
  })
})

describe('findTokenLimit', () => {
  describe('General token limit lookup', () => {
    it.each([
      ['gemini-2.5-flash-lite-latest', { min: 512, max: 24576 }],
      ['qwen-plus-2025-07-14', { min: 0, max: 38912 }]
    ])('returns configured min/max pairs for %s', (id, expected) => {
      expect(findTokenLimit(id)).toEqual(expected)
    })

    it('returns undefined when regex misses', () => {
      expect(findTokenLimit('unknown-model')).toBeUndefined()
    })
  })

  const cases: Array<{ modelId: string; expected: { min: number; max: number } }> = [
    { modelId: 'gemini-2.5-flash-lite-exp', expected: { min: 512, max: 24_576 } },
    { modelId: 'gemini-1.5-flash', expected: { min: 0, max: 24_576 } },
    { modelId: 'gemini-1.5-pro-001', expected: { min: 128, max: 32_768 } },
    { modelId: 'qwen3-235b-a22b-thinking-2507', expected: { min: 0, max: 81_920 } },
    { modelId: 'qwen3-30b-a3b-thinking-2507', expected: { min: 0, max: 81_920 } },
    { modelId: 'qwen3-vl-235b-a22b-thinking', expected: { min: 0, max: 81_920 } },
    { modelId: 'qwen3-vl-30b-a3b-thinking', expected: { min: 0, max: 81_920 } },
    { modelId: 'qwen-plus-2025-07-14', expected: { min: 0, max: 38_912 } },
    { modelId: 'qwen-plus-2025-04-28', expected: { min: 0, max: 38_912 } },
    { modelId: 'qwen3-1.7b', expected: { min: 0, max: 30_720 } },
    { modelId: 'qwen3-0.6b', expected: { min: 0, max: 30_720 } },
    { modelId: 'qwen-plus-ultra', expected: { min: 0, max: 81_920 } },
    { modelId: 'qwen-turbo-pro', expected: { min: 0, max: 38_912 } },
    { modelId: 'qwen-flash-lite', expected: { min: 0, max: 81_920 } },
    { modelId: 'qwen3-7b', expected: { min: 1_024, max: 38_912 } }
  ]

  it.each(cases)('returns correct limits for $modelId', ({ modelId, expected }) => {
    expect(findTokenLimit(modelId)).toEqual(expected)
  })

  it('returns undefined for unknown models', () => {
    expect(findTokenLimit('unknown-model')).toBeUndefined()
  })

  describe('Claude models', () => {
    describe('Claude 3.7 Sonnet models', () => {
      it.each([
        'claude-3.7-sonnet',
        'claude-3-7-sonnet',
        'claude-3.7-sonnet-latest',
        'claude-3-7-sonnet-latest',
        'claude-3.7-sonnet-20250201',
        'claude-3-7-sonnet-20250201',
        // Official Claude API IDs
        'claude-3-7-sonnet-20250219',
        // AWS Bedrock format
        'anthropic.claude-3-7-sonnet-20250219-v1:0',
        // GCP Vertex AI format
        'claude-3-7-sonnet@20250219'
      ])('should return { min: 1024, max: 64000 } for %s', (modelId) => {
        expect(findTokenLimit(modelId)).toEqual({ min: 1024, max: 64_000 })
      })

      it.each(['CLAUDE-3.7-SONNET', 'Claude-3-7-Sonnet-Latest'])('should be case insensitive for %s', (modelId) => {
        expect(findTokenLimit(modelId)).toEqual({ min: 1024, max: 64_000 })
      })
    })

    describe('Claude 4.0 series models', () => {
      it.each([
        'claude-sonnet-4',
        'claude-sonnet-4.0',
        'claude-sonnet-4-0',
        'claude-sonnet-4-preview',
        'claude-sonnet-4.0-preview',
        'claude-sonnet-4-20250101',
        // Official Claude API IDs
        'claude-sonnet-4-20250514',
        // AWS Bedrock format
        'anthropic.claude-sonnet-4-20250514-v1:0',
        // GCP Vertex AI format
        'claude-sonnet-4@20250514'
      ])('should return { min: 1024, max: 64000 } for Sonnet variant %s', (modelId) => {
        expect(findTokenLimit(modelId)).toEqual({ min: 1024, max: 64_000 })
      })

      it.each([
        'claude-opus-4',
        'claude-opus-4.0',
        'claude-opus-4-0',
        'claude-opus-4-preview',
        'claude-opus-4.0-preview',
        'claude-opus-4-20250101',
        // Official Claude API IDs
        'claude-opus-4-20250514',
        // AWS Bedrock format
        'anthropic.claude-opus-4-20250514-v1:0',
        // GCP Vertex AI format
        'claude-opus-4@20250514'
      ])('should return { min: 1024, max: 32000 } for Opus variant %s', (modelId) => {
        expect(findTokenLimit(modelId)).toEqual({ min: 1024, max: 32_000 })
      })

      it.each(['CLAUDE-SONNET-4', 'Claude-Opus-4-Preview'])('should be case insensitive for %s', (modelId) => {
        const expectedSonnet = { min: 1024, max: 64_000 }
        const expectedOpus = { min: 1024, max: 32_000 }
        const result = findTokenLimit(modelId)
        expect(result).toBeDefined()
        expect([expectedSonnet, expectedOpus]).toContainEqual(result)
      })
    })

    describe('Claude Opus 4.1 models', () => {
      it.each([
        'claude-opus-4.1',
        'claude-opus-4-1',
        'claude-opus-4.1-preview',
        'claude-opus-4-1-preview',
        'claude-opus-4.1-20250120',
        'claude-opus-4-1-20250120',
        // Official Claude API IDs
        'claude-opus-4-1-20250805',
        // AWS Bedrock format
        'anthropic.claude-opus-4-1-20250805-v1:0',
        // GCP Vertex AI format
        'claude-opus-4-1@20250805'
      ])('should return { min: 1024, max: 32000 } for %s', (modelId) => {
        expect(findTokenLimit(modelId)).toEqual({ min: 1024, max: 32_000 })
      })

      it.each(['CLAUDE-OPUS-4.1', 'Claude-Opus-4-1-Preview'])('should be case insensitive for %s', (modelId) => {
        expect(findTokenLimit(modelId)).toEqual({ min: 1024, max: 32_000 })
      })
    })

    describe('Claude 4.5 series models (Haiku, Sonnet, Opus)', () => {
      it.each([
        'claude-haiku-4.5',
        'claude-haiku-4-5',
        'claude-haiku-4.5-preview',
        'claude-haiku-4-5-preview',
        'claude-haiku-4.5-20250929',
        'claude-haiku-4-5-20250929',
        // Official Claude API IDs
        'claude-haiku-4-5-20251001',
        // AWS Bedrock format
        'anthropic.claude-haiku-4-5-20251001-v1:0',
        // GCP Vertex AI format
        'claude-haiku-4-5@20251001'
      ])('should return { min: 1024, max: 64000 } for Haiku variant %s', (modelId) => {
        expect(findTokenLimit(modelId)).toEqual({ min: 1024, max: 64_000 })
      })

      it.each([
        'claude-sonnet-4.5',
        'claude-sonnet-4-5',
        'claude-sonnet-4.5-preview',
        'claude-sonnet-4-5-preview',
        'claude-sonnet-4.5-20250929',
        'claude-sonnet-4-5-20250929',
        // Official Claude API IDs
        'claude-sonnet-4-5-20250929',
        // AWS Bedrock format
        'anthropic.claude-sonnet-4-5-20250929-v1:0',
        // GCP Vertex AI format
        'claude-sonnet-4-5@20250929'
      ])('should return { min: 1024, max: 64000 } for Sonnet variant %s', (modelId) => {
        expect(findTokenLimit(modelId)).toEqual({ min: 1024, max: 64_000 })
      })

      it.each([
        'claude-opus-4.5',
        'claude-opus-4-5',
        'claude-opus-4.5-preview',
        'claude-opus-4-5-preview',
        'claude-opus-4.5-20250929',
        'claude-opus-4-5-20250929',
        // Official Claude API IDs
        'claude-opus-4-5-20251101',
        // AWS Bedrock format
        'anthropic.claude-opus-4-5-20251101-v1:0',
        // GCP Vertex AI format
        'claude-opus-4-5@20251101'
      ])('should return { min: 1024, max: 64000 } for Opus variant %s', (modelId) => {
        expect(findTokenLimit(modelId)).toEqual({ min: 1024, max: 64_000 })
      })

      it.each(['CLAUDE-HAIKU-4.5', 'Claude-Sonnet-4-5-Preview', 'CLAUDE-OPUS-4.5-20250929'])(
        'should be case insensitive for %s',
        (modelId) => {
          expect(findTokenLimit(modelId)).toEqual({ min: 1024, max: 64_000 })
        }
      )
    })

    describe('Claude models that should NOT match', () => {
      it.each([
        'claude-3-opus',
        'claude-3-sonnet',
        'claude-3-haiku',
        'claude-3.5-sonnet',
        'claude-3-5-sonnet',
        'claude-2.1',
        'claude-instant',
        'claude-haiku-4',
        'claude-haiku-4.0',
        'claude-haiku-4-0',
        'claude-opus-4.2',
        'claude-opus-4-2',
        'claude-sonnet-4.2',
        'claude-sonnet-4-2',
        // Old Haiku models (no Extended thinking support)
        'claude-3-5-haiku-20241022',
        'claude-3-5-haiku-latest',
        'anthropic.claude-3-5-haiku-20241022-v1:0',
        'claude-3-5-haiku@20241022',
        'claude-3-haiku-20240307',
        'anthropic.claude-3-haiku-20240307-v1:0',
        'claude-3-haiku@20240307'
      ])('should return undefined for older/unsupported model %s', (modelId) => {
        expect(findTokenLimit(modelId)).toBeUndefined()
      })
    })

    describe('Edge cases', () => {
      it('should handle models with custom suffixes', () => {
        expect(findTokenLimit('claude-3.7-sonnet-custom-variant')).toEqual({ min: 1024, max: 64_000 })
        expect(findTokenLimit('claude-opus-4.1-custom')).toEqual({ min: 1024, max: 32_000 })
        expect(findTokenLimit('claude-sonnet-4.5-custom-variant')).toEqual({ min: 1024, max: 64_000 })
      })

      it('should NOT match non-existent Claude 4.1 variants (only Opus 4.1 exists)', () => {
        // Claude Sonnet 4.1 and Haiku 4.1 do not exist
        expect(findTokenLimit('claude-sonnet-4.1')).toBeUndefined()
        expect(findTokenLimit('claude-haiku-4.1')).toBeUndefined()
      })

      it('should not match partial model names', () => {
        expect(findTokenLimit('claude-3.7')).toBeUndefined()
        expect(findTokenLimit('claude-opus')).toBeUndefined()
        expect(findTokenLimit('claude-4.5')).toBeUndefined()
      })
    })
  })
})

describe('isGemini3ThinkingTokenModel', () => {
  it('should return true for Gemini 3 non-image models', () => {
    expect(
      isGemini3ThinkingTokenModel({
        id: 'gemini-3-flash',
        name: '',
        provider: '',
        group: ''
      })
    ).toBe(true)
    expect(
      isGemini3ThinkingTokenModel({
        id: 'gemini-3-pro',
        name: '',
        provider: '',
        group: ''
      })
    ).toBe(true)
    expect(
      isGemini3ThinkingTokenModel({
        id: 'gemini-3-pro-preview',
        name: '',
        provider: '',
        group: ''
      })
    ).toBe(true)
    expect(
      isGemini3ThinkingTokenModel({
        id: 'google/gemini-3-flash',
        name: '',
        provider: '',
        group: ''
      })
    ).toBe(true)
    expect(
      isGemini3ThinkingTokenModel({
        id: 'gemini-3.0-flash',
        name: '',
        provider: '',
        group: ''
      })
    ).toBe(true)
    expect(
      isGemini3ThinkingTokenModel({
        id: 'gemini-3.5-pro-preview',
        name: '',
        provider: '',
        group: ''
      })
    ).toBe(true)
  })

  it('should return false for Gemini 3 image models', () => {
    expect(
      isGemini3ThinkingTokenModel({
        id: 'gemini-3-flash-image',
        name: '',
        provider: '',
        group: ''
      })
    ).toBe(false)
    expect(
      isGemini3ThinkingTokenModel({
        id: 'gemini-3-pro-image-preview',
        name: '',
        provider: '',
        group: ''
      })
    ).toBe(false)
    expect(
      isGemini3ThinkingTokenModel({
        id: 'gemini-3.0-flash-image-preview',
        name: '',
        provider: '',
        group: ''
      })
    ).toBe(false)
    expect(
      isGemini3ThinkingTokenModel({
        id: 'gemini-3.5-pro-image-preview',
        name: '',
        provider: '',
        group: ''
      })
    ).toBe(false)
  })

  it('should return false for non-Gemini 3 models', () => {
    expect(
      isGemini3ThinkingTokenModel({
        id: 'gemini-2.5-flash',
        name: '',
        provider: '',
        group: ''
      })
    ).toBe(false)
    expect(
      isGemini3ThinkingTokenModel({
        id: 'gemini-1.5-pro',
        name: '',
        provider: '',
        group: ''
      })
    ).toBe(false)
    expect(
      isGemini3ThinkingTokenModel({
        id: 'gpt-4',
        name: '',
        provider: '',
        group: ''
      })
    ).toBe(false)
    expect(
      isGemini3ThinkingTokenModel({
        id: 'claude-3-opus',
        name: '',
        provider: '',
        group: ''
      })
    ).toBe(false)
  })

  it('should handle case insensitivity', () => {
    expect(
      isGemini3ThinkingTokenModel({
        id: 'Gemini-3-Flash',
        name: '',
        provider: '',
        group: ''
      })
    ).toBe(true)
    expect(
      isGemini3ThinkingTokenModel({
        id: 'GEMINI-3-PRO',
        name: '',
        provider: '',
        group: ''
      })
    ).toBe(true)
    expect(
      isGemini3ThinkingTokenModel({
        id: 'Gemini-3-Pro-Image',
        name: '',
        provider: '',
        group: ''
      })
    ).toBe(false)
  })
})

describe('getModelSupportedReasoningEffort', () => {
  describe('Edge cases', () => {
    it('should return undefined for undefined model', () => {
      expect(getModelSupportedReasoningEffort(undefined)).toBeUndefined()
    })

    it('should return undefined for null model', () => {
      expect(getModelSupportedReasoningEffort(null)).toBeUndefined()
    })

    it('should return undefined for non-reasoning models', () => {
      expect(getModelSupportedReasoningEffort(createModel({ id: 'gpt-4o' }))).toBeUndefined()
      expect(getModelSupportedReasoningEffort(createModel({ id: 'claude-3-opus' }))).toBeUndefined()
      expect(getModelSupportedReasoningEffort(createModel({ id: 'random-model' }))).toBeUndefined()
    })
  })

  describe('OpenAI models', () => {
    it('should return correct options for o-series models', () => {
      expect(getModelSupportedReasoningEffort(createModel({ id: 'o3' }))).toEqual(['low', 'medium', 'high'])
      expect(getModelSupportedReasoningEffort(createModel({ id: 'o3-mini' }))).toEqual(['low', 'medium', 'high'])
      expect(getModelSupportedReasoningEffort(createModel({ id: 'o4' }))).toEqual(['low', 'medium', 'high'])
      expect(getModelSupportedReasoningEffort(createModel({ id: 'gpt-oss-reasoning' }))).toEqual([
        'low',
        'medium',
        'high'
      ])
    })

    it('should return correct options for deep research models', () => {
      // Note: Deep research models need to be actual OpenAI reasoning models to be detected
      // 'sonar-deep-research' from Perplexity is the primary deep research model
      expect(getModelSupportedReasoningEffort(createModel({ id: 'sonar-deep-research' }))).toEqual(['medium'])
    })

    it('should return correct options for GPT-5 models', () => {
      expect(getModelSupportedReasoningEffort(createModel({ id: 'gpt-5' }))).toEqual([
        'minimal',
        'low',
        'medium',
        'high'
      ])
      expect(getModelSupportedReasoningEffort(createModel({ id: 'gpt-5-preview' }))).toEqual([
        'minimal',
        'low',
        'medium',
        'high'
      ])
    })

    it('should return correct options for GPT-5 Pro models', () => {
      expect(getModelSupportedReasoningEffort(createModel({ id: 'gpt-5-pro' }))).toEqual(['high'])
      expect(getModelSupportedReasoningEffort(createModel({ id: 'gpt-5-pro-preview' }))).toEqual(['high'])
    })

    it('should return correct options for GPT-5 Codex models', () => {
      expect(getModelSupportedReasoningEffort(createModel({ id: 'gpt-5-codex' }))).toEqual(['low', 'medium', 'high'])
      expect(getModelSupportedReasoningEffort(createModel({ id: 'gpt-5-codex-mini' }))).toEqual([
        'low',
        'medium',
        'high'
      ])
    })

    it('should return correct options for GPT-5.1 models', () => {
      expect(getModelSupportedReasoningEffort(createModel({ id: 'gpt-5.1' }))).toEqual([
        'none',
        'low',
        'medium',
        'high'
      ])
      expect(getModelSupportedReasoningEffort(createModel({ id: 'gpt-5.1-preview' }))).toEqual([
        'none',
        'low',
        'medium',
        'high'
      ])
      expect(getModelSupportedReasoningEffort(createModel({ id: 'gpt-5.1-mini' }))).toEqual([
        'none',
        'low',
        'medium',
        'high'
      ])
    })

    it('should return correct options for GPT-5.1 Codex models', () => {
      expect(getModelSupportedReasoningEffort(createModel({ id: 'gpt-5.1-codex' }))).toEqual(['none', 'medium', 'high'])
      expect(getModelSupportedReasoningEffort(createModel({ id: 'gpt-5.1-codex-mini' }))).toEqual([
        'none',
        'medium',
        'high'
      ])
    })
  })

  describe('Grok models', () => {
    it('should return correct options for Grok 3 mini', () => {
      expect(getModelSupportedReasoningEffort(createModel({ id: 'grok-3-mini' }))).toEqual(['low', 'high'])
    })

    it('should return correct options for Grok 4 Fast', () => {
      expect(getModelSupportedReasoningEffort(createModel({ id: 'grok-4-fast', provider: 'openrouter' }))).toEqual([
        'none',
        'auto'
      ])
    })
  })

  describe('Gemini models', () => {
    it('should return correct options for Gemini Flash models', () => {
      expect(getModelSupportedReasoningEffort(createModel({ id: 'gemini-2.5-flash-latest' }))).toEqual([
        'none',
        'low',
        'medium',
        'high',
        'auto'
      ])
      expect(getModelSupportedReasoningEffort(createModel({ id: 'gemini-flash-latest' }))).toEqual([
        'none',
        'low',
        'medium',
        'high',
        'auto'
      ])
    })

    it('should return correct options for Gemini Pro models', () => {
      expect(getModelSupportedReasoningEffort(createModel({ id: 'gemini-2.5-pro-latest' }))).toEqual([
        'low',
        'medium',
        'high',
        'auto'
      ])
      expect(getModelSupportedReasoningEffort(createModel({ id: 'gemini-pro-latest' }))).toEqual([
        'low',
        'medium',
        'high',
        'auto'
      ])
    })

    it('should return correct options for Gemini 3 models', () => {
      expect(getModelSupportedReasoningEffort(createModel({ id: 'gemini-3-flash' }))).toEqual(['low', 'medium', 'high'])
      expect(getModelSupportedReasoningEffort(createModel({ id: 'gemini-3-pro-preview' }))).toEqual([
        'low',
        'medium',
        'high'
      ])
    })
  })

  describe('Qwen models', () => {
    it('should return correct options for controllable Qwen models', () => {
      expect(getModelSupportedReasoningEffort(createModel({ id: 'qwen-plus' }))).toEqual([
        'none',
        'low',
        'medium',
        'high'
      ])
      expect(getModelSupportedReasoningEffort(createModel({ id: 'qwen-turbo' }))).toEqual([
        'none',
        'low',
        'medium',
        'high'
      ])
      expect(getModelSupportedReasoningEffort(createModel({ id: 'qwen-flash' }))).toEqual([
        'none',
        'low',
        'medium',
        'high'
      ])
      expect(getModelSupportedReasoningEffort(createModel({ id: 'qwen3-8b' }))).toEqual([
        'none',
        'low',
        'medium',
        'high'
      ])
    })

    it('should return undefined for always-thinking Qwen models', () => {
      // These models always think and don't support thinking token control
      expect(getModelSupportedReasoningEffort(createModel({ id: 'qwen3-thinking' }))).toBeUndefined()
      expect(getModelSupportedReasoningEffort(createModel({ id: 'qwen3-vl-235b-thinking' }))).toBeUndefined()
    })
  })

  describe('Doubao models', () => {
    it('should return correct options for auto-thinking Doubao models', () => {
      expect(getModelSupportedReasoningEffort(createModel({ id: 'doubao-seed-1.6' }))).toEqual(['none', 'auto', 'high'])
      expect(getModelSupportedReasoningEffort(createModel({ id: 'doubao-1-5-thinking-pro-m' }))).toEqual([
        'none',
        'auto',
        'high'
      ])
    })

    it('should return correct options for Doubao models after 251015', () => {
      expect(getModelSupportedReasoningEffort(createModel({ id: 'doubao-seed-1-6-251015' }))).toEqual([
        'minimal',
        'low',
        'medium',
        'high'
      ])
      expect(getModelSupportedReasoningEffort(createModel({ id: 'doubao-seed-1-6-lite-251015' }))).toEqual([
        'minimal',
        'low',
        'medium',
        'high'
      ])
    })

    it('should return correct options for other Doubao thinking models', () => {
      expect(getModelSupportedReasoningEffort(createModel({ id: 'doubao-1.5-thinking-vision-pro' }))).toEqual([
        'none',
        'high'
      ])
    })
  })

  describe('Other providers', () => {
    it('should return correct options for Hunyuan models', () => {
      expect(getModelSupportedReasoningEffort(createModel({ id: 'hunyuan-a13b' }))).toEqual(['none', 'auto'])
    })

    it('should return correct options for Zhipu models', () => {
      expect(getModelSupportedReasoningEffort(createModel({ id: 'glm-4.5' }))).toEqual(['none', 'auto'])
      expect(getModelSupportedReasoningEffort(createModel({ id: 'glm-4.6' }))).toEqual(['none', 'auto'])
    })

    it('should return correct options for Perplexity models', () => {
      expect(getModelSupportedReasoningEffort(createModel({ id: 'sonar-deep-research' }))).toEqual(['medium'])
    })

    it('should return correct options for DeepSeek hybrid models', () => {
      expect(getModelSupportedReasoningEffort(createModel({ id: 'deepseek-v3.1', provider: 'deepseek' }))).toEqual([
        'none',
        'auto'
      ])
      expect(getModelSupportedReasoningEffort(createModel({ id: 'deepseek-v3.2', provider: 'openrouter' }))).toEqual([
        'none',
        'auto'
      ])
      expect(getModelSupportedReasoningEffort(createModel({ id: 'deepseek-chat', provider: 'deepseek' }))).toEqual([
        'none',
        'auto'
      ])
    })
  })

  describe('Name-based fallback', () => {
    it('should fall back to name when id does not match', () => {
      // Grok 4 Fast requires openrouter provider to be recognized
      expect(
        getModelSupportedReasoningEffort(
          createModel({
            id: 'custom-id',
            name: 'grok-4-fast',
            provider: 'openrouter'
          })
        )
      ).toEqual(['none', 'auto'])

      expect(
        getModelSupportedReasoningEffort(
          createModel({
            id: 'custom-id',
            name: 'gpt-5.1'
          })
        )
      ).toEqual(['none', 'low', 'medium', 'high'])

      // Qwen models work well for name-based fallback
      expect(
        getModelSupportedReasoningEffort(
          createModel({
            id: 'custom-id',
            name: 'qwen-plus'
          })
        )
      ).toEqual(['none', 'low', 'medium', 'high'])
    })

    it('should use id result when id matches', () => {
      expect(
        getModelSupportedReasoningEffort(
          createModel({
            id: 'gpt-5.1',
            name: 'Different Name'
          })
        )
      ).toEqual(['none', 'low', 'medium', 'high'])

      expect(
        getModelSupportedReasoningEffort(
          createModel({
            id: 'o3-mini',
            name: 'Some other name'
          })
        )
      ).toEqual(['low', 'medium', 'high'])
    })
  })

  describe('Case sensitivity', () => {
    it('should handle case insensitive model IDs', () => {
      expect(getModelSupportedReasoningEffort(createModel({ id: 'GPT-5.1' }))).toEqual([
        'none',
        'low',
        'medium',
        'high'
      ])
      expect(getModelSupportedReasoningEffort(createModel({ id: 'O3-MINI' }))).toEqual(['low', 'medium', 'high'])
      expect(getModelSupportedReasoningEffort(createModel({ id: 'Gemini-2.5-Flash-Latest' }))).toEqual([
        'none',
        'low',
        'medium',
        'high',
        'auto'
      ])
    })
  })

  describe('Integration with MODEL_SUPPORTED_OPTIONS', () => {
    it('should return values that match MODEL_SUPPORTED_OPTIONS configuration', () => {
      // Verify that returned values match the configuration
      const model = createModel({ id: 'o3' })
      const result = getModelSupportedReasoningEffort(model)
      expect(result).toEqual(MODEL_SUPPORTED_OPTIONS.o)

      const gpt5Model = createModel({ id: 'gpt-5' })
      const gpt5Result = getModelSupportedReasoningEffort(gpt5Model)
      expect(gpt5Result).toEqual(MODEL_SUPPORTED_OPTIONS.gpt5)

      const geminiModel = createModel({ id: 'gemini-2.5-flash-latest' })
      const geminiResult = getModelSupportedReasoningEffort(geminiModel)
      expect(geminiResult).toEqual(MODEL_SUPPORTED_OPTIONS.gemini)
    })
  })
})
