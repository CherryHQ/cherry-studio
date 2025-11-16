import type { Model } from '@renderer/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { isEmbeddingModel, isRerankModel } from '../embedding'
import {
  findTokenLimit,
  getThinkModelType,
  isClaude45ReasoningModel,
  isClaudeReasoningModel,
  isDeepSeekHybridInferenceModel,
  isDoubaoSeedAfter251015,
  isDoubaoThinkingAutoModel,
  isGrok4FastReasoningModel,
  isHunyuanReasoningModel,
  isLingReasoningModel,
  isMiniMaxReasoningModel,
  isOpenAIReasoningModel,
  isPerplexityReasoningModel,
  isQwenAlwaysThinkModel,
  isReasoningModel,
  isStepReasoningModel,
  isSupportedReasoningEffortGrokModel,
  isSupportedReasoningEffortModel,
  isSupportedReasoningEffortOpenAIModel,
  isSupportedReasoningEffortPerplexityModel,
  isSupportedThinkingTokenDoubaoModel,
  isSupportedThinkingTokenGeminiModel,
  isSupportedThinkingTokenModel,
  isSupportedThinkingTokenQwenModel,
  isSupportedThinkingTokenZhipuModel,
  isZhipuReasoningModel
} from '../reasoning'
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
  isTextToImageModel: vi.fn()
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
    expect(isClaude45ReasoningModel(createModel({ id: 'claude-3-sonnet' }))).toBe(false)
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

    const allowed = createModel({ id: 'deepseek-v3.1', provider: 'doubao' })
    expect(isSupportedThinkingTokenModel(allowed)).toBe(true)

    const disallowed = createModel({ id: 'deepseek-v3.1', provider: 'unknown' })
    expect(isSupportedThinkingTokenModel(disallowed)).toBe(false)
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

describe('Token limit lookup', () => {
  it.each([
    ['gemini-2.5-flash-lite-latest', { min: 512, max: 24576 }],
    ['qwen-plus-2025-07-14', { min: 0, max: 38912 }],
    ['claude-haiku-4', { min: 1024, max: 64000 }]
  ])('returns configured min/max pairs for %s', (id, expected) => {
    expect(findTokenLimit(id)).toEqual(expected)
  })

  it('returns undefined when regex misses', () => {
    expect(findTokenLimit('unknown-model')).toBeUndefined()
  })
})
