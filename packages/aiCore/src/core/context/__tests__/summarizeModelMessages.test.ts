import type {
  LanguageModelV3,
  LanguageModelV3Content,
  LanguageModelV3FinishReason,
  LanguageModelV3GenerateResult
} from '@ai-sdk/provider'
import type { ModelMessage } from 'ai'
import { describe, expect, it } from 'vitest'

import { summarizeModelMessages } from '../middleware'

/** Minimal V3 model whose summarization call returns a fixed string. A V3 model
 *  is a valid `LanguageModel`, so it exercises the widened model param too. */
function createSummarizerModel(summaryText = 'SUMMARY'): LanguageModelV3 {
  return {
    specificationVersion: 'v3',
    provider: 'test',
    modelId: 'test-model',
    supportedUrls: {},
    async doGenerate(): Promise<LanguageModelV3GenerateResult> {
      const content: LanguageModelV3Content[] = [{ type: 'text', text: summaryText }]
      const finishReason: LanguageModelV3FinishReason = { unified: 'stop', raw: undefined }
      return {
        content,
        finishReason,
        warnings: [],
        usage: {
          inputTokens: {
            total: 50,
            noCache: undefined,
            cacheRead: undefined,
            cacheWrite: undefined
          },
          outputTokens: { total: 10, text: undefined, reasoning: undefined }
        },
        response: { id: 'id', timestamp: new Date(), modelId: 'test-model' }
      }
    },
    async doStream() {
      throw new Error('not used')
    }
  }
}

describe('summarizeModelMessages', () => {
  it('summarizes a ModelMessage slice into a string, dropping system messages', async () => {
    const messages: ModelMessage[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'first question' },
      { role: 'assistant', content: 'first answer' }
    ]
    const text = await summarizeModelMessages(messages, createSummarizerModel('RECAP'))
    expect(text).toBe('RECAP')
  })

  it('returns empty string for an empty slice without a model call', async () => {
    const text = await summarizeModelMessages([], createSummarizerModel())
    expect(text).toBe('')
  })
})
