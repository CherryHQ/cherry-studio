import { describe, expect, it } from 'vitest'

import { mergeMessageRuntimeStats, mergeMessageUsageProjection } from '../messageStats'

describe('messageStats', () => {
  it('merges continuation timing without replacing record-owned performance or retaining scalar timing', () => {
    const merged = mergeMessageRuntimeStats(
      {
        outputTokens: 20,
        providerPerformance: { measuredOutputTokens: 20, generationDurationMs: 500 },
        timeFirstTokenMs: 100,
        runtimeTiming: {
          startedAt: 1_000,
          spans: [
            {
              id: 'tool:first',
              kind: 'tool-execution',
              toolCallId: 'first',
              startedAt: 1_500,
              completedAt: 2_000
            }
          ]
        }
      },
      {
        runtimeTiming: {
          startedAt: 1_000,
          completedAt: 4_000,
          spans: [
            {
              id: 'tool:second',
              kind: 'tool-execution',
              toolCallId: 'second',
              startedAt: 3_000,
              completedAt: 3_500
            }
          ]
        }
      }
    )

    expect(merged).toMatchObject({
      outputTokens: 20,
      providerPerformance: { measuredOutputTokens: 20, generationDurationMs: 500 },
      runtimeTiming: {
        startedAt: 1_000,
        completedAt: 4_000,
        spans: [{ id: 'tool:first' }, { id: 'tool:second' }]
      }
    })
    expect(merged).not.toHaveProperty('timeFirstTokenMs')
    expect(merged).not.toHaveProperty('timeCompletionMs')
  })

  it('replaces projection fields through one ownership merge and preserves scalar timing only for old rows', () => {
    const merged = mergeMessageUsageProjection(
      {
        totalTokens: 999,
        requestCount: 9,
        timeCompletionMs: 750
      },
      {
        totalTokens: 12,
        requestCount: 1
      }
    )

    expect(merged).toEqual({
      totalTokens: 12,
      requestCount: 1,
      timeCompletionMs: 750
    })
  })
})
