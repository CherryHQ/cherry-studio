import { describe, expect, it } from 'vitest'

import { providerReportedOutputUsage } from './reportedOutputUsage'

describe('upstream output count provenance', () => {
  it.each([
    [{}, { outputTokens: null, reasoningTokens: null }],
    [{ outputTokens: 0 }, { outputTokens: 0, reasoningTokens: null }],
    [
      { raw: {}, outputTokens: 0, outputTokenDetails: { reasoningTokens: 0 } },
      { outputTokens: null, reasoningTokens: null }
    ],
    [{ raw: { completion_tokens: 0 } }, { outputTokens: 0, reasoningTokens: null }],
    [
      { raw: { output_tokens: 25, output_tokens_details: { reasoning_tokens: 0 } } },
      { outputTokens: 25, reasoningTokens: 0 }
    ],
    [{ raw: { candidatesTokenCount: 3, thoughtsTokenCount: 2 } }, { outputTokens: 5, reasoningTokens: 2 }],
    [
      { raw: { thoughtsTokenCount: 2 }, outputTokens: 2 },
      { outputTokens: null, reasoningTokens: 2 }
    ],
    [
      { raw: { completion_tokens: -1, output_tokens: '25' }, outputTokens: 0 },
      { outputTokens: null, reasoningTokens: null }
    ],
    [
      { raw: { completion_tokens: Infinity, completion_tokens_details: { reasoning_tokens: NaN } } },
      { outputTokens: null, reasoningTokens: null }
    ]
  ])('preserves field presence without inferring from normalized counters (%j)', (usage, expected) => {
    expect(providerReportedOutputUsage(usage)).toEqual(expected)
  })
})
