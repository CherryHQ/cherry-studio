import type { AiUsageRecordStatsResponse, AiUsageRecordTimelineResponse } from '@shared/data/api/schemas/aiUsageRecords'
import { MockUseDataApiUtils, mockUseQuery } from '@test-mocks/renderer/useDataApi'
import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

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
})
