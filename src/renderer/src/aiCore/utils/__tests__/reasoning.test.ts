import * as models from '@renderer/config/models'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getAnthropicThinkingBudget } from '../reasoning'

vi.mock('@renderer/store', () => ({
  default: {
    getState: () => ({
      llm: {
        providers: []
      },
      settings: {}
    })
  },
  useAppDispatch: () => vi.fn(),
  useAppSelector: () => vi.fn()
}))

vi.mock('@renderer/hooks/useSettings', () => ({
  getStoreSetting: () => undefined,
  useSettings: () => ({})
}))

vi.mock('@renderer/services/AssistantService', () => ({
  getAssistantSettings: () => ({ maxTokens: undefined }),
  getProviderByModel: () => ({ id: '' })
}))

describe('reasoning utils', () => {
  describe('getAnthropicThinkingBudget', () => {
    const findTokenLimitSpy = vi.spyOn(models, 'findTokenLimit')
    const applyTokenLimit = (limit?: { min: number; max: number }) => findTokenLimitSpy.mockReturnValueOnce(limit)

    beforeEach(() => {
      findTokenLimitSpy.mockReset()
    })

    it('returns 0 when reasoningEffort is undefined', () => {
      const result = getAnthropicThinkingBudget(8000, undefined, 'claude-model')
      expect(result).toBe(0)
      expect(findTokenLimitSpy).not.toHaveBeenCalled()
    })

    it('returns 0 when tokenLimit is not found', () => {
      const unknownId = 'unknown-model'
      applyTokenLimit(undefined)
      const result = getAnthropicThinkingBudget(8000, 'medium', unknownId)
      expect(result).toBe(0)
      expect(findTokenLimitSpy).toHaveBeenCalledWith(unknownId)
    })

    it('uses DEFAULT_MAX_TOKENS when maxTokens is undefined', () => {
      applyTokenLimit({ min: 1000, max: 10_000 })
      const result = getAnthropicThinkingBudget(undefined, 'medium', 'claude-model')
      expect(result).toBe(2048)
      expect(findTokenLimitSpy).toHaveBeenCalledWith('claude-model')
    })

    it('respects maxTokens limit when lower than token limit', () => {
      applyTokenLimit({ min: 1000, max: 10_000 })
      const result = getAnthropicThinkingBudget(8000, 'medium', 'claude-model')
      expect(result).toBe(4000)
      expect(findTokenLimitSpy).toHaveBeenCalledWith('claude-model')
    })

    it('caps to token limit when lower than maxTokens budget', () => {
      applyTokenLimit({ min: 1000, max: 5000 })
      const result = getAnthropicThinkingBudget(100_000, 'high', 'claude-model')
      expect(result).toBe(4200)
      expect(findTokenLimitSpy).toHaveBeenCalledWith('claude-model')
    })

    it('enforces minimum budget of 1024', () => {
      applyTokenLimit({ min: 0, max: 500 })
      const result = getAnthropicThinkingBudget(200, 'low', 'claude-model')
      expect(result).toBe(1024)
      expect(findTokenLimitSpy).toHaveBeenCalledWith('claude-model')
    })

    it('respects large token limits when maxTokens is high', () => {
      applyTokenLimit({ min: 1024, max: 64_000 })
      const result = getAnthropicThinkingBudget(64_000, 'high', 'claude-model')
      expect(result).toBe(51_200)
      expect(findTokenLimitSpy).toHaveBeenCalledWith('claude-model')
    })
  })
})
