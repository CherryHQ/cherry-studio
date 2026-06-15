import { NormalTooltip, SegmentedControl, Skeleton } from '@cherrystudio/ui'
import { cn, formatCompactNumber } from '@renderer/utils'
import type { UsageLedgerTimelineBucket } from '@shared/data/api/schemas/usageLedger'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

export type UsageHeatmapMetric = 'tokens' | 'cost'

const DAY_MS = 24 * 60 * 60 * 1000
const HEATMAP_WEEKS = 53
const HEATMAP_DAYS = HEATMAP_WEEKS * 7

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

function dateKey(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')

  return `${year}-${month}-${day}`
}

function buildHeatmapDays(): { date: Date; key: string; isFuture: boolean }[] {
  const today = startOfLocalDay(new Date())
  const lastDay = new Date(today)
  lastDay.setDate(today.getDate() + (6 - today.getDay()))

  return Array.from({ length: HEATMAP_DAYS }, (_, index) => {
    const date = new Date(lastDay.getTime() - (HEATMAP_DAYS - 1 - index) * DAY_MS)
    return {
      date,
      key: dateKey(date),
      isFuture: date.getTime() > today.getTime()
    }
  })
}

function getBucketValue(bucket: UsageLedgerTimelineBucket | undefined, metric: UsageHeatmapMetric): number {
  if (!bucket) {
    return 0
  }

  return metric === 'cost' ? bucket.totalCost : bucket.totalTokens
}

function quantile(sorted: number[], ratio: number): number {
  if (sorted.length === 0) {
    return 0
  }

  const index = Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * ratio))
  return sorted[index]
}

function getIntensity(value: number, thresholds: [number, number, number]): 0 | 1 | 2 | 3 | 4 {
  if (value <= 0) {
    return 0
  }
  if (value <= thresholds[0]) {
    return 1
  }
  if (value <= thresholds[1]) {
    return 2
  }
  if (value <= thresholds[2]) {
    return 3
  }

  return 4
}

function formatCost(value: number, currency: string | null | undefined): string {
  const normalizedCurrency = currency?.toUpperCase() ?? 'USD'
  const symbol = normalizedCurrency === 'CNY' ? '¥' : '$'
  const fractionDigits = value > 0 && value < 1 ? 4 : 2

  return `${symbol}${value.toFixed(fractionDigits)}`
}

interface UsageHeatmapProps {
  buckets: UsageLedgerTimelineBucket[]
  selectedDate?: string
  metric: UsageHeatmapMetric
  onMetricChange: (metric: UsageHeatmapMetric) => void
  onSelectDate: (date: string) => void
  costCurrency?: string | null
  isCostDisabled?: boolean
  isLoading?: boolean
}

const intensityClassNames: Record<0 | 1 | 2 | 3 | 4, string> = {
  0: 'bg-muted/70',
  1: 'bg-primary/25',
  2: 'bg-primary/45',
  3: 'bg-primary/70',
  4: 'bg-primary'
}

export default function UsageHeatmap({
  buckets,
  selectedDate,
  metric,
  onMetricChange,
  onSelectDate,
  costCurrency,
  isCostDisabled,
  isLoading
}: UsageHeatmapProps) {
  const { t, i18n } = useTranslation()

  const days = useMemo(() => buildHeatmapDays(), [])
  const bucketMap = useMemo(() => new Map(buckets.map((bucket) => [bucket.date, bucket])), [buckets])
  const thresholds = useMemo(() => {
    const values = buckets
      .map((bucket) => getBucketValue(bucket, metric))
      .filter((value) => value > 0)
      .sort((a, b) => a - b)

    return [quantile(values, 0.25), quantile(values, 0.5), quantile(values, 0.75)] as [number, number, number]
  }, [buckets, metric])

  const monthLabels = useMemo(() => {
    const formatter = new Intl.DateTimeFormat(i18n.language, { month: 'short' })

    return Array.from({ length: HEATMAP_WEEKS }, (_, weekIndex) => {
      const day = days[weekIndex * 7]
      const previous = weekIndex > 0 ? days[(weekIndex - 1) * 7] : undefined

      return !previous || previous.date.getMonth() !== day.date.getMonth() ? formatter.format(day.date) : ''
    })
  }, [days, i18n.language])

  const dateFormatter = useMemo(
    () => new Intl.DateTimeFormat(i18n.language, { year: 'numeric', month: 'short', day: 'numeric' }),
    [i18n.language]
  )

  const metricOptions = useMemo(
    () =>
      [
        { value: 'tokens' as const, label: t('settings.usage.metric.tokens') },
        { value: 'cost' as const, label: t('settings.usage.metric.cost'), disabled: isCostDisabled }
      ] as const,
    [isCostDisabled, t]
  )

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="font-medium text-foreground text-sm">{t('settings.usage.heatmap.title')}</div>
          {isCostDisabled && (
            <div className="mt-1 text-foreground-muted text-xs">{t('settings.usage.heatmap.costDisabled')}</div>
          )}
        </div>
        <SegmentedControl options={metricOptions} value={metric} onValueChange={onMetricChange} size="sm" />
      </div>

      <div className="overflow-x-auto pb-1">
        <div className="grid min-w-[800px] grid-cols-[repeat(53,minmax(0,1fr))] gap-[3px]">
          {monthLabels.map((label, index) => (
            <div key={`${label}-${index}`} className="h-4 truncate text-[10px] text-foreground-muted leading-4">
              {label}
            </div>
          ))}

          {isLoading
            ? Array.from({ length: HEATMAP_DAYS }, (_, index) => (
                <Skeleton key={index} className="size-3 rounded-[3px]" />
              ))
            : days.map((day) => {
                const bucket = bucketMap.get(day.key)
                const value = getBucketValue(bucket, metric)
                const intensity = getIntensity(value, thresholds)
                const tooltipValue =
                  metric === 'cost'
                    ? t('settings.usage.tooltip.cost', { value: formatCost(value, costCurrency) })
                    : t('settings.usage.tooltip.tokens', { value: formatCompactNumber(value) })
                const tooltipContent = (
                  <div className="flex flex-col gap-1">
                    <span>{dateFormatter.format(day.date)}</span>
                    <span>{tooltipValue}</span>
                    <span>{t('settings.usage.tooltip.requests', { count: bucket?.entryCount ?? 0 })}</span>
                  </div>
                )

                return (
                  <NormalTooltip key={day.key} content={tooltipContent} side="top" sideOffset={4}>
                    <button
                      type="button"
                      aria-disabled={day.isFuture}
                      aria-label={t('settings.usage.heatmap.ariaDate', { date: dateFormatter.format(day.date) })}
                      onClick={() => {
                        if (!day.isFuture) {
                          onSelectDate(day.key)
                        }
                      }}
                      className={cn(
                        'size-3 rounded-[3px] border border-transparent transition-colors',
                        intensityClassNames[intensity],
                        day.isFuture && 'cursor-default opacity-30',
                        !day.isFuture && 'hover:border-primary/70',
                        selectedDate === day.key && 'border-primary ring-2 ring-primary/30'
                      )}
                    />
                  </NormalTooltip>
                )
              })}
        </div>
      </div>
    </div>
  )
}
