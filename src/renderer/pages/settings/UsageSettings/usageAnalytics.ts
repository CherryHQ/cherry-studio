import type {
  AiUsageRecordCostTotal,
  AiUsageRecordDailyCost,
  AiUsageRecordGroupIdentity,
  AiUsageRecordStatsMetrics,
  AiUsageRecordTimelineBucket
} from '@shared/data/api/schemas/aiUsageRecord'
import type { AiUsageRecordModality } from '@shared/data/types/aiUsageRecord'
import type { Currency } from '@shared/data/types/model'
import { CURRENCY } from '@shared/data/types/model'

import { DEFAULT_COST_CURRENCY, parseDateKey, startOfLocalDay, toDateKey } from './usageDisplay'

export const WINDOW_KEYS = ['30d', '90d', '365d'] as const
export const GROUP_BY_KEYS = ['provider', 'model', 'apiKey', 'source'] as const
export const METRIC_KEYS = ['tokens', 'requests', 'cost'] as const
export const CHART_TYPE_KEYS = ['stack', 'pie', 'bar', 'line'] as const
export const ROLLUP_KEYS = ['total', 'daily', 'weekly', 'monthly'] as const
export const TOP_COUNT_KEYS = [5, 10, 20] as const
export const TOTAL_CHART_TYPES = ['stack', 'pie'] as const
export const PERIOD_CHART_TYPES = ['bar', 'line'] as const
export const CHART_COLORS = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)'
] as const

export type WindowKey = (typeof WINDOW_KEYS)[number]
export type GroupByKey = (typeof GROUP_BY_KEYS)[number]
export type UsageMetricKey = (typeof METRIC_KEYS)[number]
export type UsageChartType = (typeof CHART_TYPE_KEYS)[number]
export type UsageRollupKey = (typeof ROLLUP_KEYS)[number]

export const EMPTY_TIMELINE_BUCKETS: AiUsageRecordTimelineBucket[] = []
export const EMPTY_STATS_METRICS: AiUsageRecordStatsMetrics = {
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

export function selectCostTotal(
  costTotals: AiUsageRecordCostTotal[],
  selectedCurrency?: Currency
): AiUsageRecordCostTotal | undefined {
  return (
    costTotals.find((item) => item.currency === selectedCurrency) ??
    costTotals.find((item) => item.currency === CURRENCY.USD) ??
    costTotals[0]
  )
}

export const WINDOW_LABEL_KEYS: Record<WindowKey, string> = {
  '30d': 'settings.usage.window.30d',
  '90d': 'settings.usage.window.90d',
  '365d': 'settings.usage.window.365d'
}

export const GROUP_BY_LABEL_KEYS: Record<GroupByKey, string> = {
  provider: 'settings.usage.groupBy.provider',
  model: 'settings.usage.groupBy.model',
  apiKey: 'settings.usage.groupBy.apiKey',
  source: 'settings.usage.groupBy.source'
}

export const METRIC_LABEL_KEYS: Record<UsageMetricKey, string> = {
  tokens: 'settings.usage.metric.tokens',
  requests: 'settings.usage.metric.requests',
  cost: 'settings.usage.metric.cost'
}

export const CHART_TYPE_LABEL_KEYS: Record<UsageChartType, string> = {
  stack: 'settings.usage.chart.stack',
  bar: 'settings.usage.chart.bar',
  line: 'settings.usage.chart.line',
  pie: 'settings.usage.chart.pie'
}

export const ROLLUP_LABEL_KEYS: Record<UsageRollupKey, string> = {
  total: 'settings.usage.rollup.total',
  daily: 'settings.usage.rollup.daily',
  weekly: 'settings.usage.rollup.weekly',
  monthly: 'settings.usage.rollup.monthly'
}

export const MODALITY_LABEL_KEYS: Record<AiUsageRecordModality, string> = {
  language: 'settings.usage.modality.language',
  embedding: 'settings.usage.modality.embedding',
  image: 'settings.usage.modality.image',
  rerank: 'settings.usage.modality.rerank'
}

export interface TimeRange {
  from?: number
  to?: number
}

export interface BoundedTimeRange {
  from: number
  to: number
}

export function endOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999)
}

function getWindowDays(windowKey: WindowKey): number {
  return windowKey === '30d' ? 30 : windowKey === '90d' ? 90 : 365
}

export function getWindowRange(windowKey: WindowKey): BoundedTimeRange {
  const days = getWindowDays(windowKey)
  const today = startOfLocalDay(new Date())
  const from = new Date(today)
  from.setDate(today.getDate() - days + 1)

  return {
    from: from.getTime(),
    to: endOfLocalDay(today).getTime()
  }
}

export function getPreviousWindowRange(windowKey: WindowKey): BoundedTimeRange {
  const days = getWindowDays(windowKey)
  const currentRange = getWindowRange(windowKey)
  const currentFrom = startOfLocalDay(new Date(currentRange.from))
  const previousFrom = new Date(currentFrom)
  previousFrom.setDate(currentFrom.getDate() - days)
  const previousTo = new Date(currentFrom)
  previousTo.setDate(currentFrom.getDate() - 1)

  return {
    from: startOfLocalDay(previousFrom).getTime(),
    to: endOfLocalDay(previousTo).getTime()
  }
}

export function rangeFromDateKey(value: string): BoundedTimeRange {
  const date = parseDateKey(value)
  return {
    from: startOfLocalDay(date).getTime(),
    to: endOfLocalDay(date).getTime()
  }
}

export function displayModelId(modelId: string | null | undefined): string {
  if (!modelId) return ''
  const separatorIndex = modelId.indexOf('::')
  return separatorIndex >= 0 ? modelId.slice(separatorIndex + 2) : modelId
}

export function applyTimelineCurrency(
  buckets: AiUsageRecordTimelineBucket[],
  dailyCosts: AiUsageRecordDailyCost[],
  currency: Currency | undefined
): AiUsageRecordTimelineBucket[] {
  const costs = new Map(
    dailyCosts.filter((item) => item.currency === currency).map((item) => [item.date, item.total] as const)
  )
  return buckets.map((bucket) => ({
    ...bucket,
    costCurrency: currency ?? null,
    totalCost: costs.get(bucket.date) ?? 0
  }))
}

export function getCacheUsageMetrics(
  buckets: Array<{
    totalNoCacheTokens?: number
    totalCacheReadTokens?: number
    totalCacheWriteTokens?: number
  }>
) {
  const noCacheTokens = buckets.reduce((sum, bucket) => sum + (bucket.totalNoCacheTokens ?? 0), 0)
  const cacheReadTokens = buckets.reduce((sum, bucket) => sum + (bucket.totalCacheReadTokens ?? 0), 0)
  const cacheWriteTokens = buckets.reduce((sum, bucket) => sum + (bucket.totalCacheWriteTokens ?? 0), 0)
  const observableTokens = noCacheTokens + cacheReadTokens + cacheWriteTokens

  return {
    noCacheTokens,
    cacheReadTokens,
    cacheWriteTokens,
    observableTokens,
    hitRate: observableTokens > 0 ? cacheReadTokens / observableTokens : undefined
  }
}

export function getBucketKey(bucket: AiUsageRecordGroupIdentity & { isOther?: true }): string {
  if (bucket.isOther) return 'other'
  const apiKeyIdentity = [bucket.apiKeyId ?? '', bucket.apiKeyAttribution ?? '', bucket.authMethod ?? ''].join(':')
  return `${bucket.providerId ?? ''}-${bucket.sourceType ?? ''}-${bucket.sourceId ?? ''}-${apiKeyIdentity}-${bucket.modelId ?? ''}`
}

export function getMetricValue(
  bucket: { totalTokens: number; totalCost: number; requestCount: number },
  metric: UsageMetricKey
): number {
  if (metric === 'requests') return bucket.requestCount
  if (metric === 'cost') return bucket.totalCost
  return bucket.totalTokens
}

export function getGenerationTokensPerSecond(entry: {
  outputTokens: number | null
  timeFirstTokenMs: number | null
  timeCompletionMs: number | null
}): number | undefined {
  if (!entry.outputTokens || !entry.timeCompletionMs) return undefined
  const ttftMs = entry.timeFirstTokenMs
  const generationMs =
    ttftMs !== null && ttftMs < entry.timeCompletionMs ? entry.timeCompletionMs - ttftMs : entry.timeCompletionMs
  return generationMs > 0 ? entry.outputTokens / (generationMs / 1000) : undefined
}

export function getLongestStreak(dateKeys: string[]): number {
  const sorted = [...dateKeys].sort()
  let longest = 0
  let current = 0
  let previousDate: Date | undefined

  for (const key of sorted) {
    let isConsecutive = false
    if (previousDate !== undefined) {
      const next = new Date(previousDate)
      next.setDate(next.getDate() + 1)
      isConsecutive = toDateKey(next) === key
    }
    current = isConsecutive ? current + 1 : 1
    longest = Math.max(longest, current)
    previousDate = startOfLocalDay(parseDateKey(key))
  }

  return longest
}

export function toQueryRange(range: BoundedTimeRange): BoundedTimeRange {
  return range
}

export function getTimelinePoints(
  buckets: AiUsageRecordTimelineBucket[],
  range: TimeRange,
  getValue: (bucket: AiUsageRecordTimelineBucket) => number
): Array<{ date: string; value: number }> {
  const first = buckets[0]
  const last = buckets[buckets.length - 1]
  const from = range.from ?? (first ? startOfLocalDay(parseDateKey(first.date)).getTime() : undefined)
  const to = range.to ?? (last ? endOfLocalDay(parseDateKey(last.date)).getTime() : undefined)
  if (from === undefined || to === undefined) return []

  const byDate = new Map(buckets.map((bucket) => [bucket.date, getValue(bucket)]))
  const points: Array<{ date: string; value: number }> = []
  const cursor = startOfLocalDay(new Date(from))
  const end = endOfLocalDay(new Date(to))
  while (cursor.getTime() <= end.getTime()) {
    const date = toDateKey(cursor)
    points.push({ date, value: byDate.get(date) ?? 0 })
    cursor.setDate(cursor.getDate() + 1)
  }
  return points
}

export function toPeriodKey(dateKey: string, rollup: UsageRollupKey): string {
  if (rollup === 'monthly') return `${dateKey.slice(0, 7)}-01`
  if (rollup === 'weekly') {
    const date = startOfLocalDay(parseDateKey(dateKey))
    date.setDate(date.getDate() - ((date.getDay() + 6) % 7))
    return toDateKey(date)
  }
  return dateKey
}

export interface UsageChartSeries {
  key: string
  identity?: AiUsageRecordGroupIdentity
  values: number[]
  total: number
}

function getScopedCost(bucket: { costCurrency: Currency | null; totalCost: number }, currency?: Currency): number {
  return currency !== undefined && (bucket.costCurrency ?? DEFAULT_COST_CURRENCY) === currency ? bucket.totalCost : 0
}

export function buildChartSeries(
  buckets: AiUsageRecordTimelineBucket[],
  periodKeys: string[],
  options: { rollup: UsageRollupKey; metric: UsageMetricKey; currency?: Currency; topCount: number }
): UsageChartSeries[] {
  const positions = new Map(periodKeys.map((key, index) => [key, index]))
  const groups = new Map<string, UsageChartSeries>()

  for (const bucket of buckets) {
    const position = positions.get(toPeriodKey(bucket.date, options.rollup))
    if (position === undefined) continue
    const value = getMetricValue(
      {
        totalTokens: bucket.totalTokens,
        totalCost: getScopedCost(bucket, options.currency),
        requestCount: bucket.requestCount
      },
      options.metric
    )
    if (value <= 0) continue

    const key = getBucketKey(bucket)
    let series = groups.get(key)
    if (!series) {
      series = {
        key,
        ...(bucket.isOther ? {} : { identity: { ...bucket } }),
        values: periodKeys.map(() => 0),
        total: 0
      }
      groups.set(key, series)
    }
    series.values[position] += value
    series.total += value
  }

  const serverOther = groups.get('other')
  const ranked = Array.from(groups.values())
    .filter((series) => series.key !== 'other')
    .sort((a, b) => b.total - a.total)
  const other: UsageChartSeries = serverOther ?? { key: 'other', values: periodKeys.map(() => 0), total: 0 }
  for (const series of ranked.slice(options.topCount)) {
    for (const [index, value] of series.values.entries()) other.values[index] += value
    other.total += series.total
  }
  return other.total > 0 ? [...ranked.slice(0, options.topCount), other] : ranked.slice(0, options.topCount)
}

export function getTimelineSeries(
  buckets: AiUsageRecordTimelineBucket[],
  range: TimeRange,
  getValue: (bucket: AiUsageRecordTimelineBucket) => number
): number[] {
  const points = getTimelinePoints(buckets, range, getValue)
  return (range.from !== undefined && range.to !== undefined ? points : points.slice(-64)).map((point) => point.value)
}

export function getRatioChange(current: number | undefined, previous: number | undefined): number | undefined {
  if (current === undefined || previous === undefined || previous <= 0) return undefined
  return (current - previous) / previous
}
