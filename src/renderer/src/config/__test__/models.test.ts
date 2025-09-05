import { Model } from '@renderer/types'
import { beforeEach, describe, expect, test, vi } from 'vitest'

import { isQwenReasoningModel, isSupportedThinkingTokenQwenModel } from '../models'

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
  })

  test('isSupportedThinkingTokenQwenModel', () => {
    expect(isSupportedThinkingTokenQwenModel({ id: 'qwen3-max' } as Model)).toBe(false)
    expect(isSupportedThinkingTokenQwenModel({ id: 'qwen3-instruct' } as Model)).toBe(false)
    expect(isSupportedThinkingTokenQwenModel({ id: 'qwen3-thinking' } as Model)).toBe(false)
    expect(isSupportedThinkingTokenQwenModel({ id: 'qwen3-8b' } as Model)).toBe(true)
  })
})
