import { NormalTooltip, SegmentedControl, Skeleton } from '@cherrystudio/ui'
import { formatCompactNumber } from '@renderer/utils/number'
import { cn } from '@renderer/utils/style'
import type { UsageLedgerTimelineBucket } from '@shared/data/api/schemas/usageLedger'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

export type UsageHeatmapMetric = 'tokens' | 'cost'

const DAY_MS = 24 * 60 * 60 * 1000
const MAX_CELL_SIZE = 12
const MIN_CELL_SIZE = 1

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

function startOfLocalWeek(date: Date): Date {
  const day = startOfLocalDay(date)
  day.setDate(day.getDate() - day.getDay())
  return day
}

function endOfLocalWeek(date: Date): Date {
  const day = startOfLocalDay(date)
  day.setDate(day.getDate() + (6 - day.getDay()))
  return day
}

function dateKey(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')

  return `${year}-${month}-${day}`
}

function parseDateKey(value: string): Date {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year, month - 1, day)
}

function buildHeatmapDays(
  buckets: UsageLedgerTimelineBucket[],
  range?: { from?: number; to?: number }
): { date: Date; key: string; isFuture: boolean }[] {
  const today = startOfLocalDay(new Date())
  let firstDay: Date
  let lastDay: Date

  if (range?.from !== undefined) {
    firstDay = startOfLocalDay(new Date(range.from))
    lastDay = startOfLocalDay(new Date(range.to ?? Date.now()))
  } else if (buckets.length > 0) {
    const times = buckets.map((bucket) => parseDateKey(bucket.date).getTime())
    firstDay = new Date(Math.min(...times))
    lastDay = new Date(Math.max(...times))
  } else {
    lastDay = today
    firstDay = new Date(today.getTime() - 29 * DAY_MS)
  }

  const firstWeekDay = startOfLocalWeek(firstDay)
  const lastWeekDay = endOfLocalWeek(lastDay)
  const dayCount = Math.floor((lastWeekDay.getTime() - firstWeekDay.getTime()) / DAY_MS) + 1

  return Array.from({ length: dayCount }, (_, index) => {
    const date = new Date(firstWeekDay.getTime() + index * DAY_MS)
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

function useElementWidth() {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)

  useEffect(() => {
    const element = ref.current
    if (!element) return

    const updateWidth = () => setWidth(element.clientWidth)
    updateWidth()

    if (typeof ResizeObserver === 'undefined') {
      return
    }

    const observer = new ResizeObserver(updateWidth)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  return { ref, width }
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
  range?: { from?: number; to?: number }
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
  isLoading,
  range
}: UsageHeatmapProps) {
  const { t, i18n } = useTranslation()
  const { ref: heatmapRef, width: heatmapWidth } = useElementWidth()

  const days = useMemo(() => buildHeatmapDays(buckets, range), [buckets, range])
  const weeks = useMemo(
    () => Array.from({ length: Math.ceil(days.length / 7) }, (_, index) => days.slice(index * 7, index * 7 + 7)),
    [days]
  )
  const bucketMap = useMemo(() => new Map(buckets.map((bucket) => [bucket.date, bucket])), [buckets])
  const thresholds = useMemo(() => {
    const values = buckets
      .map((bucket) => getBucketValue(bucket, metric))
      .filter((value) => value > 0)
      .sort((a, b) => a - b)

    return [quantile(values, 0.25), quantile(values, 0.5), quantile(values, 0.75)] as [number, number, number]
  }, [buckets, metric])
  const gapSize = useMemo(() => {
    if (heatmapWidth === 0) return 3

    const weekCount = Math.max(weeks.length, 1)
    if (weekCount * (MAX_CELL_SIZE + 3) <= heatmapWidth) return 3
    if (weekCount * (8 + 2) <= heatmapWidth) return 2
    if (weekCount * (4 + 1) <= heatmapWidth) return 1
    return 0
  }, [heatmapWidth, weeks.length])
  const cellSize = useMemo(() => {
    if (heatmapWidth === 0) return MAX_CELL_SIZE

    const weekCount = Math.max(weeks.length, 1)
    const availableWidth = heatmapWidth - (weekCount - 1) * gapSize
    return Math.max(MIN_CELL_SIZE, Math.min(MAX_CELL_SIZE, Math.floor(availableWidth / weekCount)))
  }, [gapSize, heatmapWidth, weeks.length])

  const monthLabels = useMemo(() => {
    const formatter = new Intl.DateTimeFormat(i18n.language, { month: 'short' })
    const minLabelGap = cellSize < 6 ? 8 : cellSize < 9 ? 5 : 3
    let previousVisibleIndex = -Infinity

    return weeks.map((week, weekIndex) => {
      const day = week[0]
      const previous = weekIndex > 0 ? weeks[weekIndex - 1][0] : undefined
      const label = !previous || previous.date.getMonth() !== day.date.getMonth() ? formatter.format(day.date) : ''

      if (!label || weekIndex - previousVisibleIndex < minLabelGap) {
        return ''
      }

      previousVisibleIndex = weekIndex
      return label
    })
  }, [cellSize, i18n.language, weeks])

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
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex min-w-0 flex-col gap-2">
        <div className="min-w-0">
          <div className="font-medium text-foreground text-sm">{t('settings.usage.heatmap.title')}</div>
          {isCostDisabled && (
            <div className="mt-1 text-foreground-muted text-xs">{t('settings.usage.heatmap.costDisabled')}</div>
          )}
        </div>
        <div className="-mx-1 max-w-full overflow-x-auto px-1">
          <SegmentedControl options={metricOptions} value={metric} onValueChange={onMetricChange} size="sm" />
        </div>
      </div>

      <div ref={heatmapRef} className="min-w-0 max-w-full pb-1">
        <div className="flex w-full" style={{ gap: gapSize }}>
          {weeks.map((week, weekIndex) => (
            <div
              key={week[0]?.key ?? weekIndex}
              className="grid shrink-0"
              style={{
                width: cellSize,
                gap: gapSize,
                gridTemplateRows: `16px repeat(7, ${cellSize}px)`
              }}>
              <div className="h-4 overflow-visible whitespace-nowrap pr-3 text-[10px] text-foreground-muted leading-4">
                {monthLabels[weekIndex]}
              </div>

              {isLoading
                ? week.map((day) => (
                    <Skeleton key={day.key} className="rounded-[3px]" style={{ height: cellSize, width: cellSize }} />
                  ))
                : week.map((day) => {
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
                            'rounded-[3px] border border-transparent transition-colors',
                            intensityClassNames[intensity],
                            day.isFuture && 'cursor-default opacity-30',
                            !day.isFuture && 'hover:border-primary/70',
                            selectedDate === day.key && 'border-primary ring-2 ring-primary/30'
                          )}
                          style={{ height: cellSize, width: cellSize }}
                        />
                      </NormalTooltip>
                    )
                  })}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
