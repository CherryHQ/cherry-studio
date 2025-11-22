import { describe, expect, it, vi } from 'vitest'

import {
  findTokenLimit,
  isDoubaoSeedAfter251015,
  isDoubaoThinkingAutoModel,
  isGeminiReasoningModel,
  isLingReasoningModel,
  isSupportedThinkingTokenGeminiModel
} from '../models/reasoning'

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
    { modelId: 'qwen3-7b', expected: { min: 1_024, max: 38_912 } },
    { modelId: 'claude-3.7-sonnet-extended', expected: { min: 1_024, max: 64_000 } },
    { modelId: 'claude-sonnet-4.1', expected: { min: 1_024, max: 64_000 } },
    { modelId: 'claude-sonnet-4-5-20250929', expected: { min: 1_024, max: 64_000 } },
    { modelId: 'claude-opus-4-1-extended', expected: { min: 1_024, max: 32_000 } }
  ]

  it.each(cases)('returns correct limits for $modelId', ({ modelId, expected }) => {
    expect(findTokenLimit(modelId)).toEqual(expected)
  })

  it('returns undefined for unknown models', () => {
    expect(findTokenLimit('unknown-model')).toBeUndefined()
  })
})
