import { MockUseCacheUtils } from '@test-mocks/renderer/useCache'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import UsageSettings from '../UsageSettings'

const usageDataOverride = vi.hoisted(() => ({ current: {} as Record<string, unknown> }))

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
      ...usageDataOverride.current
    }),
    useUsageEntriesData: () => ({
      entries: [],
      total: 0,
      isLoading: false,
      isRefreshing: false,
      hasNext: false,
      loadNext: vi.fn()
    })
  }
})

const segmentedControlOf = (optionLabel: string) =>
  screen.getByRole('button', { name: optionLabel }).closest('[data-testid="segmented-control"]')

describe('UsageSettings', () => {
  beforeEach(() => {
    MockUseCacheUtils.resetMocks()
    usageDataOverride.current = {}
  })

  it('starts on the documented defaults', () => {
    render(<UsageSettings />)

    expect(segmentedControlOf('最近 30 天')).toHaveAttribute('data-value', '30d')
    expect(screen.getByRole('combobox', { name: '分组' })).toHaveTextContent('供应商')
    expect(screen.getByRole('combobox', { name: '指标' })).toHaveTextContent('Token')
    expect(screen.getByRole('combobox', { name: 'Top' })).toHaveTextContent('10')
    expect(screen.getByRole('button', { name: '柱状图' })).toHaveAttribute('aria-pressed', 'true')
    expect(segmentedControlOf('按天')).toHaveAttribute('data-value', 'daily')
  })

  it('restores the view selections after leaving and returning to the page', () => {
    const first = render(<UsageSettings />)

    fireEvent.click(screen.getByRole('button', { name: '最近 90 天' }))
    fireEvent.click(screen.getByRole('combobox', { name: '分组' }))
    fireEvent.click(screen.getByRole('option', { name: '模型' }))
    fireEvent.click(screen.getByRole('button', { name: '饼图' }))
    fireEvent.click(screen.getByRole('button', { name: '按周' }))
    fireEvent.click(screen.getByRole('combobox', { name: 'Top' }))
    fireEvent.click(screen.getByRole('option', { name: '20' }))

    first.unmount()
    render(<UsageSettings />)

    expect(segmentedControlOf('最近 90 天')).toHaveAttribute('data-value', '90d')
    expect(screen.getByRole('combobox', { name: '分组' })).toHaveTextContent('模型')
    expect(screen.getByRole('button', { name: '饼图' })).toHaveAttribute('aria-pressed', 'true')
    expect(segmentedControlOf('按周')).toHaveAttribute('data-value', 'weekly')
    expect(screen.getByRole('combobox', { name: 'Top' })).toHaveTextContent('20')
  })

  it('keeps the overview insight row when usage data exists', () => {
    usageDataOverride.current = {
      overviewTotals: {
        totalCost: 0,
        totalTokens: 100,
        totalNoCacheTokens: 0,
        totalCacheReadTokens: 0,
        totalCacheWriteTokens: 0,
        requestCount: 1
      }
    }

    render(<UsageSettings />)

    expect(screen.getByText('活跃天数')).toBeInTheDocument()
    expect(screen.getByText('高峰日')).toBeInTheDocument()
    expect(screen.getByText('用量最高模型')).toBeInTheDocument()
    expect(screen.getByText('日均')).toBeInTheDocument()
  })
})
