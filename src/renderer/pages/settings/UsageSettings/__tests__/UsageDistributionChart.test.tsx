// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import type { AiUsageRecordTimelineBucket } from '@shared/data/api/schemas/aiUsageRecords'

import { EMPTY_STATS_METRICS } from '../usageAnalytics'
import { UsageDistributionChart, type UsageChartPointSelection } from '../UsageDistributionChart'

const chartSpy = vi.hoisted(() => vi.fn())

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { resolvedLanguage: 'en-US' }
  })
}))

vi.mock('@cherrystudio/ui', () => ({
  EmptyState: ({ title }: { title: string }) => <div>{title}</div>,
  Skeleton: () => <div>loading</div>
}))

vi.mock('@renderer/components/Chart', () => ({
  Chart: (props: {
    type: string
    series?: Array<{ id?: string; name: string }>
    timeline?: { currentIndex: number; frames: Array<{ label: string; data: Array<{ name: string; value: number }> }> }
    onDataPointClick?: (params: {
      seriesIndex?: number
      seriesId?: string
      dataIndex: number
      timelineIndex?: number
    }) => void
    onTimelineChange?: (index: number) => void
    children?: ReactNode
  }) => {
    chartSpy(props)
    return (
      <div>
        <div data-testid="timeline-index">{props.timeline?.currentIndex ?? 'none'}</div>
        {props.onTimelineChange && (
          <button type="button" onClick={() => props.onTimelineChange?.(0)}>
            SelectOlderFrame
          </button>
        )}
        {props.onDataPointClick && (
          <>
            <button
              type="button"
              onClick={() => {
                const targetSeries = props.series?.find((item) => item.name === 'provider-a')
                if (!targetSeries?.id) throw new Error('Expected provider-a series id')
                props.onDataPointClick?.({
                  seriesIndex: 0,
                  seriesId: targetSeries.id,
                  dataIndex: 0
                })
              }}>
              ClickStaleIndexWithSeriesId
            </button>
            <button
              type="button"
              onClick={() =>
                props.onDataPointClick?.({
                  dataIndex: 0,
                  timelineIndex: props.timeline?.currentIndex
                })
              }>
              ClickPieSlice
            </button>
          </>
        )}
      </div>
    )
  }
}))

function timelineRow(date: string, providerId: string, totalTokens: number): AiUsageRecordTimelineBucket {
  return {
    date,
    providerId,
    providerName: providerId.toUpperCase(),
    costCurrency: null,
    totalTokens,
    totalNoCacheTokens: totalTokens,
    totalCacheReadTokens: 0,
    totalCacheWriteTokens: 0,
    totalCost: 0,
    recordCount: 1,
    requestCount: 1,
    estimatedRequestCount: 0,
    unpricedRequestCount: 1
  }
}

const range = {
  from: new Date(2026, 2, 1, 0, 0, 0, 0).getTime(),
  to: new Date(2026, 2, 2, 23, 59, 59, 999).getTime()
}
const dateFormatter = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' })
const monthFormatter = new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric' })

describe('UsageDistributionChart', () => {
  it('resolves Cartesian bar clicks by seriesId even after series rank order swaps', async () => {
    const user = userEvent.setup()
    const onSelectPoint = vi.fn<(selection: UsageChartPointSelection) => void>()

    const timelineBuckets = [timelineRow('2026-03-01', 'a', 1), timelineRow('2026-03-02', 'a', 1)]
    const initialRows = [timelineRow('2026-03-01', 'provider-a', 200), timelineRow('2026-03-01', 'provider-b', 100)]
    const swappedRows = [timelineRow('2026-03-01', 'provider-a', 200), timelineRow('2026-03-01', 'provider-b', 500)]

    const baseProps = {
      range,
      timelineBuckets,
      exploreBuckets: [],
      exploreOther: EMPTY_STATS_METRICS,
      exploreTotals: EMPTY_STATS_METRICS,
      exploreStatsLoading: false,
      rollup: 'daily' as const,
      chartMetric: 'tokens' as const,
      chartType: 'bar' as const,
      topCount: 10,
      exploreTimelineLoading: false,
      dateFormatter,
      monthFormatter,
      getBucketLabel: (bucket: { providerId?: string | null }) => bucket.providerId ?? 'unknown',
      onSelectPoint
    }

    const { rerender } = render(<UsageDistributionChart {...baseProps} exploreTimelineRows={initialRows} />)
    rerender(<UsageDistributionChart {...baseProps} exploreTimelineRows={swappedRows} />)

    await user.click(await screen.findByRole('button', { name: 'ClickStaleIndexWithSeriesId' }))

    expect(onSelectPoint).toHaveBeenCalledWith(
      expect.objectContaining({
        periodKey: '2026-03-01',
        identity: expect.objectContaining({ providerId: 'provider-a' }),
        selectionKey: expect.stringMatching(/^2026-03-01:provider-a/)
      })
    )
  })

  it('retains the selected older pie timeline frame across filter updates and clears on repeat click', async () => {
    const user = userEvent.setup()
    const selections: string[] = []
    let activeKey: string | undefined

    const onSelectPoint = vi.fn((selection: UsageChartPointSelection) => {
      activeKey = activeKey === selection.selectionKey ? undefined : selection.selectionKey
      selections.push(activeKey ?? 'cleared')
    })

    const timelineBuckets = [timelineRow('2026-03-01', 'a', 10), timelineRow('2026-03-02', 'a', 20)]
    const exploreTimelineRows = [
      timelineRow('2026-03-01', 'provider-a', 10),
      timelineRow('2026-03-02', 'provider-a', 20)
    ]

    const view = render(
      <UsageDistributionChart
        range={range}
        timelineBuckets={timelineBuckets}
        exploreTimelineRows={exploreTimelineRows}
        exploreBuckets={[]}
        exploreOther={EMPTY_STATS_METRICS}
        exploreTotals={EMPTY_STATS_METRICS}
        exploreStatsLoading={false}
        rollup="daily"
        chartMetric="tokens"
        chartType="pie"
        topCount={10}
        exploreTimelineLoading={false}
        dateFormatter={dateFormatter}
        monthFormatter={monthFormatter}
        getBucketLabel={(bucket) => bucket.providerId ?? 'unknown'}
        onSelectPoint={onSelectPoint}
      />
    )

    expect(await screen.findByTestId('timeline-index')).toHaveTextContent('1')
    await user.click(screen.getByRole('button', { name: 'SelectOlderFrame' }))
    expect(screen.getByTestId('timeline-index')).toHaveTextContent('0')

    await user.click(screen.getByRole('button', { name: 'ClickPieSlice' }))
    expect(selections[0]).toMatch(/^2026-03-01:provider-a/)

    // Re-render parent (as UsageSettings does when entryFilter state updates) and verify frame 0 stays active.
    view.rerender(
      <UsageDistributionChart
        range={range}
        timelineBuckets={timelineBuckets}
        exploreTimelineRows={exploreTimelineRows}
        exploreBuckets={[]}
        exploreOther={EMPTY_STATS_METRICS}
        exploreTotals={EMPTY_STATS_METRICS}
        exploreStatsLoading={false}
        rollup="daily"
        chartMetric="tokens"
        chartType="pie"
        topCount={10}
        exploreTimelineLoading={false}
        dateFormatter={dateFormatter}
        monthFormatter={monthFormatter}
        getBucketLabel={(bucket) => bucket.providerId ?? 'unknown'}
        onSelectPoint={onSelectPoint}
      />
    )
    expect(screen.getByTestId('timeline-index')).toHaveTextContent('0')

    await user.click(screen.getByRole('button', { name: 'ClickPieSlice' }))
    expect(selections).toEqual([expect.stringMatching(/^2026-03-01:provider-a/), 'cleared'])
  })
})
