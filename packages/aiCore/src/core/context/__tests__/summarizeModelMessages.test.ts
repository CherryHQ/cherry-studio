import type {
  LanguageModelV3,
  LanguageModelV3Content,
  LanguageModelV3FinishReason,
  LanguageModelV3GenerateResult
} from '@ai-sdk/provider'
import type { ModelMessage } from 'ai'
import { describe, expect, it } from 'vitest'

import {
  COMPRESSION_MAX_OUTPUT_TOKENS,
  COMPRESSION_MIN_OUTPUT_TOKENS,
  resolveCompressionOutputTokens,
  summarizeModelMessages
} from '../middleware'

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

  // A reasoning model can burn the whole output budget on thinking and emit no
  // text. This used to be replaced by a '[Compression produced no output]'
  // placeholder, which made the summary look non-empty — so every caller's
  // fail-open ("no summary → keep the history") was bypassed and the folded
  // turns were dropped behind the placeholder. Empty must stay empty.
  it('returns empty (not a placeholder) when the model produces no text', async () => {
    const text = await summarizeModelMessages(
      [{ role: 'user', content: 'question' }],
      createSummarizerModel('') // model emitted only reasoning, no text
    )
    expect(text).toBe('')
  })

  it('passes the caller-supplied output budget to the model', async () => {
    let seenMaxOutputTokens: number | undefined
    const model = createSummarizerModel('RECAP')
    const inner = model.doGenerate.bind(model)
    model.doGenerate = async (opts) => {
      seenMaxOutputTokens = opts.maxOutputTokens
      return inner(opts)
    }

    await summarizeModelMessages([{ role: 'user', content: 'q' }], model, { maxOutputTokens: 12_345 })
    expect(seenMaxOutputTokens).toBe(12_345)
  })
})

describe('resolveCompressionOutputTokens', () => {
  it('scales with the window between the floor and the ceiling', () => {
    // 25% of a 64k window sits inside [floor, ceiling]
    expect(resolveCompressionOutputTokens(64_000)).toBe(16_000)
  })

  it('clamps to the floor for small windows', () => {
    // 25% of 8k = 2000, below the measured ~2.5k a summary actually needs
    expect(resolveCompressionOutputTokens(8000)).toBe(COMPRESSION_MIN_OUTPUT_TOKENS)
  })

  it('clamps to the ceiling for huge windows', () => {
    expect(resolveCompressionOutputTokens(1_000_000)).toBe(COMPRESSION_MAX_OUTPUT_TOKENS)
  })

  it('never exceeds the window itself', () => {
    expect(resolveCompressionOutputTokens(1000)).toBeLessThan(1000)
  })

  it('falls back to the floor when the window is unknown', () => {
    expect(resolveCompressionOutputTokens(undefined)).toBe(COMPRESSION_MIN_OUTPUT_TOKENS)
    expect(resolveCompressionOutputTokens(0)).toBe(COMPRESSION_MIN_OUTPUT_TOKENS)
  })
})
