import { Model } from '@renderer/types'
import { beforeEach, describe, expect, test, vi } from 'vitest'

import { isQwenReasoningModel, isSupportedThinkingTokenQwenModel, isVisionModel } from '../../models'

// Suggested test cases
describe('Qwen Model Detection', () => {
  beforeEach(() => {
    vi.mock('@renderer/store/llm', () => ({
      initialState: {}
    }))
    vi.mock('@renderer/services/AssistantService', () => ({
      getProviderByModel: vi.fn().mockReturnValue({ id: 'cherryin' })
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
