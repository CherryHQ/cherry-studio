import {
  isImageEnhancementModel,
  isPureGenerateImageModel,
  isQwenReasoningModel,
  isSupportedThinkingTokenQwenModel,
  isVisionModel,
  isWebSearchModel
} from '@renderer/config/models'
import type { Model } from '@renderer/types'
import { beforeEach, describe, expect, test, vi } from 'vitest'

// Suggested test cases
describe('Qwen Model Detection', () => {
  beforeEach(() => {
    vi.mock('@renderer/store/llm', () => ({
      initialState: {}
    }))
    vi.mock('@renderer/services/AssistantService', () => ({
      getProviderByModel: vi.fn().mockReturnValue({ id: 'cherryai' })
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
  })
  test('isQwenReasoningModel', () => {
    expect(isQwenReasoningModel({ id: 'qwen3-thinking' } as Model)).toBe(true)
    expect(isQwenReasoningModel({ id: 'qwen3-instruct' } as Model)).toBe(false)
    expect(isQwenReasoningModel({ id: 'qwen3-max' } as Model)).toBe(false)
    expect(isQwenReasoningModel({ id: 'qwen3-8b' } as Model)).toBe(true)
    expect(isQwenReasoningModel({ id: 'qwq-32b' } as Model)).toBe(true)
    expect(isQwenReasoningModel({ id: 'qwen-plus' } as Model)).toBe(true)
    expect(isQwenReasoningModel({ id: 'qwen3-coder' } as Model)).toBe(false)
  })

  test('isSupportedThinkingTokenQwenModel', () => {
    expect(isSupportedThinkingTokenQwenModel({ id: 'qwen3-max' } as Model)).toBe(false)
    expect(isSupportedThinkingTokenQwenModel({ id: 'qwen3-instruct' } as Model)).toBe(false)
    expect(isSupportedThinkingTokenQwenModel({ id: 'qwen3-thinking' } as Model)).toBe(false)
    expect(isSupportedThinkingTokenQwenModel({ id: 'qwen3-8b' } as Model)).toBe(true)
    expect(isSupportedThinkingTokenQwenModel({ id: 'qwen3-235b-a22b-thinking-2507' } as Model)).toBe(false)
    expect(isSupportedThinkingTokenQwenModel({ id: 'qwen-plus' } as Model)).toBe(true)
    expect(isSupportedThinkingTokenQwenModel({ id: 'qwq-32b' } as Model)).toBe(false)
    expect(isSupportedThinkingTokenQwenModel({ id: 'qwen3-coder' } as Model)).toBe(false)
  })

  test('isVisionModel', () => {
    expect(isVisionModel({ id: 'qwen-vl-max' } as Model)).toBe(true)
    expect(isVisionModel({ id: 'qwen-omni-turbo' } as Model)).toBe(true)
  })
})

describe('Vision Model Detection', () => {
  beforeEach(() => {
    vi.mock('@renderer/store/llm', () => ({
      initialState: {}
    }))
    vi.mock('@renderer/services/AssistantService', () => ({
      getProviderByModel: vi.fn().mockReturnValue({ id: 'cherryai' })
    }))
  })
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
  test('isPureGenerateImageModel', () => {
    expect(isPureGenerateImageModel({ id: 'gpt-image-1' } as Model)).toBe(true)
    expect(isPureGenerateImageModel({ id: 'gemini-2.5-flash-image-preview' } as Model)).toBe(true)
    expect(isPureGenerateImageModel({ id: 'gemini-2.0-flash-preview-image-generation' } as Model)).toBe(true)
    expect(isPureGenerateImageModel({ id: 'grok-2-image-latest' } as Model)).toBe(true)
    expect(isPureGenerateImageModel({ id: 'gpt-4o' } as Model)).toBe(false)
  })
})

describe('Web Search Model Detection', () => {
  beforeEach(() => {
    vi.mock('@renderer/store/llm', () => ({
      initialState: {}
    }))
    vi.mock('@renderer/services/AssistantService', () => ({
      getProviderByModel: vi.fn().mockReturnValue({ id: 'cherryai' })
    }))
  })
  test('isWebSearchModel', () => {
    expect(isWebSearchModel({ id: 'grok-2-image-latest' } as Model)).toBe(false)
  })
})
