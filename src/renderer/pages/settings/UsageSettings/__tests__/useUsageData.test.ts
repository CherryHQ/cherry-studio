import { MockUseDataApiUtils, mockUseQuery } from '@test-mocks/renderer/useDataApi'
import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AiUsageRecordStatsResponse, AiUsageRecordTimelineResponse } from '@shared/data/api/schemas/aiUsageRecords'

import { EMPTY_STATS_METRICS } from '../usageAnalytics'
import { useUsageData } from '../useUsageData'

const timelineData: AiUsageRecordTimelineResponse = {
  buckets: [],
  costTotals: [],
  dailyCosts: []
}
const statsData: AiUsageRecordStatsResponse = {
  buckets: [],
  totals: EMPTY_STATS_METRICS,
  other: EMPTY_STATS_METRICS
}
const range = { from: 1, to: 2 }

describe('useUsageData', () => {
  beforeEach(() => {
    MockUseDataApiUtils.resetMocks()
  })

  it('keeps previous usage data visible while a new time range loads', () => {
    mockUseQuery.mockImplementation((path: string) => ({
      data: path === '/ai-usage-records/timeline' ? timelineData : statsData,
      isLoading: true,
      isRefreshing: true,
      error: undefined,
      refetch: vi.fn().mockResolvedValue(undefined),
      mutate: vi.fn().mockResolvedValue(undefined)
    }))

    const { result } = renderHook(() =>
      useUsageData({
        windowRange: range,
        previousWindowRange: range,
        groupBy: 'provider',
        chartMetric: 'tokens',
        rollup: 'daily',
        topCount: 10
      })
    )

    expect(result.current.timelineLoading).toBe(false)
    expect(result.current.overviewLoading).toBe(false)
    expect(result.current.exploreStatsLoading).toBe(false)
    expect(result.current.exploreTimelineLoading).toBe(false)
  })
  it.each([false, true])('distinguishes failed aggregate requests from cached data (cached: %s)', (cached) => {
    const error = new Error('Stats unavailable')
    mockUseQuery.mockImplementation((path: string) => ({
      data: path === '/ai-usage-records/timeline' ? timelineData : cached ? statsData : undefined,
      isLoading: false,
      isRefreshing: false,
      error,
      refetch: vi.fn().mockResolvedValue(undefined),
      mutate: vi.fn().mockResolvedValue(undefined)
    }))
    const { result } = renderHook(() =>
      useUsageData({
        windowRange: range,
        previousWindowRange: range,
        groupBy: 'provider',
        chartMetric: 'tokens',
        rollup: 'total',
        topCount: 10
      })
    )
    expect(result.current.exploreStatsError).toBe(cached ? undefined : error)
    expect(result.current.exploreStatsLoading).toBe(false)
  })

  describe.each(['daily', 'total'] as const)('aggregate readiness (%s)', (rollup) => {
    it.each(['loading', 'refreshing', 'error', 'ready'] as const)(
      'waits for previous overview stats (%s)',
      (status) => {
        const previousRange = { from: 0, to: 1 }
        mockUseQuery.mockImplementation((path, options) => {
          const isPrevious = path === '/ai-usage-records/stats' && options?.query?.from === previousRange.from
          return {
            data:
              isPrevious && status === 'loading'
                ? undefined
                : path === '/ai-usage-records/timeline'
                  ? timelineData
                  : statsData,
            isLoading: isPrevious && status === 'loading',
            isRefreshing: isPrevious && status === 'refreshing',
            error: isPrevious && status === 'error' ? new Error('Previous stats unavailable') : undefined,
            refetch: vi.fn().mockResolvedValue(undefined),
            mutate: vi.fn().mockResolvedValue(undefined)
          }
        })

        const { result } = renderHook(() =>
          useUsageData({
            windowRange: range,
            previousWindowRange: previousRange,
            groupBy: 'provider',
            chartMetric: 'tokens',
            rollup,
            topCount: 10
          })
        )

        expect(result.current.aggregateReady).toBe(status === 'ready')
        expect(result.current.aggregateError).toBe(status === 'error')
      }
    )
  })
})
