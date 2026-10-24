import { describe, expect, it } from 'vitest'

import {
  collectReportedOutputUsage,
  reportedOutputUsageObserver,
  type ReportedOutputUsage
} from './reportedOutputUsage'

describe('raw output usage before SDK normalization', () => {
  it.each([
    [{}, {}],
    [{ usage: { completion_tokens: 0 } }, { outputTokens: 0 }],
    [{ usage: { completion_tokens: 12 } }, { outputTokens: 12 }],
    [
      { usage: { completion_tokens: 12, completion_tokens_details: { reasoning_tokens: 0 } } },
      { outputTokens: 12, reasoningTokens: 0 }
    ],
    [
      { response: { usage: { output_tokens: 8, output_tokens_details: { reasoning_tokens: 3 } } } },
      { outputTokens: 8, reasoningTokens: 3 }
    ],
    [{ usageMetadata: { candidatesTokenCount: 3, thoughtsTokenCount: 2 } }, { outputTokens: 5, reasoningTokens: 2 }]
  ])('retains field presence in %j', (wire, expected) => {
    const counts: ReportedOutputUsage = {}
    collectReportedOutputUsage(wire, counts)
    expect(counts).toEqual(expected)
  })
  it('composes the caller observer without mutating the raw event', async () => {
    const counts: ReportedOutputUsage = {}
    const data = Object.freeze({ usage: Object.freeze({ completion_tokens: 0 }) })
    let received: unknown
    await reportedOutputUsageObserver(counts, async (event) => {
      received = event
    })(data, {} as never)
    expect(received).toBe(data)
    expect(counts).toEqual({ outputTokens: 0 })
  })
})
