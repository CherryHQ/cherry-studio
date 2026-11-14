import { describe, expect, it } from 'vitest'

import type { AiUsageRecordStatsResponse } from '@shared/data/api/schemas/aiUsageRecords'

import { buildTotalChartSeries, EMPTY_STATS_METRICS, type UsageMetricKey } from '../usageAnalytics'

const stats: AiUsageRecordStatsResponse = {
  buckets: [
    {
      ...EMPTY_STATS_METRICS,
      groupBy: 'model',
      providerId: 'openai',
      providerName: 'OpenAI',
      modelId: 'gpt-4o',
      totalTokens: 1800,
      requestCount: 8,
      costCurrency: 'USD',
      totalCost: 0.12
    }
  ],
  totals: { ...EMPTY_STATS_METRICS, totalTokens: 2400, requestCount: 12, costCurrency: 'USD', totalCost: 0.18 },
  other: { ...EMPTY_STATS_METRICS, totalTokens: 600, requestCount: 4, costCurrency: 'USD', totalCost: 0.06 }
}

describe('buildTotalChartSeries', () => {
  it.each<[UsageMetricKey, number[]]>([
    ['tokens', [1800, 600]],
    ['requests', [8, 4]],
    ['cost', [0.12, 0.06]]
  ])('includes the server-ranked remainder for %s without requiring daily data', (metric, expected) => {
    const series = buildTotalChartSeries(stats, metric)
    expect(series.map((item) => item.total)).toEqual(expected)
    expect(series[0].identity).toMatchObject({ modelId: 'gpt-4o' })
    expect(series[1]).toEqual({ key: 'other', values: [expected[1]], total: expected[1] })
  })

  it('does not offer empty slices when the selected metric has no usage', () => {
    expect(
      buildTotalChartSeries(
        { buckets: stats.buckets.map((item) => ({ ...item, totalCost: 0 })), other: EMPTY_STATS_METRICS },
        'cost'
      )
    ).toEqual([])
  })
})
