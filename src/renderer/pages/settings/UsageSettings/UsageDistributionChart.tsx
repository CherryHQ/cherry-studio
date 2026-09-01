import { lazy, Suspense, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { EmptyState, Skeleton } from '@cherrystudio/ui'
import { formatCompactNumber } from '@renderer/utils/number'
import { getLocaleFirstDayOfWeek } from '@renderer/utils/time'
import type { AiUsageRecordGroupIdentity, AiUsageRecordTimelineBucket } from '@shared/data/api/schemas/aiUsageRecords'
import type { Currency } from '@shared/data/types/model'

import {
  type BoundedTimeRange,
  buildChartSeries,
  CHART_TYPE_LABEL_KEYS,
  getTimelinePoints,
  toPeriodKey,
  type UsageChartType,
  type UsageMetricKey,
  type UsageRollupKey
} from './usageAnalytics'
import { formatCost, parseDateKey } from './usageDisplay'

const Chart = lazy(() => import('@renderer/components/Chart').then((module) => ({ default: module.Chart })))

interface UsageDistributionChartProps {
  range: BoundedTimeRange
  timelineBuckets: AiUsageRecordTimelineBucket[]
  exploreTimelineRows: AiUsageRecordTimelineBucket[]
  rollup: UsageRollupKey
  chartMetric: UsageMetricKey
  chartType: UsageChartType
  topCount: number
  costCurrency?: Currency
  exploreTimelineLoading: boolean
  dateFormatter: Intl.DateTimeFormat
  monthFormatter: Intl.DateTimeFormat
  getBucketLabel: (bucket: AiUsageRecordGroupIdentity) => string
}

function makeUniqueNames(labels: string[]): string[] {
  const counts = new Map<string, number>()
  const occurrences = new Map<string, number>()
  for (const label of labels) counts.set(label, (counts.get(label) ?? 0) + 1)

  return labels.map((label) => {
    const occurrence = (occurrences.get(label) ?? 0) + 1
    occurrences.set(label, occurrence)
    return counts.get(label) === 1 ? label : `${label} (${occurrence})`
  })
}

export function UsageDistributionChart({
  range,
  timelineBuckets,
  exploreTimelineRows,
  rollup,
  chartMetric,
  chartType,
  topCount,
  costCurrency,
  exploreTimelineLoading,
  dateFormatter,
  monthFormatter,
  getBucketLabel
}: UsageDistributionChartProps) {
  const { t, i18n } = useTranslation()
  const firstDayOfWeek = useMemo(() => getLocaleFirstDayOfWeek(i18n.resolvedLanguage), [i18n.resolvedLanguage])
  const periodKeys = useMemo(() => {
    const keys: string[] = []

    for (const point of getTimelinePoints(timelineBuckets, range, () => 0)) {
      const key = toPeriodKey(point.date, rollup, firstDayOfWeek)
      if (keys[keys.length - 1] !== key) keys.push(key)
    }

    return keys
  }, [firstDayOfWeek, range, rollup, timelineBuckets])
  const chartSeries = useMemo(
    () =>
      buildChartSeries(exploreTimelineRows, periodKeys, {
        rollup,
        metric: chartMetric,
        currency: costCurrency,
        topCount,
        firstDayOfWeek
      }),
    [chartMetric, costCurrency, exploreTimelineRows, firstDayOfWeek, periodKeys, rollup, topCount]
  )
  const formatChartValue = useCallback(
    (value: number) => (chartMetric === 'cost' ? formatCost(value, costCurrency) : formatCompactNumber(value)),
    [chartMetric, costCurrency]
  )
  const formatPeriod = useCallback(
    (periodKey: string) => {
      if (rollup === 'monthly') return monthFormatter.format(parseDateKey(periodKey))
      if (rollup === 'weekly') {
        const start = parseDateKey(periodKey)
        const end = parseDateKey(periodKey)
        end.setDate(end.getDate() + 6)
        const clippedStart = new Date(Math.max(start.getTime(), range.from))
        const clippedEnd = new Date(Math.min(end.getTime(), range.to))
        return `${dateFormatter.format(clippedStart)} – ${dateFormatter.format(clippedEnd)}`
      }
      return dateFormatter.format(parseDateKey(periodKey))
    },
    [dateFormatter, monthFormatter, range.from, range.to, rollup]
  )
  const tooltip = {
    valueFormatter: (value: unknown) => formatChartValue(Number(value))
  }
  const isEmpty = periodKeys.length === 0 || chartSeries.every((series) => series.total <= 0)

  if (!exploreTimelineLoading && isEmpty) {
    return (
      <EmptyState
        compact
        preset="no-result"
        title={t('settings.usage.explore.noBreakdown')}
        description={t('settings.usage.explore.noBreakdownDescription')}
      />
    )
  }

  const names = makeUniqueNames(
    chartSeries.map((item) => (item.identity ? getBucketLabel(item.identity) : t('common.other')))
  )

  if (chartType === 'pie') {
    const frames = periodKeys.map((periodKey, periodIndex) => ({
      label: formatPeriod(periodKey),
      data: chartSeries.map((item, seriesIndex) => ({
        name: names[seriesIndex],
        value: item.values[periodIndex] ?? 0
      }))
    }))
    let currentIndex = Math.max(0, frames.length - 1)
    while (currentIndex > 0 && frames[currentIndex].data.every((item) => item.value <= 0)) {
      currentIndex -= 1
    }

    return (
      <div className="min-w-0 p-3">
        <Suspense fallback={<Skeleton className="h-80 rounded-md" />}>
          <Chart
            type="pie"
            ariaLabel={t(CHART_TYPE_LABEL_KEYS.pie)}
            className="h-80"
            data={frames[currentIndex]?.data ?? []}
            loading={exploreTimelineLoading}
            loadingLabel={t('settings.usage.explore.loading')}
            timeline={{ currentIndex, frames }}
            option={{ tooltip, legend: {} }}
          />
        </Suspense>
      </div>
    )
  }

  const series = chartSeries.map((item, index) => ({
    id: item.key,
    name: names[index],
    values: item.values
  }))

  return (
    <div className="min-w-0 p-3">
      <Suspense fallback={<Skeleton className="h-80 rounded-md" />}>
        <Chart
          type={chartType}
          ariaLabel={t(CHART_TYPE_LABEL_KEYS[chartType])}
          categories={periodKeys.map(formatPeriod)}
          className="h-80"
          loading={exploreTimelineLoading}
          loadingLabel={t('settings.usage.explore.loading')}
          series={series}
          stack="total"
          visibleCategoryCount={rollup === 'daily' ? 30 : 16}
          option={{
            tooltip,
            legend: {},
            xAxis: { axisPointer: { type: chartType === 'bar' ? 'shadow' : 'line' } },
            yAxis: {
              minInterval: chartMetric === 'cost' ? undefined : 1,
              axisLabel: { formatter: (value: number) => formatChartValue(value) }
            }
          }}
        />
      </Suspense>
    </div>
  )
}
