import type * as CherryStudioUi from '@cherrystudio/ui'
import { MockUseCacheUtils } from '@test-mocks/renderer/useCache'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import UsageSettings from '../UsageSettings'

const usageDataOverride = vi.hoisted(() => ({ current: {} as Record<string, unknown> }))

vi.mock('@cherrystudio/ui', async (importOriginal) => importOriginal<typeof CherryStudioUi>())

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

beforeAll(() => {
  if (!HTMLElement.prototype.hasPointerCapture) HTMLElement.prototype.hasPointerCapture = () => false
  if (!HTMLElement.prototype.releasePointerCapture) HTMLElement.prototype.releasePointerCapture = () => {}
  if (!HTMLElement.prototype.setPointerCapture) HTMLElement.prototype.setPointerCapture = () => {}
  HTMLElement.prototype.scrollIntoView = () => {}
})

describe('UsageSettings', () => {
  beforeEach(() => {
    MockUseCacheUtils.resetMocks()
    usageDataOverride.current = {}
  })

  it('starts on the documented defaults', () => {
    render(<UsageSettings />)

    expect(screen.getByRole('radio', { name: '最近 30 天' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('combobox', { name: '分组' })).toHaveTextContent('供应商')
    expect(screen.getByRole('combobox', { name: '指标' })).toHaveTextContent('Token')
    expect(screen.getByRole('combobox', { name: 'Top' })).toHaveTextContent('10')
    expect(screen.getByRole('button', { name: '柱状图' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('radio', { name: '按天' })).toHaveAttribute('aria-checked', 'true')
  })

  it('restores the view selections after leaving and returning to the page', async () => {
    const user = userEvent.setup()
    const first = render(<UsageSettings />)

    await user.click(screen.getByRole('radio', { name: '最近 90 天' }))
    await user.click(screen.getByRole('combobox', { name: '分组' }))
    await user.click(await screen.findByRole('option', { name: '模型' }))
    await user.click(screen.getByRole('button', { name: '饼图' }))
    await user.click(screen.getByRole('radio', { name: '按周' }))
    await user.click(screen.getByRole('combobox', { name: 'Top' }))
    await user.click(await screen.findByRole('option', { name: '20' }))

    first.unmount()
    render(<UsageSettings />)

    expect(screen.getByRole('radio', { name: '最近 90 天' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('combobox', { name: '分组' })).toHaveTextContent('模型')
    expect(screen.getByRole('button', { name: '饼图' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('radio', { name: '按周' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('combobox', { name: 'Top' })).toHaveTextContent('20')
  })

  it('caps the dashboard column so ultrawide windows do not stretch charts', () => {
    render(<UsageSettings />)

    const overview = screen.getByRole('heading', { name: '概览' })
    const column = overview.closest('.mx-auto')

    // Layout contract: the usage dashboard is bounded (`max-w-6xl`), not full-bleed (`max-w-none`).
    expect(column).toHaveClass('max-w-6xl')
    expect(column).not.toHaveClass('max-w-none')
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
