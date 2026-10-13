import type {
  LanguageModelV3,
  LanguageModelV3CallOptions,
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

/** Summarizer stub that also records the text it was asked to summarize. */
function createRecordingModel(): { model: LanguageModelV3; sentText: () => string } {
  let prompt: LanguageModelV3CallOptions['prompt'] = []
  const model = createSummarizerModel()
  const inner = model.doGenerate.bind(model)
  model.doGenerate = async (opts) => {
    prompt = opts.prompt
    return inner(opts)
  }
  const sentText = () =>
    prompt
      .flatMap((m) =>
        typeof m.content === 'string' ? [m.content] : m.content.flatMap((p) => ('text' in p ? [p.text] : []))
      )
      .join('\n')
  return { model, sentText }
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

// Whatever the summarize call omits is still folded away behind the summary, so
// an over-counted budget loses history for good.
describe('summarizeModelMessages — input budget', () => {
  // The budget both compaction lanes hand a 128k compressor.
  const maxOutputTokens = resolveCompressionOutputTokens(128_000)
  const budget = { maxOutputTokens, maxInputTokens: Math.floor((128_000 - maxOutputTokens) * 0.85) }
  const OMITTED = /earlier message\(s\) omitted/

  it('sends every message of a slice that fits the budget', async () => {
    const body = 'lorem ipsum dolor sit amet '.repeat(75)
    const messages = Array.from(
      { length: 110 },
      (_, i): ModelMessage =>
        i % 2 ? { role: 'assistant', content: `#${i} ${body}` } : { role: 'user', content: `#${i} ${body}` }
    )
    const { model, sentText } = createRecordingModel()

    await summarizeModelMessages(messages, model, budget)

    expect(sentText()).not.toMatch(OMITTED)
    expect(sentText()).toContain('#0 ')
    expect(sentText()).toContain('#109 ')
  })

  it('does not let an attached image crowd the conversation out', async () => {
    const messages: ModelMessage[] = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'what is in this picture?' },
          { type: 'image', image: 'A'.repeat(1_000_000), mediaType: 'image/png' }
        ]
      },
      ...Array.from(
        { length: 20 },
        (_, i): ModelMessage =>
          i % 2 ? { role: 'user', content: `follow-up ${i}` } : { role: 'assistant', content: `answer ${i}` }
      )
    ]
    const { model, sentText } = createRecordingModel()

    await summarizeModelMessages(messages, model, budget)

    expect(sentText()).not.toMatch(OMITTED)
    expect(sentText()).toContain('what is in this picture?')
    expect(sentText()).toContain('answer 0')
  })

  it('fits an agentic slice by stubbing its tool output instead of dropping turns', async () => {
    const messages: ModelMessage[] = [{ role: 'user', content: 'audit the repo' }]
    for (let i = 0; i < 25; i++) {
      messages.push({
        role: 'assistant',
        content: [{ type: 'tool-call', toolCallId: `c${i}`, toolName: 'read', input: { path: `f${i}` } }]
      })
      messages.push({
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: `c${i}`,
            toolName: 'read',
            output: { type: 'text', value: 'x'.repeat(20_000) }
          }
        ]
      })
    }
    const { model, sentText } = createRecordingModel()

    await summarizeModelMessages(messages, model, budget)

    expect(sentText()).not.toMatch(OMITTED)
    expect(sentText()).toContain('omitted before summarization')
    expect(sentText()).toContain('read({"path":"f0"})')
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
