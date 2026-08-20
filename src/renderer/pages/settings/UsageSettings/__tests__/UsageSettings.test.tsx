import { MockUseCacheUtils } from '@test-mocks/renderer/useCache'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import UsageSettings from '../UsageSettings'

vi.mock('@renderer/hooks/useProvider', () => ({
  useProviders: () => ({ providers: [] })
}))

vi.mock('../UsageDistributionChart', () => ({
  UsageDistributionChart: () => null
}))

vi.mock('../UsageEntriesTable', () => ({
  UsageEntriesTable: () => null
}))

vi.mock('../useUsageData', () => {
  const totals = {
    costCurrency: null,
    totalCost: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalTokens: 0,
    totalNoCacheTokens: 0,
    totalCacheReadTokens: 0,
    totalCacheWriteTokens: 0,
    recordCount: 0,
    requestCount: 0,
    estimatedRequestCount: 0,
    unpricedRequestCount: 0
  }

  return {
    useUsageData: () => ({
      costTotals: [],
      costCurrency: undefined,
      timelineBuckets: [],
      overviewBuckets: [],
      exploreBuckets: [],
      exploreTimelineRows: [],
      overviewTotals: totals,
      previousOverviewTotals: totals,
      exploreTotals: totals,
      exploreOther: totals,
      timelineLoading: false,
      overviewLoading: false,
      exploreStatsLoading: false,
      exploreTimelineLoading: false,
      entries: [],
      entryTotal: 0,
      entriesLoading: false,
      entriesRefreshing: false,
      hasNextEntryPage: false,
      loadNextEntryPage: vi.fn()
    })
  }
})

const segmentedControlOf = (optionLabel: string) =>
  screen.getByRole('button', { name: optionLabel }).closest('[data-testid="segmented-control"]')

describe('UsageSettings', () => {
  beforeEach(() => {
    MockUseCacheUtils.resetMocks()
  })

  it('starts on the documented defaults', () => {
    render(<UsageSettings />)

    expect(segmentedControlOf('最近 30 天')).toHaveAttribute('data-value', '30d')
    expect(segmentedControlOf('供应商')).toHaveAttribute('data-value', 'provider')
    expect(segmentedControlOf('Token')).toHaveAttribute('data-value', 'tokens')
    expect(segmentedControlOf('按天')).toHaveAttribute('data-value', 'daily')
    expect(segmentedControlOf('柱状图')).toHaveAttribute('data-value', 'bar')
    expect(segmentedControlOf('10')).toHaveAttribute('data-value', '10')
  })

  it('restores the view selections after leaving and returning to the page', () => {
    const first = render(<UsageSettings />)

    fireEvent.click(screen.getByRole('button', { name: '最近 90 天' }))
    fireEvent.click(screen.getByRole('button', { name: '模型' }))
    fireEvent.click(screen.getByRole('button', { name: '按周' }))
    fireEvent.click(screen.getByRole('button', { name: '20' }))

    first.unmount()
    render(<UsageSettings />)

    expect(segmentedControlOf('最近 90 天')).toHaveAttribute('data-value', '90d')
    expect(segmentedControlOf('模型')).toHaveAttribute('data-value', 'model')
    expect(segmentedControlOf('按周')).toHaveAttribute('data-value', 'weekly')
    expect(segmentedControlOf('20')).toHaveAttribute('data-value', '20')
  })
})
