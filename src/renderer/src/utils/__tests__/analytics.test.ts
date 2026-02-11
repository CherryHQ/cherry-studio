import type { Model, Usage } from '@renderer/types'
import type { LanguageModelUsage } from 'ai'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { trackTokenUsage } from '../analytics'

describe('trackTokenUsage', () => {
  const mockTrackTokenUsage = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    // Mock window.api.analytics.trackTokenUsage
    vi.stubGlobal('window', {
      api: {
        analytics: {
          trackTokenUsage: mockTrackTokenUsage
        }
      }
    })
  })

  const createModel = (provider: string, id: string): Model =>
    ({
      provider,
      id
    }) as Model

  const createUsage = (promptTokens: number, completionTokens: number): Usage => ({
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: promptTokens + completionTokens
  })

  describe('with OpenAI format (prompt_tokens/completion_tokens)', () => {
    it('should track token usage correctly', () => {
      const usage = createUsage(100, 50)
      const model = createModel('openai', 'gpt-4')

      trackTokenUsage({ usage, model })

      expect(mockTrackTokenUsage).toHaveBeenCalledWith({
        provider: 'openai',
        model: 'gpt-4',
        input_tokens: 100,
        output_tokens: 50
      })
    })

    it('should handle zero tokens', () => {
      const usage = createUsage(0, 0)
      const model = createModel('openai', 'gpt-4')

      trackTokenUsage({ usage, model })

      expect(mockTrackTokenUsage).not.toHaveBeenCalled()
    })

    it('should track when only input tokens exist', () => {
      const usage = createUsage(100, 0)
      const model = createModel('openai', 'gpt-4')

      trackTokenUsage({ usage, model })

      expect(mockTrackTokenUsage).toHaveBeenCalledWith({
        provider: 'openai',
        model: 'gpt-4',
        input_tokens: 100,
        output_tokens: 0
      })
    })

    it('should track when only output tokens exist', () => {
      const usage = createUsage(0, 50)
      const model = createModel('openai', 'gpt-4')

      trackTokenUsage({ usage, model })

      expect(mockTrackTokenUsage).toHaveBeenCalledWith({
        provider: 'openai',
        model: 'gpt-4',
        input_tokens: 0,
        output_tokens: 50
      })
    })
  })

  describe('with AI SDK format (inputTokens/outputTokens)', () => {
    it('should track token usage correctly', () => {
      const usage: LanguageModelUsage = { inputTokens: 200, outputTokens: 100, totalTokens: 300 }
      const model = createModel('anthropic', 'claude-3')

      trackTokenUsage({ usage, model })

      expect(mockTrackTokenUsage).toHaveBeenCalledWith({
        provider: 'anthropic',
        model: 'claude-3',
        input_tokens: 200,
        output_tokens: 100
      })
    })

    it('should handle undefined tokens', () => {
      const usage: LanguageModelUsage = { inputTokens: undefined, outputTokens: undefined, totalTokens: 0 }
      const model = createModel('anthropic', 'claude-3')

      trackTokenUsage({ usage, model })

      expect(mockTrackTokenUsage).not.toHaveBeenCalled()
    })

    it('should track when only input tokens exist', () => {
      const usage: LanguageModelUsage = { inputTokens: 200, outputTokens: undefined, totalTokens: 200 }
      const model = createModel('anthropic', 'claude-3')

      trackTokenUsage({ usage, model })

      expect(mockTrackTokenUsage).toHaveBeenCalledWith({
        provider: 'anthropic',
        model: 'claude-3',
        input_tokens: 200,
        output_tokens: 0
      })
    })
  })

  describe('edge cases', () => {
    it('should not track when usage is undefined', () => {
      const model = createModel('openai', 'gpt-4')

      trackTokenUsage({ usage: undefined, model })

      expect(mockTrackTokenUsage).not.toHaveBeenCalled()
    })

    it('should not track when model is undefined', () => {
      const usage = createUsage(100, 50)

      trackTokenUsage({ usage, model: undefined })

      expect(mockTrackTokenUsage).not.toHaveBeenCalled()
    })

    it('should not track when model.provider is missing', () => {
      const usage = createUsage(100, 50)
      const model = { id: 'gpt-4' } as Model

      trackTokenUsage({ usage, model })

      expect(mockTrackTokenUsage).not.toHaveBeenCalled()
    })

    it('should not track when model.id is missing', () => {
      const usage = createUsage(100, 50)
      const model = { provider: 'openai' } as Model

      trackTokenUsage({ usage, model })

      expect(mockTrackTokenUsage).not.toHaveBeenCalled()
    })
  })
})
