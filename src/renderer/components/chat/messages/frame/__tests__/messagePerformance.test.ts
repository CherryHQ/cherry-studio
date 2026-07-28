import type { AiUsageRecordEntry } from '@shared/data/types/aiUsageRecord'
import type { MessageStats } from '@shared/data/types/message'
import { describe, expect, it } from 'vitest'

import { buildMessagePerformanceViewModel, getMessageModelTokensPerSecond } from '../messagePerformance'

function record(input: Partial<AiUsageRecordEntry> & Pick<AiUsageRecordEntry, 'id' | 'createdAt'>): AiUsageRecordEntry {
  return {
    requestId: input.id,
    recordKind: 'invocation',
    requestCount: 1,
    messageKind: 'chat',
    messageId: 'message-1',
    providerId: 'provider-1',
    providerName: 'Provider',
    sourceType: 'assistant',
    sourceId: 'assistant-1',
    sourceName: 'Assistant',
    sourceIcon: null,
    modelId: 'model-1',
    modelName: 'Model',
    modality: 'language',
    apiKeyId: null,
    apiKeyLabel: null,
    apiKeyMasked: null,
    apiKeyAttribution: 'unknown',
    authMethod: null,
    inputTokens: null,
    outputTokens: null,
    totalTokens: null,
    reasoningTokens: null,
    noCacheTokens: null,
    cacheReadTokens: null,
    cacheWriteTokens: null,
    imageCount: null,
    cost: null,
    costCurrency: null,
    costSource: null,
    costBreakdown: null,
    pricingSnapshot: null,
    timeFirstTokenMs: null,
    timeCompletionMs: null,
    timeThinkingMs: null,
    ...input
  }
}

describe('message performance view model', () => {
  it('uses measured provider steps for model TPS and wall clock for end-to-end throughput', () => {
    const stats: MessageStats = {
      outputTokens: 100,
      providerPerformance: { measuredOutputTokens: 60, generationDurationMs: 2_000 },
      runtimeTiming: {
        startedAt: 1_000,
        completedAt: 6_000,
        spans: [
          {
            id: 'tool:tool-1',
            kind: 'tool-execution',
            toolCallId: 'tool-1',
            toolName: 'Read',
            startedAt: 3_000,
            completedAt: 4_000
          },
          {
            id: 'approval:approval-1',
            kind: 'approval-wait',
            approvalId: 'approval-1',
            toolCallId: 'tool-2',
            toolName: 'Bash',
            startedAt: 4_000,
            completedAt: 5_000
          }
        ]
      }
    }
    const records = [
      record({
        id: '00000000-0000-7000-8000-000000000001',
        createdAt: new Date(3_000).toISOString(),
        outputTokens: 60,
        timeFirstTokenMs: 500,
        timeCompletionMs: 2_500
      }),
      record({
        id: '00000000-0000-7000-8000-000000000002',
        createdAt: new Date(5_500).toISOString(),
        outputTokens: 40
      })
    ]

    const view = buildMessagePerformanceViewModel(stats, records, 7_000)

    expect(view.modelTokensPerSecond).toBe(30)
    expect(view.endToEndTokensPerSecond).toBe(20)
    expect(view.totalDurationMs).toBe(5_000)
    expect(view.intervals.some((interval) => interval.id.endsWith('2'))).toBe(false)
  })

  it('keeps parallel spans overlapping instead of adding them into percentages', () => {
    const view = buildMessagePerformanceViewModel({
      runtimeTiming: {
        startedAt: 0,
        completedAt: 1_000,
        spans: [
          {
            id: 'tool:a',
            kind: 'tool-execution',
            toolCallId: 'a',
            startedAt: 100,
            completedAt: 500
          },
          {
            id: 'tool:b',
            kind: 'tool-execution',
            toolCallId: 'b',
            startedAt: 300,
            completedAt: 700
          }
        ]
      }
    })

    const otherDuration = view.intervals
      .filter((interval) => interval.lane === 'other')
      .reduce((sum, interval) => sum + interval.completedAt - interval.startedAt, 0)
    expect(otherDuration).toBe(400)
  })

  it('adapts legacy scalar timing through the same view model', () => {
    const stats: MessageStats = {
      outputTokens: 100,
      timeFirstTokenMs: 1_000,
      timeCompletionMs: 5_000
    }

    expect(getMessageModelTokensPerSecond(stats)).toBe(25)
    expect(buildMessagePerformanceViewModel(stats)).toMatchObject({
      totalDurationMs: 5_000,
      modelTokensPerSecond: 25,
      endToEndTokensPerSecond: 20
    })
  })
})
