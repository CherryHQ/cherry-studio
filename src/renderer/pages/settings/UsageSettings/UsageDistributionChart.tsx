import { EmptyState, Skeleton } from '@cherrystudio/ui'
import { formatCompactNumber } from '@renderer/utils/number'
import { cn } from '@renderer/utils/style'
import type {
  AiUsageRecordGroupIdentity,
  AiUsageRecordStatsBucket,
  AiUsageRecordStatsMetrics,
  AiUsageRecordTimelineBucket
} from '@shared/data/api/schemas/aiUsageRecord'
import type { Currency } from '@shared/data/types/model'
import { type ReactNode, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import {
  type BoundedTimeRange,
  buildChartSeries,
  CHART_COLORS,
  getBucketKey,
  getMetricValue,
  getTimelinePoints,
  toPeriodKey,
  type UsageChartType,
  type UsageMetricKey,
  type UsageRollupKey
} from './usageAnalytics'
import { formatCost, parseDateKey } from './usageDisplay'
import { UsageDistributionHoverCard } from './UsageSettingsPrimitives'

interface UsageDistributionChartProps {
  activeRange: BoundedTimeRange
  timelineBuckets: AiUsageRecordTimelineBucket[]
  exploreBuckets: AiUsageRecordStatsBucket[]
  exploreTimelineRows: AiUsageRecordTimelineBucket[]
  exploreTotals: AiUsageRecordStatsMetrics
  exploreOther: AiUsageRecordStatsMetrics
  rollup: UsageRollupKey
  chartMetric: UsageMetricKey
  chartType: UsageChartType
  topCount: number
  costCurrency?: Currency
  exploreStatsLoading: boolean
  exploreTimelineLoading: boolean
  dateFormatter: Intl.DateTimeFormat
  monthFormatter: Intl.DateTimeFormat
  formatShare: (value: number) => string
  getBucketLabel: (bucket: AiUsageRecordGroupIdentity) => string
  renderBucketLabel: (bucket: AiUsageRecordGroupIdentity) => ReactNode
}

export function UsageDistributionChart({
  activeRange,
  timelineBuckets,
  exploreBuckets,
  exploreTimelineRows,
  exploreTotals,
  exploreOther,
  rollup,
  chartMetric,
  chartType,
  topCount,
  costCurrency,
  exploreStatsLoading,
  exploreTimelineLoading,
  dateFormatter,
  monthFormatter,
  formatShare,
  getBucketLabel,
  renderBucketLabel
}: UsageDistributionChartProps) {
  const { t } = useTranslation()
  const totalExploreMetric = getMetricValue(exploreTotals, chartMetric)
  const periodKeys = useMemo(() => {
    const keys: string[] = []

    for (const point of getTimelinePoints(timelineBuckets, activeRange, () => 0)) {
      const key = toPeriodKey(point.date, rollup)
      if (keys[keys.length - 1] !== key) {
        keys.push(key)
      }
    }

    return keys
  }, [activeRange, rollup, timelineBuckets])
  const chartSeries = useMemo(
    () =>
      buildChartSeries(exploreTimelineRows, periodKeys, {
        rollup,
        metric: chartMetric,
        currency: costCurrency,
        topCount
      }),
    [chartMetric, costCurrency, exploreTimelineRows, periodKeys, rollup, topCount]
  )
  const exploreTopBuckets = useMemo(
    () =>
      [...exploreBuckets]
        .filter((bucket) => getMetricValue(bucket, chartMetric) > 0)
        .sort((a, b) => getMetricValue(b, chartMetric) - getMetricValue(a, chartMetric))
        .slice(0, topCount),
    [chartMetric, exploreBuckets, topCount]
  )
  const otherExploreMetric = getMetricValue(exploreOther, chartMetric)
  const formatChartValue = (value: number) =>
    chartMetric === 'cost' ? formatCost(value, costCurrency) : formatCompactNumber(value)
  const renderEmptyDistribution = () => (
    <EmptyState
      compact
      preset="no-result"
      title={t('settings.usage.explore.noBreakdown')}
      description={t('settings.usage.explore.noBreakdownDescription')}
    />
  )

  const renderPeriodChart = () => {
    if (periodKeys.length === 0 || chartSeries.every((series) => series.total <= 0)) {
      return renderEmptyDistribution()
    }

    const periodTotals = periodKeys.map((_, index) =>
      chartSeries.reduce((sum, series) => sum + series.values[index], 0)
    )
    const maxPeriodTotal = Math.max(...periodTotals)
    const maxSeriesValue = Math.max(...chartSeries.flatMap((series) => series.values))
    const seriesColor = (index: number) => CHART_COLORS[index % CHART_COLORS.length]
    const seriesLabel = (series: (typeof chartSeries)[number]) =>
      series.identity ? getBucketLabel(series.identity) : t('common.other')
    const formatPeriod = (periodKey: string) => {
      if (rollup === 'monthly') {
        return monthFormatter.format(parseDateKey(periodKey))
      }

      if (rollup === 'weekly') {
        const end = parseDateKey(periodKey)
        end.setDate(end.getDate() + 6)
        return `${dateFormatter.format(parseDateKey(periodKey))} – ${dateFormatter.format(end)}`
      }

      return dateFormatter.format(parseDateKey(periodKey))
    }
    const axis = (
      <div className="mt-2 flex min-w-0 justify-between gap-3 text-foreground-muted text-xs">
        <span className="truncate">{formatPeriod(periodKeys[0])}</span>
        <span className="truncate">{formatPeriod(periodKeys[periodKeys.length - 1])}</span>
      </div>
    )
    const legend = (
      <div className="mt-3 grid min-w-0 @[760px]/usage:grid-cols-4 grid-cols-2 gap-2">
        {chartSeries.map((series, index) => (
          <div key={series.key} className="flex min-w-0 items-center gap-2 text-xs">
            <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: seriesColor(index) }} />
            <span className="min-w-0 truncate text-foreground-muted">
              {series.identity ? renderBucketLabel(series.identity) : t('common.other')}
            </span>
            <span className="ml-auto shrink-0 font-medium text-foreground">{formatChartValue(series.total)}</span>
          </div>
        ))}
      </div>
    )

    if (chartType === 'line') {
      const width = 720
      const height = 220
      const toX = (index: number) => (periodKeys.length > 1 ? (index / (periodKeys.length - 1)) * width : width / 2)
      const toY = (value: number) => height - (value / maxSeriesValue) * (height - 24) - 12

      return (
        <div className="min-w-0 p-3">
          <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="h-64 w-full" role="img">
            <title>{t('settings.usage.chart.line')}</title>
            {chartSeries.map((series, index) => (
              <polyline
                key={series.key}
                points={series.values.map((value, position) => `${toX(position)},${toY(value)}`).join(' ')}
                fill="none"
                stroke={seriesColor(index)}
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
              />
            ))}
          </svg>
          {axis}
          {legend}
        </div>
      )
    }

    return (
      <div className="min-w-0 p-3">
        <div className={cn('flex h-64 min-w-0 items-end border-border border-b', periodKeys.length <= 120 && 'gap-px')}>
          {periodKeys.map((periodKey, index) => (
            <div
              key={periodKey}
              title={`${formatPeriod(periodKey)}: ${formatChartValue(periodTotals[index])}`}
              className="flex h-full min-w-0 flex-1 flex-col-reverse">
              {chartSeries.map((series, seriesIndex) =>
                series.values[index] > 0 ? (
                  <div
                    key={series.key}
                    title={`${seriesLabel(series)}: ${formatChartValue(series.values[index])}`}
                    style={{
                      height: `${(series.values[index] / maxPeriodTotal) * 100}%`,
                      backgroundColor: seriesColor(seriesIndex)
                    }}
                  />
                ) : null
              )}
            </div>
          ))}
        </div>
        {axis}
        {legend}
      </div>
    )
  }

  const isPeriodChart = rollup !== 'total'
  if (isPeriodChart ? exploreTimelineLoading : exploreStatsLoading) {
    return (
      <div className="flex flex-col gap-2 p-3">
        {Array.from({ length: 6 }, (_, index) => (
          <Skeleton key={index} className="h-10 rounded-md" />
        ))}
      </div>
    )
  }
  if (isPeriodChart) {
    return renderPeriodChart()
  }

  const entries = [
    ...exploreTopBuckets.map((bucket, index) => {
      const value = getMetricValue(bucket, chartMetric)
      return {
        key: getBucketKey(bucket),
        label: renderBucketLabel(bucket),
        plainLabel: getBucketLabel(bucket),
        value,
        tokens: bucket.totalTokens,
        requests: bucket.requestCount,
        cost: bucket.totalCost,
        share: totalExploreMetric > 0 ? value / totalExploreMetric : 0,
        color: CHART_COLORS[index % CHART_COLORS.length]
      }
    }),
    ...(otherExploreMetric > 0
      ? [
          {
            key: 'other',
            label: t('common.other'),
            plainLabel: t('common.other'),
            value: otherExploreMetric,
            tokens: exploreOther.totalTokens,
            requests: exploreOther.requestCount,
            cost: exploreOther.totalCost,
            share: totalExploreMetric > 0 ? otherExploreMetric / totalExploreMetric : 0,
            color: CHART_COLORS[exploreTopBuckets.length % CHART_COLORS.length]
          }
        ]
      : [])
  ]

  if (entries.length === 0) {
    return renderEmptyDistribution()
  }

  const renderHoverCardForEntry = (entry: (typeof entries)[number], children: ReactNode) => (
    <UsageDistributionHoverCard
      key={entry.key}
      label={entry.label}
      metric={formatChartValue(entry.value)}
      share={formatShare(entry.share)}
      tokens={formatCompactNumber(entry.tokens)}
      requests={entry.requests}
      cost={formatCost(entry.cost, costCurrency)}
      costCurrency={costCurrency}
      labels={{
        share: t('settings.usage.explore.shareLabel'),
        tokens: t('settings.usage.table.tokens'),
        requests: t('settings.usage.metric.requests'),
        cost: t('settings.usage.table.cost')
      }}>
      {children}
    </UsageDistributionHoverCard>
  )

  if (chartType === 'pie') {
    let offset = 0
    const radius = 56
    const circumference = 2 * Math.PI * radius

    return (
      <div className="grid min-w-0 @[820px]/usage:grid-cols-[18rem_minmax(0,1fr)] grid-cols-1 gap-4 p-3">
        <div className="flex min-h-64 items-center justify-center">
          <svg viewBox="0 0 160 160" className="-rotate-90 size-56" role="img">
            <title>{t('settings.usage.chart.pie')}</title>
            <circle cx="80" cy="80" r={radius} fill="none" stroke="var(--muted)" strokeWidth="22" />
            {entries.map((entry) => {
              const length = entry.share * circumference
              const dashOffset = -offset
              offset += length

              return (
                <circle
                  key={entry.key}
                  cx="80"
                  cy="80"
                  r={radius}
                  fill="none"
                  stroke={entry.color}
                  strokeWidth="22"
                  strokeDasharray={`${length} ${circumference - length}`}
                  strokeDashoffset={dashOffset}
                  strokeLinecap="butt">
                  <title>{`${entry.plainLabel}: ${formatChartValue(entry.value)} (${formatShare(entry.share)})`}</title>
                </circle>
              )
            })}
          </svg>
        </div>
        <div className="grid min-w-0 @[820px]/usage:grid-cols-2 content-start gap-2">
          {entries.map((entry) =>
            renderHoverCardForEntry(
              entry,
              <div className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 rounded-md px-2 py-1.5 hover:bg-accent">
                <span className="size-2.5 rounded-full" style={{ backgroundColor: entry.color }} />
                <span className="min-w-0 truncate text-foreground text-sm">{entry.label}</span>
                <span className="shrink-0 font-medium text-foreground text-xs">{formatChartValue(entry.value)}</span>
              </div>
            )
          )}
        </div>
      </div>
    )
  }

  const maxExploreMetric = Math.max(...entries.map((entry) => entry.value), 0)
  return (
    <div className="min-w-0 p-3">
      <div className="flex h-3 min-w-0 overflow-hidden rounded-full bg-muted" aria-hidden>
        {entries.map((entry) =>
          renderHoverCardForEntry(
            entry,
            <div
              className="min-w-1"
              style={{
                flexBasis: 0,
                flexGrow: entry.value,
                backgroundColor: entry.color
              }}
            />
          )
        )}
      </div>

      <div className="mt-3 grid min-w-0 @[820px]/usage:grid-cols-2 grid-cols-1 gap-x-4">
        {entries.map((entry) => {
          const percent = maxExploreMetric > 0 ? Math.max(3, (entry.value / maxExploreMetric) * 100) : 0

          return renderHoverCardForEntry(
            entry,
            <div className="min-w-0 border-border border-t py-2">
              <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-3">
                <div className="flex min-w-0 items-start gap-2">
                  <span className="mt-1.5 size-2 shrink-0 rounded-full" style={{ backgroundColor: entry.color }} />
                  <div className="min-w-0 text-foreground text-sm">{entry.label}</div>
                </div>
                <div className="shrink-0 text-right font-medium text-foreground text-xs">
                  {formatChartValue(entry.value)}
                </div>
              </div>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full" style={{ width: `${percent}%`, backgroundColor: entry.color }} />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
