import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import { dataApiService } from '@data/DataApiService'
import { createSWRTestWrapper } from '@renderer/data/hooks/__tests__/testUtils'
import type { AiUsageRecordStatsResponse } from '@shared/data/api/schemas/aiUsageRecords'

import { EMPTY_STATS_METRICS } from '../usageAnalytics'
import { useUsageData, useUsageEntriesData } from '../useUsageData'

vi.unmock('@data/hooks/useDataApi')

afterEach(() => vi.restoreAllMocks())

const initialOptions: Parameters<typeof useUsageData>[0] = {
  windowRange: { from: 1, to: 2 },
  previousWindowRange: { from: 0, to: 1 },
  groupBy: 'provider',
  chartMetric: 'tokens',
  rollup: 'total',
  topCount: 10,
  selectedCurrency: 'USD'
}

it.each<Partial<typeof initialOptions>>([
  { groupBy: 'model' },
  { chartMetric: 'requests' },
  { topCount: 5 },
  { selectedCurrency: 'CNY' },
  { windowRange: { from: 3, to: 4 } }
])('does not show the previous aggregate after changing %j', async (change) => {
  const oldStats = { buckets: [], totals: { ...EMPTY_STATS_METRICS, totalTokens: 12345 }, other: EMPTY_STATS_METRICS }
  const pending = Promise.withResolvers<AiUsageRecordStatsResponse>()
  let changed = false
  vi.spyOn(dataApiService, 'get').mockImplementation(async (path) => {
    if (path === '/ai-usage-records/timeline') return { buckets: [], dailyCosts: [], costTotals: [] }
    return changed ? pending.promise : oldStats
  })
  const { Wrapper } = createSWRTestWrapper()
  const { result, rerender } = renderHook(useUsageData, { initialProps: initialOptions, wrapper: Wrapper })
  await waitFor(() => expect(result.current.exploreTotals.totalTokens).toBe(12345))

  changed = true
  rerender({ ...initialOptions, ...change })
  expect(result.current.exploreStatsLoading).toBe(true)
  expect(result.current.exploreTotals.totalTokens).not.toBe(12345)

  await act(async () => pending.reject(new Error('Request failed')))
  await waitFor(() => expect(result.current.exploreStatsError).toBeDefined())
  expect(result.current.exploreTotals.totalTokens).not.toBe(12345)
})

it('loads entries on mount without duplicate initial fetch and forwards group filters', async () => {
  const getSpy = vi.spyOn(dataApiService, 'get').mockResolvedValue({
    items: [
      {
        id: '019c0800-0000-7000-8000-000000000001',
        requestId: 'req-1',
        recordKind: 'invocation',
        requestCount: 1,
        messageKind: 'chat',
        messageId: 'm1',
        providerId: 'openai',
        providerName: 'OpenAI',
        sourceType: 'assistant',
        sourceId: 'a1',
        sourceName: 'Assistant',
        sourceIcon: null,
        modelId: 'gpt-4',
        modelName: 'GPT-4',
        modality: 'language',
        apiKeyId: null,
        apiKeyLabel: null,
        apiKeyMasked: null,
        apiKeyAttribution: 'unknown',
        authMethod: null,
        inputTokens: 10,
        outputTokens: 20,
        totalTokens: 30,
        reasoningTokens: null,
        noCacheTokens: 10,
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
        createdAt: '2026-03-10T10:00:00.000Z'
      }
    ],
    total: 1,
    nextCursor: undefined
  })
  const { Wrapper } = createSWRTestWrapper()
  const { result, rerender } = renderHook(
    ({ groupFilter }: { groupFilter?: { providerId: string; modelId: string } }) =>
      useUsageEntriesData({
        windowRange: { from: 1, to: 100 },
        currency: undefined,
        sortBy: 'createdAt',
        sortOrder: 'desc',
        groupFilter
      }),
    { initialProps: {}, wrapper: Wrapper }
  )

  await waitFor(() => expect(result.current.total).toBe(1))
  expect(result.current.entries).toHaveLength(1)
  expect(getSpy).toHaveBeenCalledTimes(1)

  rerender({ groupFilter: { providerId: 'openai', modelId: 'gpt-4' } })
  await waitFor(() =>
    expect(getSpy).toHaveBeenLastCalledWith('/ai-usage-records', {
      query: expect.objectContaining({ providerId: 'openai', modelId: 'gpt-4', from: 1, to: 100 })
    })
  )
})

it('surfaces entry list errors when no pages have loaded', async () => {
  vi.spyOn(dataApiService, 'get').mockRejectedValue(new Error('Entries unavailable'))
  const { Wrapper } = createSWRTestWrapper()
  const { result } = renderHook(
    () =>
      useUsageEntriesData({
        windowRange: { from: 1, to: 100 },
        currency: undefined,
        sortBy: 'createdAt',
        sortOrder: 'desc'
      }),
    { wrapper: Wrapper }
  )

  await waitFor(() => expect(result.current.error).toBeDefined())
  expect(result.current.total).toBe(0)
})
