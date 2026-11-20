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
      { raw: { output_tokens: 25, output_tokens_details: { reasoning_tokens: 0 } }, outputTokens: 25 },
      { outputTokens: 25, reasoningTokens: 0 }
    ],
    // Anthropic: message_start's initial zero is merged into raw; no terminal count means unknown.
    [{ raw: { output_tokens: 0 } }, { outputTokens: null, reasoningTokens: null }],
    // Anthropic: an explicit terminal zero is a reported zero.
    [
      { raw: { output_tokens: 0 }, outputTokens: 0 },
      { outputTokens: 0, reasoningTokens: null }
    ],
    // Anthropic: executor counts supplied through iterations alone are complete.
    [
      { raw: { iterations: [{ type: 'message', output_tokens: 3 }] }, outputTokens: 5 },
      { outputTokens: 5, reasoningTokens: null }
    ],
    // Anthropic max_tokens stop: the merged initial count is 0 but the executor iterations total 5.
    [
      { raw: { output_tokens: 0, iterations: [{ type: 'message', output_tokens: 5 }] }, outputTokens: 5 },
      { outputTokens: 5, reasoningTokens: null }
    ],
    // Compatible Chat Completions: only the alias is on the wire; the adapter normalizes to zero.
    [
      { raw: { output_tokens: 25 }, outputTokens: 0 },
      { outputTokens: 25, reasoningTokens: null }
    ],
    // Canonical and additive (xAI) controls keep the adapter's semantics.
    [
      { raw: { completion_tokens: 10 }, outputTokens: 10 },
      { outputTokens: 10, reasoningTokens: null }
    ],
    [
      { raw: { completion_tokens: 10, completion_tokens_details: { reasoning_tokens: 4 } }, outputTokens: 14 },
      { outputTokens: 14, reasoningTokens: 4 }
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
