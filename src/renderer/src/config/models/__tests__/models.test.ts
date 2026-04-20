import {
  isImageEnhancementModel,
  isQwenReasoningModel,
  isSupportedThinkingTokenQwenModel,
  isVisionModel
} from '@renderer/config/models'
import { isQwen35to39Model } from '@renderer/config/models/qwen'
import type { Model } from '@renderer/types'
import { beforeEach, describe, expect, test, vi } from 'vitest'

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
    expect(isQwenReasoningModel({ id: 'qwen3-thinking' } as Model)).toBe(true)
    expect(isQwenReasoningModel({ id: 'qwen3-instruct' } as Model)).toBe(false)
    expect(isQwenReasoningModel({ id: 'qwen3-max' } as Model)).toBe(true)
    expect(isQwenReasoningModel({ id: 'qwen3-8b' } as Model)).toBe(true)
    expect(isQwenReasoningModel({ id: 'qwq-32b' } as Model)).toBe(true)
    expect(isQwenReasoningModel({ id: 'qwen-plus' } as Model)).toBe(true)
    expect(isQwenReasoningModel({ id: 'qwen3-coder' } as Model)).toBe(false)
    // Qwen 3.5 series
    expect(isQwenReasoningModel({ id: 'qwen3.5-plus' } as Model)).toBe(true)
    expect(isQwenReasoningModel({ id: 'qwen3.5-plus-2026-02-15' } as Model)).toBe(true)
    expect(isQwenReasoningModel({ id: 'qwen3.5-397b-a17b' } as Model)).toBe(true)
  })

  test('isSupportedThinkingTokenQwenModel', () => {
    // dashscope variants
    // max
    expect(isSupportedThinkingTokenQwenModel({ id: 'qwen3-max' } as Model)).toBe(true)
    expect(isSupportedThinkingTokenQwenModel({ id: 'qwen3-max-2026-01-23' } as Model)).toBe(true)
    expect(isSupportedThinkingTokenQwenModel({ id: 'qwen3-max-2025-09-23' } as Model)).toBe(false)
    expect(isSupportedThinkingTokenQwenModel({ id: 'qwen3-max-preview' } as Model)).toBe(true)
    expect(isSupportedThinkingTokenQwenModel({ id: 'qwen-max' } as Model)).toBe(false)
    expect(isSupportedThinkingTokenQwenModel({ id: 'qwen-max-latest' } as Model)).toBe(true)
    // plus
    expect(isSupportedThinkingTokenQwenModel({ id: 'qwen3.5-plus' } as Model)).toBe(true)
    expect(isSupportedThinkingTokenQwenModel({ id: 'qwen-plus' } as Model)).toBe(true)
    expect(isSupportedThinkingTokenQwenModel({ id: 'qwen-plus-latest' } as Model)).toBe(true)
    expect(isSupportedThinkingTokenQwenModel({ id: 'qwen3.5-plus-2026-02-15' } as Model)).toBe(true)
    // flash
    expect(isSupportedThinkingTokenQwenModel({ id: 'qwen3.5-flash' } as Model)).toBe(true)
    expect(isSupportedThinkingTokenQwenModel({ id: 'qwen3.5-flash-2026-02-23' } as Model)).toBe(true)
    expect(isSupportedThinkingTokenQwenModel({ id: 'qwen-flash' } as Model)).toBe(true)
    expect(isSupportedThinkingTokenQwenModel({ id: 'qwen-flash-2025-07-28' } as Model)).toBe(true)
    // turbo (deprecated variant in dashscope)
    expect(isSupportedThinkingTokenQwenModel({ id: 'qwen-turbo' } as Model)).toBe(true)
    expect(isSupportedThinkingTokenQwenModel({ id: 'qwen-turbo-latest' } as Model)).toBe(true)

    // opensource variants
    expect(isSupportedThinkingTokenQwenModel({ id: 'qwen3-instruct' } as Model)).toBe(false)
    expect(isSupportedThinkingTokenQwenModel({ id: 'qwen3-thinking' } as Model)).toBe(false)
    expect(isSupportedThinkingTokenQwenModel({ id: 'qwen3-8b' } as Model)).toBe(true)
    expect(isSupportedThinkingTokenQwenModel({ id: 'qwen3-235b-a22b-thinking-2507' } as Model)).toBe(false)
    expect(isSupportedThinkingTokenQwenModel({ id: 'qwq-32b' } as Model)).toBe(false)
    expect(isSupportedThinkingTokenQwenModel({ id: 'qwen3-coder' } as Model)).toBe(false)
    expect(isSupportedThinkingTokenQwenModel({ id: 'qwen3.5-397b-a17b' } as Model)).toBe(true)
    expect(isSupportedThinkingTokenQwenModel({ id: 'qwen3.5-thinking' } as Model)).toBe(false)
    expect(isSupportedThinkingTokenQwenModel({ id: 'qwen3.5-instruct' } as Model)).toBe(false)
  })

  test('isVisionModel', () => {
    expect(isVisionModel({ id: 'qwen-vl-max' } as Model)).toBe(true)
    expect(isVisionModel({ id: 'qwen-omni-turbo' } as Model)).toBe(true)
  })

  test('isQwen35to39Model', () => {
    // Qwen 3.5 series
    expect(isQwen35to39Model({ id: 'qwen3.5-plus' } as Model)).toBe(true)
    expect(isQwen35to39Model({ id: 'qwen3.5-plus-2026-02-15' } as Model)).toBe(true)
    expect(isQwen35to39Model({ id: 'qwen3.5-flash' } as Model)).toBe(true)
    expect(isQwen35to39Model({ id: 'qwen3.5-397b-a17b' } as Model)).toBe(true)
    expect(isQwen35to39Model({ id: 'qwen3.5-thinking' } as Model)).toBe(true)
    expect(isQwen35to39Model({ id: 'qwen3.5-instruct' } as Model)).toBe(true)
    // Qwen 3.6+ series (future-proof)
    expect(isQwen35to39Model({ id: 'qwen3.6-plus' } as Model)).toBe(true)
    expect(isQwen35to39Model({ id: 'qwen3.6-flash' } as Model)).toBe(true)
    expect(isQwen35to39Model({ id: 'qwen3.7-200b' } as Model)).toBe(true)
    expect(isQwen35to39Model({ id: 'qwen3.9-thinking' } as Model)).toBe(true)
    // Not Qwen 3.5~3.9
    expect(isQwen35to39Model({ id: 'qwen3-max' } as Model)).toBe(false)
    expect(isQwen35to39Model({ id: 'qwen3-8b' } as Model)).toBe(false)
    expect(isQwen35to39Model({ id: 'qwen-plus' } as Model)).toBe(false)
    expect(isQwen35to39Model(undefined)).toBe(false)
  })
})

describe('Vision Model Detection', () => {
  test('isVisionModel', () => {
    expect(isVisionModel({ id: 'qwen-vl-max' } as Model)).toBe(true)
    expect(isVisionModel({ id: 'qwen-omni-turbo' } as Model)).toBe(true)
  })
  test('isImageEnhancementModel', () => {
    expect(isImageEnhancementModel({ id: 'gpt-image-1' } as Model)).toBe(true)
    expect(isImageEnhancementModel({ id: 'gemini-2.5-flash-image-preview' } as Model)).toBe(true)
    expect(isImageEnhancementModel({ id: 'gemini-2.0-flash-preview-image-generation' } as Model)).toBe(true)
    expect(isImageEnhancementModel({ id: 'qwen-image-edit' } as Model)).toBe(true)
    expect(isImageEnhancementModel({ id: 'grok-2-image-latest' } as Model)).toBe(true)
  })
})
