import { render, waitFor } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ChartProps } from '@renderer/components/Chart'
import type { AiUsageRecordTimelineBucket } from '@shared/data/api/schemas/aiUsageRecords'

import { EMPTY_STATS_METRICS } from '../usageAnalytics'
import { UsageDistributionChart } from '../UsageDistributionChart'

const { chartRender } = vi.hoisted(() => ({ chartRender: vi.fn<(props: ChartProps) => void>() }))

vi.mock('@renderer/components/Chart', () => ({
  Chart: (props: ChartProps) => {
    chartRender(props)
    return null
  }
}))

const timelineRows: AiUsageRecordTimelineBucket[] = ['2026-11-01', '2026-11-02'].map((date, index) => ({
  ...EMPTY_STATS_METRICS,
  date,
  providerId: 'provider-1',
  providerName: 'Provider',
  totalTokens: (index + 1) * 100
}))
const props: ComponentProps<typeof UsageDistributionChart> = {
  range: { from: new Date(2026, 10, 1).getTime(), to: new Date(2026, 10, 3, 23, 59, 59).getTime() },
  timelineBuckets: timelineRows,
  exploreTimelineRows: timelineRows,
  exploreBuckets: [
    {
      ...EMPTY_STATS_METRICS,
      groupBy: 'provider',
      providerId: 'provider-1',
      providerName: 'Provider',
      totalTokens: 300
    }
  ],
  exploreOther: EMPTY_STATS_METRICS,
  exploreTotals: { ...EMPTY_STATS_METRICS, totalTokens: 300 },
  exploreStatsLoading: false,
  rollup: 'daily',
  chartMetric: 'tokens',
  chartType: 'pie',
  topCount: 10,
  exploreTimelineLoading: false,
  dateFormatter: new Intl.DateTimeFormat('en-US'),
  monthFormatter: new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric' }),
  getBucketLabel: (bucket) => bucket.providerName ?? ''
}

describe('UsageDistributionChart', () => {
  beforeEach(() => chartRender.mockClear())

  it('keeps pie option, timeline and data references stable across parent rerenders', async () => {
    const { rerender } = render(<UsageDistributionChart {...props} />)
    await waitFor(() => expect(chartRender.mock.calls.length).toBeGreaterThan(0))
    const first = chartRender.mock.calls[0][0]
    if (first.type !== 'pie') throw new Error('Expected pie chart')
    expect(first.timeline?.frames).toHaveLength(3)
    expect(first.timeline?.currentIndex).toBe(1)

    chartRender.mockClear()
    rerender(<UsageDistributionChart {...props} range={{ ...props.range }} />)
    await waitFor(() => expect(chartRender.mock.calls.length).toBeGreaterThan(0))
    const last = chartRender.mock.calls.at(-1)![0]
    if (last.type !== 'pie') throw new Error('Expected pie chart')

    expect(last.option).toBe(first.option)
    expect(last.timeline).toBe(first.timeline)
    expect(last.timeline?.frames).toBe(first.timeline?.frames)
    expect(last.data).toBe(first.data)
  })

  it.each([
    ['bar', 'daily'],
    ['bar', 'total'],
    ['line', 'weekly']
  ] as const)('keeps %s inputs stable across parent rerenders (%s)', async (chartType, rollup) => {
    const { rerender } = render(<UsageDistributionChart {...props} chartType={chartType} rollup={rollup} />)
    await waitFor(() => expect(chartRender.mock.calls.length).toBeGreaterThan(0))
    const first = chartRender.mock.calls[0][0]
    if (first.type === 'pie') throw new Error('Expected cartesian chart')

    chartRender.mockClear()
    rerender(<UsageDistributionChart {...props} range={{ ...props.range }} chartType={chartType} rollup={rollup} />)
    await waitFor(() => expect(chartRender.mock.calls.length).toBeGreaterThan(0))
    const last = chartRender.mock.calls.at(-1)![0]
    if (last.type === 'pie') throw new Error('Expected cartesian chart')

    expect(last.option).toBe(first.option)
    expect(last.categories).toBe(first.categories)
    expect(last.series).toBe(first.series)
  })

  it('updates pie labels and frames when their inputs change', async () => {
    const { rerender } = render(<UsageDistributionChart {...props} />)
    await waitFor(() => expect(chartRender.mock.calls.length).toBeGreaterThan(0))

    rerender(
      <UsageDistributionChart
        {...props}
        getBucketLabel={() => 'Renamed provider'}
        exploreTimelineRows={[...timelineRows, { ...timelineRows[0], date: '2026-11-03', totalTokens: 400 }]}
      />
    )
    const last = chartRender.mock.calls.at(-1)![0]
    if (last.type !== 'pie') throw new Error('Expected pie chart')

    expect(last.timeline?.currentIndex).toBe(2)
    expect(last.timeline?.frames.map((frame) => frame.data)).toEqual([
      [{ name: 'Renamed provider', value: 100 }],
      [{ name: 'Renamed provider', value: 200 }],
      [{ name: 'Renamed provider', value: 400 }]
    ])
    expect(last.data).toEqual([{ name: 'Renamed provider', value: 400 }])
  })
})
