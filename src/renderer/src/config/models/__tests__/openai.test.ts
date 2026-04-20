import type { Model } from '@renderer/types'
import { describe, expect, it, vi } from 'vitest'

import {
  isGPT5FamilyModel,
  isGPT5ProModel,
  isGPT5SeriesModel,
  isGPT5SeriesReasoningModel,
  isGPT51SeriesModel,
  isOpenAIChatCompletionOnlyModel,
  isOpenAILLMModel,
  isOpenAIModel,
  isOpenAIOpenWeightModel,
  isSupportNoneReasoningEffortModel,
  isSupportVerbosityModel
} from '../openai'

// Mock store and settings to avoid initialization issues
vi.mock('@renderer/store', () => ({
  __esModule: true,
  default: {
    getState: () => ({
      llm: { providers: [] },
      settings: {}
    })
  }
}))

vi.mock('@renderer/hooks/useStore', () => ({
  getStoreProviders: vi.fn(() => [])
}))

const createModel = (overrides: Partial<Model> = {}): Model => ({
  id: 'gpt-4o',
  name: 'gpt-4o',
  provider: 'openai',
  group: 'OpenAI',
  ...overrides
})

describe('OpenAI Model Detection', () => {
  describe('isOpenAILLMModel', () => {
    it('returns false for undefined model', () => {
      expect(isOpenAILLMModel(undefined as unknown as Model)).toBe(false)
    })

    it('returns false for image generation models', () => {
      expect(isOpenAILLMModel(createModel({ id: 'gpt-4o-image' }))).toBe(false)
    })

    it('returns true for reasoning models', () => {
      expect(isOpenAILLMModel(createModel({ id: 'o1-preview' }))).toBe(true)
    })

    it('returns true for GPT-prefixed models', () => {
      expect(isOpenAILLMModel(createModel({ id: 'GPT-5-turbo' }))).toBe(true)
    })

    it('returns false for GPTQ quantized models', () => {
      expect(isOpenAILLMModel(createModel({ id: 'Qwen3.5-122B-A10B-GPTQ' }))).toBe(false)
      expect(isOpenAILLMModel(createModel({ id: 'Qwen/Qwen3.5-122B-Instruct-GPTQ-Int4' }))).toBe(false)
      expect(isOpenAILLMModel(createModel({ id: 'llama-3-70b-gptq' }))).toBe(false)
    })
  })

  describe('isOpenAIModel', () => {
    it('returns false for undefined model', () => {
      expect(isOpenAIModel(undefined as unknown as Model)).toBe(false)
    })

    it('detects models via GPT prefix', () => {
      expect(isOpenAIModel(createModel({ id: 'gpt-4.1' }))).toBe(true)
      expect(isOpenAIModel(createModel({ id: 'gpt-4o' }))).toBe(true)
      expect(isOpenAIModel(createModel({ id: 'gpt-4o-image' }))).toBe(true)
    })

    it('detects models via reasoning support', () => {
      expect(isOpenAIModel(createModel({ id: 'o3' }))).toBe(true)
      expect(isOpenAIModel(createModel({ id: 'o4-mini' }))).toBe(true)
      expect(isOpenAIModel(createModel({ id: 'o1' }))).toBe(true)
    })

    it('returns false for non-OpenAI models', () => {
      expect(isOpenAIModel(createModel({ id: 'claude-3.5-sonnet' }))).toBe(false)
      expect(isOpenAIModel(createModel({ id: 'gemini-2.0' }))).toBe(false)
      expect(isOpenAIModel(createModel({ id: 'deepseek-r1' }))).toBe(false)
    })

    it('returns false for GPTQ quantized models', () => {
      expect(isOpenAIModel(createModel({ id: 'Qwen3.5-122B-A10B-GPTQ' }))).toBe(false)
      expect(isOpenAIModel(createModel({ id: 'llama-3-70b-gptq' }))).toBe(false)
    })
  })

  describe('isOpenAIChatCompletionOnlyModel', () => {
    it('identifies chat-completion-only models', () => {
      expect(isOpenAIChatCompletionOnlyModel(createModel({ id: 'gpt-4o-search-preview' }))).toBe(true)
      expect(isOpenAIChatCompletionOnlyModel(createModel({ id: 'o1-mini' }))).toBe(true)
    })

    it('returns false for general models', () => {
      expect(isOpenAIChatCompletionOnlyModel(createModel({ id: 'gpt-4o' }))).toBe(false)
    })
  })

  describe('isOpenAIOpenWeightModel', () => {
    it('detects OpenAI open weight models', () => {
      expect(isOpenAIOpenWeightModel(createModel({ id: 'gpt-oss-free' }))).toBe(true)
    })
  })

  describe('GPT-5 family detection', () => {
    describe('isGPT5FamilyModel', () => {
      it('returns true for GPT-5 base models', () => {
        expect(isGPT5FamilyModel(createModel({ id: 'gpt-5' }))).toBe(true)
        expect(isGPT5FamilyModel(createModel({ id: 'gpt-5-preview' }))).toBe(true)
        expect(isGPT5FamilyModel(createModel({ id: 'gpt-5-pro' }))).toBe(true)
        expect(isGPT5FamilyModel(createModel({ id: 'gpt-5-chat' }))).toBe(true)
      })

      it('returns true for GPT-5.x sub-version models', () => {
        expect(isGPT5FamilyModel(createModel({ id: 'gpt-5.1' }))).toBe(true)
        expect(isGPT5FamilyModel(createModel({ id: 'gpt-5.1-mini' }))).toBe(true)
        expect(isGPT5FamilyModel(createModel({ id: 'gpt-5.2-pro' }))).toBe(true)
        expect(isGPT5FamilyModel(createModel({ id: 'gpt-5.4' }))).toBe(true)
      })

      it('returns false for non-GPT-5 models', () => {
        expect(isGPT5FamilyModel(createModel({ id: 'gpt-4o' }))).toBe(false)
        expect(isGPT5FamilyModel(createModel({ id: 'gpt-4.1' }))).toBe(false)
        expect(isGPT5FamilyModel(createModel({ id: 'claude-3.5' }))).toBe(false)
        expect(isGPT5FamilyModel(createModel({ id: 'o3-mini' }))).toBe(false)
      })
    })

    describe('isGPT5SeriesModel', () => {
      it('returns true for GPT-5 base models', () => {
        expect(isGPT5SeriesModel(createModel({ id: 'gpt-5' }))).toBe(true)
        expect(isGPT5SeriesModel(createModel({ id: 'gpt-5-preview' }))).toBe(true)
        expect(isGPT5SeriesModel(createModel({ id: 'gpt-5-pro' }))).toBe(true)
      })

      it('returns false for GPT-5.x sub-version models', () => {
        expect(isGPT5SeriesModel(createModel({ id: 'gpt-5.1-preview' }))).toBe(false)
        expect(isGPT5SeriesModel(createModel({ id: 'gpt-5.2' }))).toBe(false)
        expect(isGPT5SeriesModel(createModel({ id: 'gpt-5.4' }))).toBe(false)
        expect(isGPT5SeriesModel(createModel({ id: 'gpt-5.9-turbo' }))).toBe(false)
      })

      it('returns false for non-GPT-5 models', () => {
        expect(isGPT5SeriesModel(createModel({ id: 'gpt-4o' }))).toBe(false)
        expect(isGPT5SeriesModel(createModel({ id: 'gpt-4.1' }))).toBe(false)
      })
    })

    describe('isGPT51SeriesModel', () => {
      it('returns true for GPT-5.1 models', () => {
        expect(isGPT51SeriesModel(createModel({ id: 'gpt-5.1-mini' }))).toBe(true)
      })
    })

    describe('isGPT5SeriesReasoningModel', () => {
      it('returns true for GPT-5 reasoning models', () => {
        expect(isGPT5SeriesReasoningModel(createModel({ id: 'gpt-5' }))).toBe(true)
      })
      it('returns false for gpt-5-chat', () => {
        expect(isGPT5SeriesReasoningModel(createModel({ id: 'gpt-5-chat' }))).toBe(false)
      })
    })

    describe('isGPT5ProModel', () => {
      it('returns true for GPT-5 Pro models', () => {
        expect(isGPT5ProModel(createModel({ id: 'gpt-5-pro' }))).toBe(true)
      })

      it('returns false for non-Pro GPT-5 models', () => {
        expect(isGPT5ProModel(createModel({ id: 'gpt-5-preview' }))).toBe(false)
      })
    })
  })

  describe('isSupportVerbosityModel', () => {
    it('returns true for GPT-5 models', () => {
      expect(isSupportVerbosityModel(createModel({ id: 'gpt-5' }))).toBe(true)
    })

    it('returns true for GPT-5.x sub-version models', () => {
      expect(isSupportVerbosityModel(createModel({ id: 'gpt-5.1-preview' }))).toBe(true)
      expect(isSupportVerbosityModel(createModel({ id: 'gpt-5.2' }))).toBe(true)
      expect(isSupportVerbosityModel(createModel({ id: 'gpt-5.4' }))).toBe(true)
    })

    it('returns true for GPT-5 chat and codex models (granular exclusion handled by validators)', () => {
      expect(isSupportVerbosityModel(createModel({ id: 'gpt-5-chat' }))).toBe(true)
      expect(isSupportVerbosityModel(createModel({ id: 'gpt-5.1-chat' }))).toBe(true)
      expect(isSupportVerbosityModel(createModel({ id: 'gpt-5.1-codex' }))).toBe(true)
    })

    it('returns false for non-GPT-5 models', () => {
      expect(isSupportVerbosityModel(createModel({ id: 'gpt-4o' }))).toBe(false)
    })
  })

  describe('isSupportNoneReasoningEffortModel', () => {
    describe('should return true for GPT-5.1 and GPT-5.2 reasoning models', () => {
      it('returns true for GPT-5.1 base model', () => {
        expect(isSupportNoneReasoningEffortModel(createModel({ id: 'gpt-5.1' }))).toBe(true)
        expect(isSupportNoneReasoningEffortModel(createModel({ id: 'GPT-5.1' }))).toBe(true)
      })

      it('returns true for GPT-5.1 mini model', () => {
        expect(isSupportNoneReasoningEffortModel(createModel({ id: 'gpt-5.1-mini' }))).toBe(true)
        expect(isSupportNoneReasoningEffortModel(createModel({ id: 'gpt-5.1-mini-preview' }))).toBe(true)
      })

      it('returns true for GPT-5.1 preview model', () => {
        expect(isSupportNoneReasoningEffortModel(createModel({ id: 'gpt-5.1-preview' }))).toBe(true)
      })

      it('returns true for GPT-5.2 base model', () => {
        expect(isSupportNoneReasoningEffortModel(createModel({ id: 'gpt-5.2' }))).toBe(true)
        expect(isSupportNoneReasoningEffortModel(createModel({ id: 'GPT-5.2' }))).toBe(true)
      })

      it('returns true for GPT-5.2 mini model', () => {
        expect(isSupportNoneReasoningEffortModel(createModel({ id: 'gpt-5.2-mini' }))).toBe(true)
        expect(isSupportNoneReasoningEffortModel(createModel({ id: 'gpt-5.2-mini-preview' }))).toBe(true)
      })

      it('returns true for GPT-5.2 preview model', () => {
        expect(isSupportNoneReasoningEffortModel(createModel({ id: 'gpt-5.2-preview' }))).toBe(true)
      })
    })

    describe('should return false for pro variants', () => {
      it('returns false for GPT-5.1-pro models', () => {
        expect(isSupportNoneReasoningEffortModel(createModel({ id: 'gpt-5.1-pro' }))).toBe(false)
        expect(isSupportNoneReasoningEffortModel(createModel({ id: 'GPT-5.1-Pro' }))).toBe(false)
        expect(isSupportNoneReasoningEffortModel(createModel({ id: 'gpt-5.1-pro-preview' }))).toBe(false)
      })

      it('returns false for GPT-5.2-pro models', () => {
        expect(isSupportNoneReasoningEffortModel(createModel({ id: 'gpt-5.2-pro' }))).toBe(false)
        expect(isSupportNoneReasoningEffortModel(createModel({ id: 'GPT-5.2-Pro' }))).toBe(false)
        expect(isSupportNoneReasoningEffortModel(createModel({ id: 'gpt-5.2-pro-preview' }))).toBe(false)
      })
    })

    describe('should return false for chat variants', () => {
      it('returns false for GPT-5.1-chat models', () => {
        expect(isSupportNoneReasoningEffortModel(createModel({ id: 'gpt-5.1-chat' }))).toBe(false)
        expect(isSupportNoneReasoningEffortModel(createModel({ id: 'GPT-5.1-Chat' }))).toBe(false)
      })

      it('returns false for GPT-5.2-chat models', () => {
        expect(isSupportNoneReasoningEffortModel(createModel({ id: 'gpt-5.2-chat' }))).toBe(false)
        expect(isSupportNoneReasoningEffortModel(createModel({ id: 'GPT-5.2-Chat' }))).toBe(false)
      })
    })

    describe('should return true for future GPT-5.x sub-versions', () => {
      it('returns true for GPT-5.4 models', () => {
        expect(isSupportNoneReasoningEffortModel(createModel({ id: 'gpt-5.4' }))).toBe(true)
        expect(isSupportNoneReasoningEffortModel(createModel({ id: 'gpt-5.4-mini' }))).toBe(true)
      })

      it('returns false for future GPT-5.x pro/chat variants', () => {
        expect(isSupportNoneReasoningEffortModel(createModel({ id: 'gpt-5.4-pro' }))).toBe(false)
        expect(isSupportNoneReasoningEffortModel(createModel({ id: 'gpt-5.4-chat' }))).toBe(false)
      })

      it('returns true for future GPT-5.x codex variants (5.3+)', () => {
        expect(isSupportNoneReasoningEffortModel(createModel({ id: 'gpt-5.3-codex' }))).toBe(true)
        expect(isSupportNoneReasoningEffortModel(createModel({ id: 'gpt-5.4-codex' }))).toBe(true)
      })
    })

    describe('should return false for GPT-5.1/5.2 codex variants', () => {
      it('returns false for GPT-5.1 codex models', () => {
        expect(isSupportNoneReasoningEffortModel(createModel({ id: 'gpt-5.1-codex' }))).toBe(false)
        expect(isSupportNoneReasoningEffortModel(createModel({ id: 'gpt-5.1-codex-mini' }))).toBe(false)
      })

      it('returns false for GPT-5.2 codex models', () => {
        expect(isSupportNoneReasoningEffortModel(createModel({ id: 'gpt-5.2-codex' }))).toBe(false)
      })
    })

    describe('should return false for GPT-5 series (non-5.1/5.2)', () => {
      it('returns false for GPT-5 base model', () => {
        expect(isSupportNoneReasoningEffortModel(createModel({ id: 'gpt-5' }))).toBe(false)
      })

      it('returns false for GPT-5 pro model', () => {
        expect(isSupportNoneReasoningEffortModel(createModel({ id: 'gpt-5-pro' }))).toBe(false)
      })

      it('returns false for GPT-5 preview model', () => {
        expect(isSupportNoneReasoningEffortModel(createModel({ id: 'gpt-5-preview' }))).toBe(false)
      })
    })

    describe('should return false for other OpenAI models', () => {
      it('returns false for GPT-4 models', () => {
        expect(isSupportNoneReasoningEffortModel(createModel({ id: 'gpt-4o' }))).toBe(false)
        expect(isSupportNoneReasoningEffortModel(createModel({ id: 'gpt-4-turbo' }))).toBe(false)
      })

      it('returns false for o1 models', () => {
        expect(isSupportNoneReasoningEffortModel(createModel({ id: 'o1' }))).toBe(false)
        expect(isSupportNoneReasoningEffortModel(createModel({ id: 'o1-mini' }))).toBe(false)
        expect(isSupportNoneReasoningEffortModel(createModel({ id: 'o1-preview' }))).toBe(false)
      })

      it('returns false for o3 models', () => {
        expect(isSupportNoneReasoningEffortModel(createModel({ id: 'o3' }))).toBe(false)
        expect(isSupportNoneReasoningEffortModel(createModel({ id: 'o3-mini' }))).toBe(false)
      })
    })

    describe('edge cases', () => {
      it('handles models with version suffixes', () => {
        expect(isSupportNoneReasoningEffortModel(createModel({ id: 'gpt-5.1-2025-01-01' }))).toBe(true)
        expect(isSupportNoneReasoningEffortModel(createModel({ id: 'gpt-5.2-latest' }))).toBe(true)
        expect(isSupportNoneReasoningEffortModel(createModel({ id: 'gpt-5.1-pro-2025-01-01' }))).toBe(false)
      })

      it('handles models with OpenRouter prefixes', () => {
        expect(isSupportNoneReasoningEffortModel(createModel({ id: 'openai/gpt-5.1' }))).toBe(true)
        expect(isSupportNoneReasoningEffortModel(createModel({ id: 'openai/gpt-5.2-mini' }))).toBe(true)
        expect(isSupportNoneReasoningEffortModel(createModel({ id: 'openai/gpt-5.1-pro' }))).toBe(false)
        expect(isSupportNoneReasoningEffortModel(createModel({ id: 'openai/gpt-5.1-chat' }))).toBe(false)
      })

      it('handles mixed case with chat and pro', () => {
        expect(isSupportNoneReasoningEffortModel(createModel({ id: 'GPT-5.1-CHAT' }))).toBe(false)
        expect(isSupportNoneReasoningEffortModel(createModel({ id: 'GPT-5.2-PRO' }))).toBe(false)
      })
    })
  })
})
