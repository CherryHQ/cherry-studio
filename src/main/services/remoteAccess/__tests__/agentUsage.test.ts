import { expect, it } from 'vitest'

import { toMessageUsage } from '../agentUsage'

it('preserves unknown versus measured zero and projects authoritative costs and token details', () => {
  expect(toMessageUsage(null)).toBeUndefined()
  const usage = toMessageUsage({
    inputTokens: 0,
    outputTokens: 20,
    totalTokens: 20,
    inputTokenDetails: { cacheReadTokens: 0 },
    outputTokenDetails: { reasoningTokens: 10 },
    requestCount: 2,
    unpricedRequestCount: 1,
    costs: [{ currency: 'USD', amount: 0.01, providerReportedRequestCount: 1, computedRequestCount: 0 }]
  })
  expect(usage).toMatchObject({
    inputTokens: 0,
    totalTokens: 20,
    cacheReadTokens: 0,
    reasoningTokens: 10,
    requestCount: 2,
    hasUnpricedRecords: true,
    costs: [{ amount: 0.01 }]
  })
  expect(usage?.cacheWriteTokens).toBeUndefined()
  expect(usage).toEqual(JSON.parse(JSON.stringify(usage)))
  expect(toMessageUsage({ totalTokens: -1 })?.totalTokens).toBeUndefined()
})

it('counts overlapping tool spans once and keeps incomplete runtime durations unknown', () => {
  const runtimeTiming = {
    startedAt: 100,
    completedAt: 1100,
    spans: [
      { kind: 'tool-execution' as const, id: 'one', toolCallId: 'one', startedAt: 0, completedAt: 500 },
      { kind: 'tool-execution' as const, id: 'two', toolCallId: 'two', startedAt: 300, completedAt: 700 },
      { kind: 'approval-wait' as const, id: 'wait', approvalId: 'wait', toolCallId: 'two', startedAt: 900 }
    ]
  }
  expect(toMessageUsage({ runtimeTiming })).toMatchObject({
    durationMs: 1000,
    toolDurationMs: 600,
    approvalDurationMs: 200
  })
  expect(
    toMessageUsage({ runtimeTiming: { ...runtimeTiming, completedAt: undefined }, timeCompletionMs: 100 })?.durationMs
  ).toBeUndefined()
  expect(toMessageUsage({ timeCompletionMs: 123 })?.durationMs).toBe(123)
})
