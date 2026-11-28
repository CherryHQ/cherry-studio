import { MockCacheUtils } from '@test-mocks/renderer/CacheService'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import type * as CherryStudioUi from '@cherrystudio/ui'
import i18n from '@renderer/i18n/resolver'

import { EMPTY_STATS_METRICS } from '../usageAnalytics'
import UsageSettings from '../UsageSettings'

const usageDataOverride = vi.hoisted(() => ({ current: {} as Record<string, unknown> }))
const useUsageEntriesDataMock = vi.hoisted(() =>
  vi.fn(() => ({
    entries: [],
    total: 0,
    isLoading: false,
    isRefreshing: false,
    error: undefined,
    hasNext: false,
    loadNext: vi.fn()
  }))
)

vi.unmock('@data/hooks/useCache')

vi.mock('@cherrystudio/ui', async (importOriginal) => importOriginal<typeof CherryStudioUi>())

vi.mock('@renderer/hooks/useProvider', () => ({
  useProviders: () => ({ providers: [] })
}))

vi.mock('@renderer/components/Chart', () => ({
  Chart: ({
    onDataPointClick
  }: {
    onDataPointClick?: (params: { seriesIndex?: number; dataIndex: number }) => void
  }) =>
    onDataPointClick ? (
      <button type="button" onClick={() => onDataPointClick({ seriesIndex: 0, dataIndex: 0 })}>
        MockChartPoint
      </button>
    ) : null
}))

vi.mock('../UsageEntriesTable', () => ({
  UsageEntriesTable: ({
    activeFilterLabel,
    onClearFilter
  }: {
    activeFilterLabel?: string
    onClearFilter?: () => void
  }) =>
    activeFilterLabel ? (
      <div>
        <span>{activeFilterLabel}</span>
        <button type="button" onClick={onClearFilter}>
          ClearFilter
        </button>
      </div>
    ) : null
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
    useUsageEntriesData: useUsageEntriesDataMock
  }
})

beforeAll(async () => {
  await i18n.changeLanguage('zh-cn')
  if (!HTMLElement.prototype.hasPointerCapture) HTMLElement.prototype.hasPointerCapture = () => false
  if (!HTMLElement.prototype.releasePointerCapture) HTMLElement.prototype.releasePointerCapture = () => {}
  if (!HTMLElement.prototype.setPointerCapture) HTMLElement.prototype.setPointerCapture = () => {}
  HTMLElement.prototype.scrollIntoView = () => {}
})

describe('UsageSettings', () => {
  beforeEach(() => {
    MockCacheUtils.resetMocks()
    usageDataOverride.current = {}
    useUsageEntriesDataMock.mockClear()
  })

  it('discloses that totals may include local estimates even for an empty selection', () => {
    render(<UsageSettings />)

    expect(screen.getByText('总计可能包含本地成本估算；实际费用以服务商账单为准。')).toBeVisible()
  })

  it('restores the view selections after leaving and returning to the page', async () => {
    const user = userEvent.setup()
    const first = render(<UsageSettings />)

    await user.click(screen.getByRole('radio', { name: '最近 90 天' }))
    await user.click(screen.getByRole('combobox', { name: '分组' }))
    await user.click(await screen.findByRole('option', { name: '模型' }))
    await user.click(screen.getByRole('button', { name: '饼图' }))
    await user.click(screen.getByRole('radio', { name: '总计' }))
    await user.click(screen.getByRole('combobox', { name: 'Top' }))
    await user.click(await screen.findByRole('option', { name: '20' }))

    first.unmount()
    render(<UsageSettings />)

    expect(screen.getByRole('radio', { name: '最近 90 天' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('combobox', { name: '分组' })).toHaveTextContent('模型')
    expect(screen.getByRole('button', { name: '饼图' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('radio', { name: '总计' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('combobox', { name: 'Top' })).toHaveTextContent('20')
  })

  it('shows the full total including Other and preserves the trend chart when returning from Total', async () => {
    const user = userEvent.setup()
    usageDataOverride.current = {
      overviewTotals: { ...EMPTY_STATS_METRICS, totalTokens: 2400, requestCount: 12 },
      exploreTotals: { ...EMPTY_STATS_METRICS, totalTokens: 2400, requestCount: 12 },
      exploreBuckets: [
        {
          ...EMPTY_STATS_METRICS,
          groupBy: 'provider',
          providerId: 'openai',
          providerName: 'OpenAI',
          totalTokens: 1800,
          requestCount: 8
        }
      ],
      exploreOther: { ...EMPTY_STATS_METRICS, totalTokens: 600, requestCount: 4 }
    }
    render(<UsageSettings />)

    await user.click(screen.getByRole('button', { name: '折线图' }))
    await user.click(screen.getByRole('radio', { name: '总计' }))

    expect(screen.getByText('总计 · Token')).toBeInTheDocument()
    expect(screen.getByLabelText('总计 · Token')).toHaveTextContent('2400')
    expect(screen.getByRole('button', { name: '折线图' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '柱状图' })).toHaveAttribute('aria-pressed', 'true')

    await user.click(screen.getByRole('combobox', { name: '指标' }))
    await user.click(await screen.findByRole('option', { name: '请求数' }))
    expect(screen.getByText('总计 · 请求数')).toBeInTheDocument()
    expect(screen.getByLabelText('总计 · 请求数')).toHaveTextContent('12')

    await user.click(screen.getByRole('radio', { name: '按周' }))
    expect(screen.getByRole('button', { name: '折线图' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '折线图' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('waits for aggregate data before showing a zero total', () => {
    MockCacheUtils.setInitialState({ persist: [['settings.usage.rollup', 'total']] })
    usageDataOverride.current = { exploreStatsLoading: true }
    const view = render(<UsageSettings />)
    expect(screen.queryByLabelText('总计 · Token')).not.toBeInTheDocument()

    usageDataOverride.current = { exploreStatsLoading: false }
    view.rerender(<UsageSettings />)
    expect(screen.getByLabelText('总计 · Token')).toHaveTextContent('0')
  })
  it('does not report a zero total when aggregate loading fails, and recovers to a real zero', () => {
    MockCacheUtils.setInitialState({ persist: [['settings.usage.rollup', 'total']] })
    usageDataOverride.current = { exploreStatsError: new Error('Stats unavailable') }
    const view = render(<UsageSettings />)

    expect(screen.queryByLabelText('总计 · Token')).not.toBeInTheDocument()
    expect(screen.getByRole('alert')).toBeInTheDocument()

    usageDataOverride.current = {}
    view.rerender(<UsageSettings />)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByLabelText('总计 · Token')).toHaveTextContent('0')
  })
  it.each(['loading', 'error'])('does not show a numeric analysis summary while %s', (state) => {
    usageDataOverride.current = {
      overviewTotals: { ...EMPTY_STATS_METRICS, requestCount: 1 },
      exploreStatsLoading: state === 'loading',
      exploreStatsError: state === 'error' ? new Error('Unavailable') : undefined
    }
    render(<UsageSettings />)
    const header = screen.getByText('分析').parentElement!
    expect(header).not.toHaveTextContent('· 0')
  })

  it('uses the aggregate response currency for the Total amount and analysis summary', () => {
    MockCacheUtils.setInitialState({
      persist: [
        ['settings.usage.rollup', 'total'],
        ['settings.usage.chart_metric', 'cost']
      ]
    })
    usageDataOverride.current = {
      overviewTotals: { ...EMPTY_STATS_METRICS, requestCount: 1 },
      costCurrency: 'USD',
      exploreTotals: { ...EMPTY_STATS_METRICS, totalCost: 12, costCurrency: 'CNY' }
    }
    render(<UsageSettings />)
    expect(screen.getByLabelText('总计 · 成本')).toHaveTextContent('¥12.00')
    expect(screen.getByText('分析').parentElement!).toHaveTextContent('¥12.00')
  })

  it('shows usage analytics without the personal profile editor', () => {
    render(<UsageSettings />)
    expect(screen.getByRole('heading', { name: '概览' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '头像' })).not.toBeInTheDocument()
  })

  it('filters entries by the clicked line chart point and clears on repeat click or clear action', async () => {
    const user = userEvent.setup()
    const today = new Date()
    const yyyy = today.getFullYear()
    const mm = String(today.getMonth() + 1).padStart(2, '0')
    const dd = String(today.getDate()).padStart(2, '0')
    const todayKey = `${yyyy}-${mm}-${dd}`
    const startOf30d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 29)
    const startKey = `${startOf30d.getFullYear()}-${String(startOf30d.getMonth() + 1).padStart(2, '0')}-${String(startOf30d.getDate()).padStart(2, '0')}`

    MockCacheUtils.setInitialState({
      persist: [
        ['settings.usage.chart_type', 'line'],
        ['settings.usage.group_by', 'model'],
        ['settings.usage.rollup', 'daily']
      ]
    })
    usageDataOverride.current = {
      overviewTotals: { ...EMPTY_STATS_METRICS, totalTokens: 100, requestCount: 1 },
      timelineBuckets: [
        {
          date: todayKey,
          costCurrency: null,
          totalTokens: 100,
          totalNoCacheTokens: 100,
          totalCacheReadTokens: 0,
          totalCacheWriteTokens: 0,
          totalCost: 0,
          recordCount: 1,
          requestCount: 1,
          estimatedRequestCount: 0,
          unpricedRequestCount: 1
        }
      ],
      exploreTimelineRows: [
        {
          date: startKey,
          providerId: 'openai',
          providerName: 'OpenAI',
          modelId: 'openai::gpt-4o',
          costCurrency: null,
          totalTokens: 100,
          totalNoCacheTokens: 100,
          totalCacheReadTokens: 0,
          totalCacheWriteTokens: 0,
          totalCost: 0,
          recordCount: 1,
          requestCount: 1,
          estimatedRequestCount: 0,
          unpricedRequestCount: 1
        }
      ]
    }

    render(<UsageSettings />)

    await user.click(await screen.findByRole('button', { name: 'MockChartPoint' }))

    expect(useUsageEntriesDataMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        windowRange: {
          from: new Date(startOf30d.getFullYear(), startOf30d.getMonth(), startOf30d.getDate(), 0, 0, 0, 0).getTime(),
          to: new Date(startOf30d.getFullYear(), startOf30d.getMonth(), startOf30d.getDate(), 23, 59, 59, 999).getTime()
        },
        groupFilter: { providerId: 'openai', modelId: 'openai::gpt-4o' }
      })
    )
    expect(screen.getByText(/gpt-4o/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'MockChartPoint' }))
    expect(screen.queryByRole('button', { name: 'ClearFilter' })).not.toBeInTheDocument()
    expect(useUsageEntriesDataMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        groupFilter: undefined
      })
    )

    await user.click(screen.getByRole('button', { name: 'MockChartPoint' }))
    expect(screen.getByRole('button', { name: 'ClearFilter' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'ClearFilter' }))
    expect(screen.queryByRole('button', { name: 'ClearFilter' })).not.toBeInTheDocument()
  })
})
