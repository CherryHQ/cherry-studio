import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import { dataApiService } from '@data/DataApiService'
import { createSWRTestWrapper } from '@renderer/data/hooks/__tests__/testUtils'
import type { AiUsageRecordStatsResponse } from '@shared/data/api/schemas/aiUsageRecords'

import { EMPTY_STATS_METRICS } from '../usageAnalytics'
import { useUsageData } from '../useUsageData'

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
