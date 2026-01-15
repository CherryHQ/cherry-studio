import type { Model } from '@renderer/types'
import { describe, expect, it, vi } from 'vitest'

import { isSupportNoneReasoningEffortModel } from '../openai'

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
