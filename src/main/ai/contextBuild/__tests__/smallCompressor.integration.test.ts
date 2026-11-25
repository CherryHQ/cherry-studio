import type { LanguageModelV3 } from '@ai-sdk/provider'
import type { ModelMessage } from 'ai'
import { describe, expect, it } from 'vitest'

import { compactModelMessages, estimateSummarizeInputTokens, summarizeModelMessages } from '@cherrystudio/ai-core'

import { resolveSummarizeBudget } from '../resolveSummarizeBudget'

function compressor() {
  const calls: unknown[] = []
  const model: LanguageModelV3 = {
    specificationVersion: 'v3',
    provider: 'test',
    modelId: 'compressor',
    supportedUrls: {},
    async doGenerate(options) {
      calls.push(options)
      return {
        content: [{ type: 'text', text: '<summary>short summary</summary>' }],
        finishReason: { unified: 'stop', raw: undefined },
        usage: {
          inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
          outputTokens: { total: 10, text: 10, reasoning: undefined }
        },
        warnings: []
      }
    },
    async doStream() {
      throw new Error('not used')
    }
  }
  return { model, calls }
}

describe('small compressor assembled-input budgets', () => {
  it('summarizes an eight-token fold with the mandatory instruction in a margined 5K window', async () => {
    const messages: ModelMessage[] = [{ role: 'user', content: 'A very short conversation.' }]
    const budget = resolveSummarizeBudget(4500, estimateSummarizeInputTokens(messages))
    const { model, calls } = compressor()
    expect(await summarizeModelMessages(messages, model, budget)).toBe('short summary')
    expect(calls.length).toBeGreaterThan(0)
    expect(budget.maxInputTokens + budget.maxOutputTokens).toBeLessThanOrEqual(4500)
  })

  it('lets an unsplittable tool argument use the remaining 9K compressor room', async () => {
    const messages: ModelMessage[] = [
      {
        role: 'assistant',
        content: [{ type: 'tool-call', toolCallId: 'c1', toolName: 'tool', input: { text: 'x'.repeat(10_000) } }]
      }
    ]
    const budget = resolveSummarizeBudget(8100, estimateSummarizeInputTokens(messages))
    const { model, calls } = compressor()
    expect(await summarizeModelMessages(messages, model, budget)).toBe('short summary')
    expect(calls.length).toBeGreaterThan(0)
    expect(budget.maxInputTokens).toBe(4004)
  })

  it('does not charge a large retained tail against a short in-loop fold hint', async () => {
    const old: ModelMessage[] = [
      { role: 'user', content: 'old question' },
      { role: 'assistant', content: 'old answer' }
    ]
    const messages: ModelMessage[] = [...old, { role: 'user', content: 'tail '.repeat(4000) }]
    const estimate = estimateSummarizeInputTokens(messages, 1)
    expect(estimate).toBe(estimateSummarizeInputTokens(old))
    const budget = resolveSummarizeBudget(5220, estimate)
    expect(budget.maxOutputTokens).toBeGreaterThanOrEqual(3300)
    const { model } = compressor()
    const result = await compactModelMessages(messages, model, { keepRecentTurns: 1, ...budget })
    expect(result).not.toBe(messages)
    expect(result.at(-1)).toEqual(messages.at(-1))
  })
})
