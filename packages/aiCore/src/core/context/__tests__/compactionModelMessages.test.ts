import type {
  LanguageModelV3,
  LanguageModelV3Content,
  LanguageModelV3FinishReason,
  LanguageModelV3GenerateResult
} from '@ai-sdk/provider'
import type { ModelMessage } from 'ai'
import { describe, expect, it } from 'vitest'

import { compactModelMessages } from '../compaction'
import { planCompaction } from '../durableCompaction'
import { fromModelMessages } from '../modelMessageAdapter'

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

/** N plain user/assistant turns (string shorthand), optional leading system. */
function plainTurns(n: number, withSystem = true): ModelMessage[] {
  const msgs: ModelMessage[] = withSystem ? [{ role: 'system', content: 'You are helpful.' }] : []
  for (let i = 0; i < n; i++) {
    msgs.push({ role: 'user', content: `q${i}` })
    msgs.push({ role: 'assistant', content: `a${i}` })
  }
  return msgs
}

// Upstream exposed a `planCompactionModelMessages` wrapper; the vendored module
// keeps planning at the IR altitude only, so these tests exercise the same
// split semantics through `planCompaction(fromModelMessages(...))` — exactly
// what `compactModelMessages` composes internally.
describe('planCompaction over ModelMessage input (via fromModelMessages)', () => {
  it('splits on turn boundaries', () => {
    const plan = planCompaction(fromModelMessages(plainTurns(3)), { keepRecentTurns: 2 })
    expect(plan.system.map((m) => m.role)).toEqual(['system'])
    expect(plan.toSummarize).toHaveLength(4)
    expect(plan.toKeep).toHaveLength(2)
    expect(plan.toKeep[0].role).toBe('user')
  })

  it('never splits an assistant tool-call from its tool result', () => {
    const messages: ModelMessage[] = [
      { role: 'user', content: 'q1' },
      {
        role: 'assistant',
        content: [{ type: 'tool-call', toolCallId: 'c1', toolName: 'foo', input: { a: 1 } }]
      },
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 'c1',
            toolName: 'foo',
            output: { type: 'text', value: 'ok' }
          }
        ]
      },
      { role: 'user', content: 'q2' },
      { role: 'assistant', content: 'a2' }
    ]
    const plan = planCompaction(fromModelMessages(messages), { keepRecentTurns: 3 })
    expect(plan.toSummarize.map((m) => m.role)).toEqual(['user'])
    expect(plan.toKeep.map((m) => m.role)).toEqual(['assistant', 'tool', 'user', 'assistant'])
  })
})

describe('compactModelMessages', () => {
  it('returns [...system, summary, ...toKeep] with a wrapped user summary', async () => {
    const messages = plainTurns(4) // system + 8 messages
    const result = await compactModelMessages(messages, createSummarizerModel('Hello'), {
      keepRecentTurns: 2
    })
    expect(result[0]).toEqual(messages[0]) // system preserved
    const summary = result[1]
    const text =
      summary.role === 'user' && typeof summary.content !== 'string' && summary.content[0].type === 'text'
        ? summary.content[0].text
        : ''
    expect(text).toContain('Hello')
    expect(text).toContain('continued from a previous conversation')
    expect(result.length).toBe(1 + 1 + 2)
  })

  it('returns the INPUT reference unchanged when nothing is old enough', async () => {
    const messages = plainTurns(2)
    const result = await compactModelMessages(messages, createSummarizerModel(), {
      keepRecentTurns: 99
    })
    expect(result).toBe(messages) // same reference — caller skips persistence
  })

  it('returns the INPUT reference unchanged when the summary is blank', async () => {
    const messages = plainTurns(4)
    const result = await compactModelMessages(messages, createSummarizerModel('   '), {
      keepRecentTurns: 1
    })
    expect(result).toBe(messages)
  })
})
