import { getLocaleFirstDayOfWeek } from '@renderer/utils/time'
import type { AiUsageRecordTimelineBucket } from '@shared/data/api/schemas/aiUsageRecords'
import { describe, expect, it } from 'vitest'

import { buildChartSeries, getTimelinePoints, selectCostTotal, toPeriodKey } from '../usageAnalytics'

function bucket(date: string, totalTokens: number, overrides: Partial<AiUsageRecordTimelineBucket> = {}) {
  return {
    date,
    costCurrency: 'USD',
    totalTokens,
    totalNoCacheTokens: totalTokens,
    totalCacheReadTokens: 0,
    totalCacheWriteTokens: 0,
    totalCost: 0,
    recordCount: 1,
    requestCount: 1,
    estimatedRequestCount: 0,
    unpricedRequestCount: 0,
    ...overrides
  } satisfies AiUsageRecordTimelineBucket
}

const getTokens = (value: AiUsageRecordTimelineBucket) => value.totalTokens

describe('getTimelinePoints', () => {
  it('fills gap days with zero and keeps calendar order', () => {
    const from = new Date(2026, 2, 1).getTime()
    const to = new Date(2026, 2, 4, 23, 59, 59, 999).getTime()

    expect(getTimelinePoints([bucket('2026-03-03', 42)], { from, to }, getTokens)).toEqual([
      { date: '2026-03-01', value: 0 },
      { date: '2026-03-02', value: 0 },
      { date: '2026-03-03', value: 42 },
      { date: '2026-03-04', value: 0 }
    ])
  })

  it('steps by calendar day across a DST transition', () => {
    // 2026-11-01 is the US fall-back day (25h long in America/New_York).
    const from = new Date(2026, 9, 30).getTime()
    const to = new Date(2026, 10, 3, 23, 59, 59, 999).getTime()
    const dates = getTimelinePoints([], { from, to }, getTokens).map((point) => point.date)

    expect(dates).toEqual(['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02', '2026-11-03'])
    expect(new Set(dates).size).toBe(dates.length)
  })

  it('spans the buckets it was given when the range is unbounded', () => {
    const points = getTimelinePoints([bucket('2026-03-03', 7), bucket('2026-03-09', 9)], {}, getTokens)

    expect(points).toHaveLength(7)
    expect(points[0]).toEqual({ date: '2026-03-03', value: 7 })
    expect(points[3]).toEqual({ date: '2026-03-06', value: 0 })
    expect(points[6]).toEqual({ date: '2026-03-09', value: 9 })
  })

  it('has no axis to draw without buckets or bounds', () => {
    expect(getTimelinePoints([], {}, getTokens)).toEqual([])
  })
})

describe('selectCostTotal', () => {
  it('keeps an explicit zero-cost currency selectable in the UI', () => {
    expect(selectCostTotal([{ currency: 'USD', total: 0 }])).toEqual({ currency: 'USD', total: 0 })
  })
})

describe('toPeriodKey', () => {
  it('keeps the day itself for the daily rollup', () => {
    expect(toPeriodKey('2026-03-04', 'daily', getLocaleFirstDayOfWeek('en-US'))).toBe('2026-03-04')
  })

  it('maps a whole week onto its locale-specific first day', () => {
    // 2026-03-02 is a Monday, 2026-03-08 the Sunday that closes the same week.
    const mondayWeek = ['2026-03-02', '2026-03-04', '2026-03-08'].map((date) =>
      toPeriodKey(date, 'weekly', getLocaleFirstDayOfWeek('zh-CN'))
    )
    const sundayWeek = ['2026-03-01', '2026-03-04', '2026-03-07'].map((date) =>
      toPeriodKey(date, 'weekly', getLocaleFirstDayOfWeek('en-US'))
    )

    expect(mondayWeek).toEqual(['2026-03-02', '2026-03-02', '2026-03-02'])
    expect(sundayWeek).toEqual(['2026-03-01', '2026-03-01', '2026-03-01'])
  })

  it('maps a month onto its first day', () => {
    expect(toPeriodKey('2026-03-31', 'monthly', getLocaleFirstDayOfWeek('en-US'))).toBe('2026-03-01')
  })
})

describe('buildChartSeries', () => {
  const periods = ['2026-03-01', '2026-03-02', '2026-03-03']
  const options = {
    rollup: 'daily',
    metric: 'tokens',
    topCount: 10,
    firstDayOfWeek: getLocaleFirstDayOfWeek('en-US')
  } as const

  it('aligns one series per group to the period axis', () => {
    const series = buildChartSeries(
      [
        bucket('2026-03-01', 10, { modelId: 'a' }),
        bucket('2026-03-03', 5, { modelId: 'a' }),
        bucket('2026-03-02', 30, { modelId: 'b' })
      ],
      periods,
      options
    )

    expect(series).toEqual([
      {
        key: expect.stringContaining('b'),
        identity: expect.objectContaining({ modelId: 'b' }),
        values: [0, 30, 0],
        total: 30
      },
      {
        key: expect.stringContaining('a'),
        identity: expect.objectContaining({ modelId: 'a' }),
        values: [10, 0, 5],
        total: 15
      }
    ])
  })

  it('merges the currency splits of one group and drops buckets outside the axis', () => {
    const series = buildChartSeries(
      [
        bucket('2026-03-01', 10, { modelId: 'a', costCurrency: 'USD' }),
        bucket('2026-03-01', 4, { modelId: 'a', costCurrency: 'CNY' }),
        bucket('2026-03-01', 6, { modelId: 'a', costCurrency: null }),
        bucket('2026-02-27', 99, { modelId: 'a' })
      ],
      periods,
      options
    )

    expect(series).toHaveLength(1)
    expect(series[0].values).toEqual([20, 0, 0])
  })

  it('keeps explicit selection and matched overrides in separate key series', () => {
    const series = buildChartSeries(
      [
        bucket('2026-03-01', 10, {
          providerId: 'openai',
          apiKeyId: 'key-a',
          apiKeyAttribution: 'explicit',
          authMethod: null
        }),
        bucket('2026-03-01', 20, {
          providerId: 'openai',
          apiKeyId: 'key-a',
          apiKeyAttribution: 'matched',
          authMethod: null
        })
      ],
      periods,
      options
    )

    expect(series).toHaveLength(2)
    expect(series.map((item) => item.identity?.apiKeyAttribution)).toEqual(['matched', 'explicit'])
  })

  it('counts cost only in the scoped currency', () => {
    const series = buildChartSeries(
      [
        bucket('2026-03-01', 10, { modelId: 'a', costCurrency: 'USD', totalCost: 2 }),
        bucket('2026-03-01', 10, { modelId: 'a', costCurrency: 'CNY', totalCost: 50 })
      ],
      periods,
      { ...options, metric: 'cost', currency: 'USD' }
    )

    expect(series[0].values).toEqual([2, 0, 0])
  })

  it('folds the groups past topCount into a trailing series without identity', () => {
    const series = buildChartSeries(
      [
        bucket('2026-03-01', 30, { modelId: 'a' }),
        bucket('2026-03-01', 20, { modelId: 'b' }),
        bucket('2026-03-02', 7, { modelId: 'c' }),
        bucket('2026-03-03', 3, { modelId: 'd' })
      ],
      periods,
      { ...options, topCount: 2 }
    )

    expect(series.map((item) => item.total)).toEqual([30, 20, 10])
    expect(series[2]).toMatchObject({ key: 'other', values: [0, 7, 3] })
    expect(series[2].identity).toBeUndefined()
  })

  it('keeps the server-provided other remainder as a trailing identity-free series', () => {
    const series = buildChartSeries(
      [
        bucket('2026-03-01', 30, { modelId: 'a' }),
        bucket('2026-03-01', 7, { isOther: true }),
        bucket('2026-03-03', 3, { isOther: true })
      ],
      periods,
      options
    )

    expect(series.map((item) => item.total)).toEqual([30, 10])
    expect(series[1]).toMatchObject({ key: 'other', values: [7, 0, 3] })
    expect(series[1].identity).toBeUndefined()
  })
})
