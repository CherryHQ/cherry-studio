import {
  isImageEnhancementModel as _isImageEnhancementModel,
  isQwenReasoningModel as _isQwenReasoningModel,
  isSupportedThinkingTokenQwenModel as _isSupportedThinkingTokenQwenModel,
  isVisionModel as _isVisionModel
} from '@renderer/config/models'
import { toSharedCompatModel } from '@renderer/config/models/_bridge'
import { isQwen35to39Model as _isQwen35to39Model } from '@renderer/config/models/qwen'
import type { Model as V1Model } from '@renderer/types'
import type { Model } from '@shared/data/types/model'
import { beforeEach, describe, expect, test, vi } from 'vitest'

// Adapter: route v1-shape inline fixtures through the same id→capability
// inference the registry uses, so the wrappers stay pure v2 while every
// existing assertion keeps its id→behaviour contract.
const A =
  <R>(fn: (m: Model) => R) =>
  (m?: Partial<V1Model> | null): R =>
    fn((m ? toSharedCompatModel(m as V1Model) : m) as Model)
const isImageEnhancementModel = A(_isImageEnhancementModel)
const isQwenReasoningModel = A(_isQwenReasoningModel)
const isSupportedThinkingTokenQwenModel = A(_isSupportedThinkingTokenQwenModel)
const isVisionModel = A(_isVisionModel)
const isQwen35to39Model = A(_isQwen35to39Model)

vi.mock('@renderer/store/llm', () => ({
  initialState: {}
}))

vi.mock('@renderer/store', () => ({
  default: {
    getState: () => ({
      llm: {
        settings: {}
      }
    })
  }
}))

const getProviderByModelMock = vi.fn()
const isEmbeddingModelMock = vi.fn()
const isRerankModelMock = vi.fn()

vi.mock('@renderer/services/AssistantService', () => ({
  getProviderByModel: (...args: any[]) => getProviderByModelMock(...args),
  getAssistantSettings: vi.fn(),
  getDefaultAssistant: vi.fn().mockReturnValue({
    id: 'default',
    name: 'Default Assistant',
    prompt: '',
    settings: {}
  })
}))

vi.mock('@renderer/config/models/embedding', () => ({
  isEmbeddingModel: (...args: any[]) => isEmbeddingModelMock(...args),
  isRerankModel: (...args: any[]) => isRerankModelMock(...args)
}))

beforeEach(() => {
  vi.clearAllMocks()
  getProviderByModelMock.mockReturnValue({ type: 'openai-response' } as any)
  isEmbeddingModelMock.mockReturnValue(false)
  isRerankModelMock.mockReturnValue(false)
})

// Suggested test cases
describe('Qwen Model Detection', () => {
  test('isQwenReasoningModel', () => {
    expect(isQwenReasoningModel({ id: 'qwen3-thinking' })).toBe(true)
    expect(isQwenReasoningModel({ id: 'qwen3-instruct' })).toBe(false)
    expect(isQwenReasoningModel({ id: 'qwen3-max' })).toBe(true)
    expect(isQwenReasoningModel({ id: 'qwen3-8b' })).toBe(true)
    expect(isQwenReasoningModel({ id: 'qwq-32b' })).toBe(true)
    expect(isQwenReasoningModel({ id: 'qwen-plus' })).toBe(true)
    expect(isQwenReasoningModel({ id: 'qwen3-coder' })).toBe(false)
    // Qwen 3.5 series
    expect(isQwenReasoningModel({ id: 'qwen3.5-plus' })).toBe(true)
    expect(isQwenReasoningModel({ id: 'qwen3.5-plus-2026-02-15' })).toBe(true)
    expect(isQwenReasoningModel({ id: 'qwen3.5-397b-a17b' })).toBe(true)
  })

  test('isSupportedThinkingTokenQwenModel', () => {
    // dashscope variants
    // max
    expect(isSupportedThinkingTokenQwenModel({ id: 'qwen3-max' })).toBe(true)
    expect(isSupportedThinkingTokenQwenModel({ id: 'qwen3-max-2026-01-23' })).toBe(true)
    expect(isSupportedThinkingTokenQwenModel({ id: 'qwen3-max-2025-09-23' })).toBe(false)
    expect(isSupportedThinkingTokenQwenModel({ id: 'qwen3-max-preview' })).toBe(true)
    expect(isSupportedThinkingTokenQwenModel({ id: 'qwen-max' })).toBe(false)
    expect(isSupportedThinkingTokenQwenModel({ id: 'qwen-max-latest' })).toBe(true)
    // plus
    expect(isSupportedThinkingTokenQwenModel({ id: 'qwen3.5-plus' })).toBe(true)
    expect(isSupportedThinkingTokenQwenModel({ id: 'qwen-plus' })).toBe(true)
    expect(isSupportedThinkingTokenQwenModel({ id: 'qwen-plus-latest' })).toBe(true)
    expect(isSupportedThinkingTokenQwenModel({ id: 'qwen3.5-plus-2026-02-15' })).toBe(true)
    // flash
    expect(isSupportedThinkingTokenQwenModel({ id: 'qwen3.5-flash' })).toBe(true)
    expect(isSupportedThinkingTokenQwenModel({ id: 'qwen3.5-flash-2026-02-23' })).toBe(true)
    expect(isSupportedThinkingTokenQwenModel({ id: 'qwen-flash' })).toBe(true)
    expect(isSupportedThinkingTokenQwenModel({ id: 'qwen-flash-2025-07-28' })).toBe(true)
    // turbo (deprecated variant in dashscope)
    expect(isSupportedThinkingTokenQwenModel({ id: 'qwen-turbo' })).toBe(true)
    expect(isSupportedThinkingTokenQwenModel({ id: 'qwen-turbo-latest' })).toBe(true)

    // opensource variants
    expect(isSupportedThinkingTokenQwenModel({ id: 'qwen3-instruct' })).toBe(false)
    expect(isSupportedThinkingTokenQwenModel({ id: 'qwen3-thinking' })).toBe(false)
    expect(isSupportedThinkingTokenQwenModel({ id: 'qwen3-8b' })).toBe(true)
    expect(isSupportedThinkingTokenQwenModel({ id: 'qwen3-235b-a22b-thinking-2507' })).toBe(false)
    expect(isSupportedThinkingTokenQwenModel({ id: 'qwq-32b' })).toBe(false)
    expect(isSupportedThinkingTokenQwenModel({ id: 'qwen3-coder' })).toBe(false)
    expect(isSupportedThinkingTokenQwenModel({ id: 'qwen3.5-397b-a17b' })).toBe(true)
    expect(isSupportedThinkingTokenQwenModel({ id: 'qwen3.5-thinking' })).toBe(false)
    expect(isSupportedThinkingTokenQwenModel({ id: 'qwen3.5-instruct' })).toBe(false)
  })

  test('isVisionModel', () => {
    expect(isVisionModel({ id: 'qwen-vl-max' })).toBe(true)
    expect(isVisionModel({ id: 'qwen-omni-turbo' })).toBe(true)
  })

  test('isQwen35to39Model', () => {
    // Qwen 3.5 series
    expect(isQwen35to39Model({ id: 'qwen3.5-plus' })).toBe(true)
    expect(isQwen35to39Model({ id: 'qwen3.5-plus-2026-02-15' })).toBe(true)
    expect(isQwen35to39Model({ id: 'qwen3.5-flash' })).toBe(true)
    expect(isQwen35to39Model({ id: 'qwen3.5-397b-a17b' })).toBe(true)
    expect(isQwen35to39Model({ id: 'qwen3.5-thinking' })).toBe(true)
    expect(isQwen35to39Model({ id: 'qwen3.5-instruct' })).toBe(true)
    // Qwen 3.6+ series (future-proof)
    expect(isQwen35to39Model({ id: 'qwen3.6-plus' })).toBe(true)
    expect(isQwen35to39Model({ id: 'qwen3.6-flash' })).toBe(true)
    expect(isQwen35to39Model({ id: 'qwen3.7-200b' })).toBe(true)
    expect(isQwen35to39Model({ id: 'qwen3.9-thinking' })).toBe(true)
    // Not Qwen 3.5~3.9
    expect(isQwen35to39Model({ id: 'qwen3-max' })).toBe(false)
    expect(isQwen35to39Model({ id: 'qwen3-8b' })).toBe(false)
    expect(isQwen35to39Model({ id: 'qwen-plus' })).toBe(false)
    expect(isQwen35to39Model(undefined)).toBe(false)
  })
})

describe('Vision Model Detection', () => {
  test('isVisionModel', () => {
    expect(isVisionModel({ id: 'qwen-vl-max' })).toBe(true)
    expect(isVisionModel({ id: 'qwen-omni-turbo' })).toBe(true)
  })
  test('isImageEnhancementModel', () => {
    expect(isImageEnhancementModel({ id: 'gpt-image-1' })).toBe(true)
    expect(isImageEnhancementModel({ id: 'gemini-2.5-flash-image-preview' })).toBe(true)
    expect(isImageEnhancementModel({ id: 'gemini-2.0-flash-preview-image-generation' })).toBe(true)
    expect(isImageEnhancementModel({ id: 'qwen-image-edit' })).toBe(true)
    expect(isImageEnhancementModel({ id: 'grok-2-image-latest' })).toBe(true)
  })
})
