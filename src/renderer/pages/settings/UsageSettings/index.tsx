import {
  Avatar,
  AvatarFallback,
  Button,
  EmptyState,
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
  Popover,
  PopoverContent,
  PopoverTrigger,
  SegmentedControl,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@cherrystudio/ui'
import EmojiIcon from '@renderer/components/EmojiIcon'
import { usePaginatedQuery, useQuery } from '@renderer/data/hooks/useDataApi'
import { useProviders } from '@renderer/hooks/useProvider'
import { getModelLogo } from '@renderer/utils/model'
import { formatCompactNumber } from '@renderer/utils/number'
import { cn } from '@renderer/utils/style'
import type {
  UsageLedgerListSortBy,
  UsageLedgerSortDirection,
  UsageLedgerStatsBucket,
  UsageLedgerTimelineBucket
} from '@shared/data/api/schemas/usageLedger'
import type { UsageLedgerModality } from '@shared/data/types/usageLedger'
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  SlidersHorizontal,
  X
} from 'lucide-react'
import type { ReactNode } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingsContentColumn } from '..'
import { ProviderAvatar } from '../ProviderSettings/components/ProviderAvatar'
import UsageHeatmap, { type UsageHeatmapMetric } from './UsageHeatmap'

const DAY_MS = 24 * 60 * 60 * 1000
const DEFAULT_COST_CURRENCY = 'USD'
const ENTRY_PAGE_SIZE = 25

const WINDOW_KEYS = ['30d', '90d', '365d', 'all'] as const
const GROUP_BY_KEYS = ['provider', 'model', 'apiKey', 'source'] as const
const METRIC_KEYS = ['tokens', 'requests', 'cost'] as const
const CHART_TYPE_KEYS = ['stack', 'bar', 'line', 'pie'] as const
const DISTRIBUTION_SEGMENT_LIMIT = 8
const CHART_COLORS = [
  'var(--color-lime-500)',
  'var(--color-fuchsia-500)',
  'var(--color-amber-500)',
  'var(--color-emerald-500)',
  'var(--color-sky-500)',
  'var(--color-orange-500)',
  'var(--color-violet-500)',
  'var(--color-slate-400)',
  'var(--color-rose-500)'
] as const

type WindowKey = (typeof WINDOW_KEYS)[number]
type GroupByKey = (typeof GROUP_BY_KEYS)[number]
type UsageMetricKey = (typeof METRIC_KEYS)[number]
type UsageChartType = (typeof CHART_TYPE_KEYS)[number]
type UsageApiKeyDisplay = Pick<
  UsageLedgerStatsBucket,
  'apiKeyId' | 'apiKeyLabel' | 'apiKeyMasked' | 'apiKeyAttribution'
>

const EMPTY_TIMELINE_BUCKETS: UsageLedgerTimelineBucket[] = []
const EMPTY_STATS_BUCKETS: UsageLedgerStatsBucket[] = []

const WINDOW_LABEL_KEYS: Record<WindowKey, string> = {
  '30d': 'settings.usage.window.30d',
  '90d': 'settings.usage.window.90d',
  '365d': 'settings.usage.window.365d',
  all: 'settings.usage.window.all'
}

const GROUP_BY_LABEL_KEYS: Record<GroupByKey, string> = {
  provider: 'settings.usage.groupBy.provider',
  model: 'settings.usage.groupBy.model',
  apiKey: 'settings.usage.groupBy.apiKey',
  source: 'settings.usage.groupBy.source'
}

const METRIC_LABEL_KEYS: Record<UsageMetricKey, string> = {
  tokens: 'settings.usage.metric.tokens',
  requests: 'settings.usage.metric.requests',
  cost: 'settings.usage.metric.cost'
}

const CHART_TYPE_LABEL_KEYS: Record<UsageChartType, string> = {
  stack: 'settings.usage.chart.stack',
  bar: 'settings.usage.chart.bar',
  line: 'settings.usage.chart.line',
  pie: 'settings.usage.chart.pie'
}

const MODALITY_LABEL_KEYS: Record<UsageLedgerModality, string> = {
  language: 'settings.usage.modality.language',
  embedding: 'settings.usage.modality.embedding',
  image: 'settings.usage.modality.image'
}

interface TimeRange {
  from?: number
  to?: number
}

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

function endOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999)
}

function parseDateKey(value: string): Date {
  const [year, month, day] = value.split('-').map(Number)

  return new Date(year, month - 1, day)
}

function toDateKey(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')

  return `${year}-${month}-${day}`
}

function getWindowDays(windowKey: WindowKey): number | undefined {
  if (windowKey === 'all') {
    return undefined
  }

  return windowKey === '30d' ? 30 : windowKey === '90d' ? 90 : 365
}

function getWindowRange(windowKey: WindowKey): TimeRange {
  if (windowKey === 'all') {
    return {}
  }

  const days = getWindowDays(windowKey) ?? 0
  const today = startOfLocalDay(new Date())
  const from = new Date(today)
  from.setDate(today.getDate() - days + 1)

  return {
    from: from.getTime(),
    to: endOfLocalDay(today).getTime()
  }
}

function getPreviousWindowRange(windowKey: WindowKey): TimeRange | undefined {
  const days = getWindowDays(windowKey)
  if (!days) {
    return undefined
  }

  const currentRange = getWindowRange(windowKey)
  if (currentRange.from === undefined) {
    return undefined
  }

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

function rangeFromDateKey(value: string): TimeRange {
  const date = parseDateKey(value)

  return {
    from: startOfLocalDay(date).getTime(),
    to: endOfLocalDay(date).getTime()
  }
}

function formatCost(value: number, currency: string | null | undefined): string {
  const normalizedCurrency = currency?.toUpperCase() ?? DEFAULT_COST_CURRENCY
  const symbol = normalizedCurrency === 'CNY' ? '¥' : '$'
  const fractionDigits = value > 0 && value < 1 ? 4 : 2

  return `${symbol}${value.toFixed(fractionDigits)}`
}

function displayModelId(modelId: string | null | undefined): string {
  if (!modelId) {
    return ''
  }

  const separatorIndex = modelId.indexOf('::')

  return separatorIndex >= 0 ? modelId.slice(separatorIndex + 2) : modelId
}

function UsageProviderLabel({
  provider,
  children,
  size = 18,
  className
}: {
  provider: { id: string; name: string }
  children?: ReactNode
  size?: number
  className?: string
}) {
  return (
    <span className={cn('inline-flex min-w-0 items-center gap-2', className)}>
      <ProviderAvatar provider={provider} size={size} className="shrink-0" />
      <span className="min-w-0 break-words">{children ?? provider.name}</span>
    </span>
  )
}

function UsageModelAvatar({
  modelId,
  providerId,
  size = 18
}: {
  modelId: string | null | undefined
  providerId: string
  size?: number
}) {
  const modelName = displayModelId(modelId)
  const Icon = modelId ? getModelLogo({ id: modelId, name: modelName || modelId, providerId }, providerId) : undefined

  if (Icon) {
    return <Icon.Avatar size={size} className="shrink-0" />
  }

  return (
    <Avatar className="shrink-0" style={{ width: size, height: size }}>
      <AvatarFallback className="bg-muted font-medium text-[10px] text-foreground-muted">
        {(modelName || providerId || '?').slice(0, 1).toUpperCase()}
      </AvatarFallback>
    </Avatar>
  )
}

function UsageModelLabel({
  modelId,
  providerId,
  children,
  size = 18,
  className
}: {
  modelId: string | null | undefined
  providerId: string
  children: ReactNode
  size?: number
  className?: string
}) {
  return (
    <span className={cn('inline-flex min-w-0 items-center gap-2', className)}>
      <UsageModelAvatar modelId={modelId} providerId={providerId} size={size} />
      <span className="min-w-0 break-words">{children}</span>
    </span>
  )
}

function UsageSourceLabel({
  sourceType,
  sourceIcon,
  children,
  size = 18,
  className
}: {
  sourceType: UsageLedgerStatsBucket['sourceType']
  sourceIcon?: string | null
  children: ReactNode
  size?: number
  className?: string
}) {
  const fallback = sourceType === 'agent' ? 'G' : sourceType === 'assistant' ? 'A' : '?'

  return (
    <span className={cn('inline-flex min-w-0 items-center gap-2', className)}>
      {sourceIcon ? (
        <EmojiIcon emoji={sourceIcon} size={size} fontSize={Math.max(10, Math.round(size * 0.58))} />
      ) : (
        <Avatar className="shrink-0" style={{ width: size, height: size }}>
          <AvatarFallback className="bg-muted font-medium text-[10px] text-foreground-muted">{fallback}</AvatarFallback>
        </Avatar>
      )}
      <span className="min-w-0 break-words">{children}</span>
    </span>
  )
}

function UsageDistributionHoverCard({
  children,
  label,
  metric,
  share,
  tokens,
  requests,
  cost,
  costCurrency,
  labels
}: {
  children: ReactNode
  label: ReactNode
  metric: string
  share: string
  tokens: string
  requests: number
  cost: string
  costCurrency?: string | null
  labels: {
    share: string
    tokens: string
    requests: string
    cost: string
  }
}) {
  return (
    <HoverCard>
      <HoverCardTrigger asChild>{children}</HoverCardTrigger>
      <HoverCardContent side="top" align="center" className="w-64 p-0">
        <div className="p-3">
          <div className="flex min-w-0 items-start justify-between gap-3">
            <div className="min-w-0 text-foreground text-sm">{label}</div>
            <div className="shrink-0 rounded-md bg-muted px-2 py-1 font-medium text-foreground text-xs">{metric}</div>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 border-border border-t pt-3">
            <div>
              <div className="text-foreground-muted text-xs">{labels.share}</div>
              <div className="mt-0.5 font-medium text-foreground text-sm">{share}</div>
            </div>
            <div>
              <div className="text-foreground-muted text-xs">{labels.tokens}</div>
              <div className="mt-0.5 font-medium text-foreground text-sm">{tokens}</div>
            </div>
            <div>
              <div className="text-foreground-muted text-xs">{labels.requests}</div>
              <div className="mt-0.5 font-medium text-foreground text-sm">{requests}</div>
            </div>
            <div>
              <div className="text-foreground-muted text-xs">
                {labels.cost}
                {costCurrency ? ` · ${costCurrency}` : ''}
              </div>
              <div className="mt-0.5 font-medium text-foreground text-sm">{cost}</div>
            </div>
          </div>
        </div>
      </HoverCardContent>
    </HoverCard>
  )
}

function getCostTotals(buckets: UsageLedgerStatsBucket[]): { currency: string; total: number }[] {
  const totals = new Map<string, number>()

  for (const bucket of buckets) {
    if (bucket.totalCost <= 0) {
      continue
    }

    const currency = bucket.costCurrency ?? DEFAULT_COST_CURRENCY
    totals.set(currency, (totals.get(currency) ?? 0) + bucket.totalCost)
  }

  return Array.from(totals, ([currency, total]) => ({ currency, total })).sort((a, b) =>
    a.currency.localeCompare(b.currency)
  )
}

function getCacheUsageMetrics(
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

function getBucketKey(bucket: UsageLedgerStatsBucket): string {
  return `${bucket.providerId}-${bucket.sourceType ?? ''}-${bucket.sourceId ?? ''}-${bucket.apiKeyId ?? ''}-${bucket.modelId ?? ''}-${bucket.costCurrency ?? ''}`
}

function getMetricValue(bucket: UsageLedgerStatsBucket, metric: UsageMetricKey): number {
  if (metric === 'requests') {
    return bucket.entryCount
  }

  if (metric === 'cost') {
    return bucket.totalCost
  }

  return bucket.totalTokens
}

function getGenerationTokensPerSecond(entry: {
  outputTokens: number | null
  timeFirstTokenMs: number | null
  timeCompletionMs: number | null
}): number | undefined {
  if (!entry.outputTokens || !entry.timeCompletionMs) {
    return undefined
  }

  const ttftMs = entry.timeFirstTokenMs
  const generationMs =
    ttftMs !== null && ttftMs < entry.timeCompletionMs ? entry.timeCompletionMs - ttftMs : entry.timeCompletionMs

  return generationMs > 0 ? entry.outputTokens / (generationMs / 1000) : undefined
}

function getLongestStreak(dateKeys: string[]): number {
  const sorted = [...dateKeys].sort()
  let longest = 0
  let current = 0
  let previousTime: number | undefined

  for (const key of sorted) {
    const time = startOfLocalDay(parseDateKey(key)).getTime()
    current = previousTime !== undefined && time - previousTime === DAY_MS ? current + 1 : 1
    longest = Math.max(longest, current)
    previousTime = time
  }

  return longest
}

function toQueryRange(range: TimeRange): TimeRange {
  return {
    ...(range.from !== undefined ? { from: range.from } : {}),
    ...(range.to !== undefined ? { to: range.to } : {})
  }
}

function getTimelineSeries(
  buckets: UsageLedgerTimelineBucket[],
  range: TimeRange,
  getValue: (bucket: UsageLedgerTimelineBucket) => number
): number[] {
  const byDate = new Map(buckets.map((bucket) => [bucket.date, getValue(bucket)]))

  if (range.from !== undefined && range.to !== undefined) {
    const values: number[] = []
    const cursor = startOfLocalDay(new Date(range.from))
    const end = endOfLocalDay(new Date(range.to))

    while (cursor.getTime() <= end.getTime()) {
      values.push(byDate.get(toDateKey(cursor)) ?? 0)
      cursor.setDate(cursor.getDate() + 1)
    }

    return values
  }

  return buckets.slice(-64).map(getValue)
}

function getRatioChange(current: number | undefined, previous: number | undefined): number | undefined {
  if (current === undefined || previous === undefined || previous <= 0) {
    return undefined
  }

  return (current - previous) / previous
}

function MetricCell({
  label,
  value,
  helper,
  trendValues,
  delta,
  deltaLabel,
  formatDelta
}: {
  label: string
  value: ReactNode
  helper?: ReactNode
  trendValues: number[]
  delta?: number
  deltaLabel: string
  formatDelta: (value: number) => string
}) {
  return (
    <div className="grid min-h-24 min-w-0 grid-cols-[3rem_minmax(0,1fr)] gap-3 p-3 @[640px]/usage:px-4">
      <MetricSparkline values={trendValues} />
      <div className="flex min-w-0 flex-col justify-between gap-2">
        <div className="text-foreground-muted text-xs">{label}</div>
        <div className="min-w-0 break-words font-semibold text-foreground text-xl leading-6">{value}</div>
        <div className="flex min-w-0 flex-col gap-1">
          <MetricDelta change={delta} label={deltaLabel} formatDelta={formatDelta} />
          {helper && <div className="min-w-0 text-foreground-muted text-xs">{helper}</div>}
        </div>
      </div>
    </div>
  )
}

function MetricStripSkeleton() {
  return (
    <div className="grid min-w-0 @[640px]/usage:grid-cols-4 grid-cols-1 @[640px]/usage:divide-x divide-y @[640px]/usage:divide-y-0 divide-border border-border border-y">
      {Array.from({ length: 4 }, (_, index) => (
        <div key={index} className="p-3 @[640px]/usage:px-4">
          <Skeleton className="h-20 rounded-md" />
        </div>
      ))}
    </div>
  )
}

function MetricSparkline({ values }: { values: number[] }) {
  const recentValues = values.slice(-64)
  const maxValue = Math.max(...recentValues, 0)
  const minValue = Math.min(...recentValues, maxValue)
  const width = 48
  const height = 32
  const xStep = recentValues.length > 1 ? width / (recentValues.length - 1) : width

  if (recentValues.length === 0 || maxValue === 0) {
    return (
      <div className="flex h-full min-h-14 items-center" aria-hidden>
        <div className="h-px w-full bg-border-muted" />
      </div>
    )
  }

  const points = recentValues
    .map((value, index) => {
      const ratio = maxValue === minValue ? 0.5 : (value - minValue) / (maxValue - minValue)
      const x = index * xStep
      const y = height - ratio * (height - 4) - 2

      return `${x},${y}`
    })
    .join(' ')

  return (
    <div className="flex h-full min-h-14 items-center" aria-hidden>
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="h-8 w-full text-primary">
        <polyline
          points={points}
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
        />
      </svg>
    </div>
  )
}

function MetricDelta({
  change,
  label,
  formatDelta
}: {
  change?: number
  label: string
  formatDelta: (value: number) => string
}) {
  if (change === undefined) {
    return null
  }

  return (
    <div className="flex min-w-0 flex-wrap gap-x-1 text-xs">
      <span
        className={cn(
          'font-medium',
          change > 0 ? 'text-success' : change < 0 ? 'text-destructive' : 'text-foreground-muted'
        )}>
        {formatDelta(change)}
      </span>
      <span className="text-foreground-muted">{label}</span>
    </div>
  )
}

function InsightCell({ label, value, helper }: { label: string; value: ReactNode; helper?: ReactNode }) {
  return (
    <div className="min-w-0 p-3 @[640px]/usage:px-4">
      <div className="text-foreground-muted text-xs">{label}</div>
      <div className="mt-1 min-w-0 break-words font-medium text-foreground text-sm">{value}</div>
      {helper && <div className="mt-1 min-w-0 break-words text-foreground-muted text-xs">{helper}</div>}
    </div>
  )
}

function UsageResponsiveShell({ children }: { children: ReactNode }) {
  return (
    <SettingsContentColumn className="min-w-0 overflow-x-hidden" innerClassName="min-w-0 w-full max-w-none">
      <div className="@container/usage flex min-w-0 flex-col gap-4">{children}</div>
    </SettingsContentColumn>
  )
}

function UsageSection({
  children,
  className,
  variant = 'card'
}: {
  children: ReactNode
  className?: string
  variant?: 'card' | 'plain'
}) {
  return (
    <section
      className={cn(
        'flex min-w-0 flex-col gap-4',
        variant === 'card' && 'rounded-lg border border-border bg-background @[640px]/usage:p-4 p-3',
        className
      )}>
      {children}
    </section>
  )
}

function UsageSectionHeader({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-w-0 @[640px]/usage:flex-row flex-col @[640px]/usage:items-start @[640px]/usage:justify-between gap-3">
      {children}
    </div>
  )
}

function UsageSettings() {
  const { t, i18n } = useTranslation()
  const [windowKey, setWindowKey] = useState<WindowKey>('all')
  const [groupBy, setGroupBy] = useState<GroupByKey>('provider')
  const [chartMetric, setChartMetric] = useState<UsageMetricKey>('tokens')
  const [chartType, setChartType] = useState<UsageChartType>('stack')
  const [selectedDate, setSelectedDate] = useState<string | undefined>()
  const [heatmapMetric, setHeatmapMetric] = useState<UsageHeatmapMetric>('tokens')
  const [entrySortBy, setEntrySortBy] = useState<UsageLedgerListSortBy>('createdAt')
  const [entrySortDirection, setEntrySortDirection] = useState<UsageLedgerSortDirection>('desc')

  const windowRange = useMemo(() => getWindowRange(windowKey), [windowKey])
  const previousWindowRange = useMemo(() => getPreviousWindowRange(windowKey), [windowKey])
  const selectedRange = useMemo(() => (selectedDate ? rangeFromDateKey(selectedDate) : undefined), [selectedDate])
  const activeRange = selectedRange ?? windowRange

  const timelineQuery = useMemo(() => toQueryRange(windowRange), [windowRange])
  const overviewStatsQuery = useMemo(() => ({ groupBy: 'model' as const, ...toQueryRange(windowRange) }), [windowRange])
  const previousOverviewStatsQuery = useMemo(
    () => ({
      groupBy: 'model' as const,
      ...(previousWindowRange ? toQueryRange(previousWindowRange) : {})
    }),
    [previousWindowRange]
  )
  const exploreStatsQuery = useMemo(
    () => ({
      groupBy,
      ...toQueryRange(activeRange)
    }),
    [activeRange, groupBy]
  )
  const entriesQuery = useMemo(
    () => ({
      sortBy: entrySortBy,
      sortDirection: entrySortDirection,
      ...toQueryRange(activeRange)
    }),
    [activeRange, entrySortBy, entrySortDirection]
  )

  const { providers } = useProviders()
  const providerMap = useMemo(() => new Map(providers.map((provider) => [provider.id, provider])), [providers])

  const timelineQueryResult = useQuery('/usage-ledger/timeline', { query: timelineQuery })
  const overviewStatsResult = useQuery('/usage-ledger/stats', { query: overviewStatsQuery })
  const previousOverviewStatsResult = useQuery('/usage-ledger/stats', {
    query: previousOverviewStatsQuery,
    enabled: previousWindowRange !== undefined
  })
  const exploreStatsResult = useQuery('/usage-ledger/stats', { query: exploreStatsQuery })
  const {
    items: entries,
    total: entryTotal,
    page: entryPage,
    isLoading: entriesLoading,
    isRefreshing: entriesRefreshing,
    hasNext: hasNextEntryPage,
    hasPrev: hasPreviousEntryPage,
    nextPage: nextEntryPage,
    prevPage: previousEntryPage
  } = usePaginatedQuery('/usage-ledger/entries', {
    query: entriesQuery,
    limit: ENTRY_PAGE_SIZE
  })

  const timelineBuckets = timelineQueryResult.data?.buckets ?? EMPTY_TIMELINE_BUCKETS
  const overviewBuckets = overviewStatsResult.data?.buckets ?? EMPTY_STATS_BUCKETS
  const previousOverviewBuckets = previousOverviewStatsResult.data?.buckets ?? EMPTY_STATS_BUCKETS
  const exploreBuckets = exploreStatsResult.data?.buckets ?? EMPTY_STATS_BUCKETS

  const activeDateKeys = useMemo(
    () => timelineBuckets.filter((bucket) => bucket.entryCount > 0).map((bucket) => bucket.date),
    [timelineBuckets]
  )
  const totalTokens = overviewBuckets.reduce((sum, bucket) => sum + bucket.totalTokens, 0)
  const totalEntries = overviewBuckets.reduce((sum, bucket) => sum + bucket.entryCount, 0)
  const previousTotalTokens = previousOverviewBuckets.reduce((sum, bucket) => sum + bucket.totalTokens, 0)
  const previousTotalEntries = previousOverviewBuckets.reduce((sum, bucket) => sum + bucket.entryCount, 0)
  const costTotals = useMemo(() => getCostTotals(overviewBuckets), [overviewBuckets])
  const previousCostTotals = useMemo(() => getCostTotals(previousOverviewBuckets), [previousOverviewBuckets])
  const canShowCostMetric = costTotals.length === 1
  const heatmapCostCurrency = canShowCostMetric ? costTotals[0].currency : undefined
  const activeDays = activeDateKeys.length
  const longestStreak = useMemo(() => getLongestStreak(activeDateKeys), [activeDateKeys])
  const cacheMetrics = useMemo(() => getCacheUsageMetrics(overviewBuckets), [overviewBuckets])
  const previousCacheMetrics = useMemo(() => getCacheUsageMetrics(previousOverviewBuckets), [previousOverviewBuckets])
  const totalCost = canShowCostMetric ? costTotals[0].total : undefined
  const previousTotalCost =
    totalCost !== undefined &&
    previousCostTotals.length === 1 &&
    previousCostTotals[0].currency === costTotals[0].currency
      ? previousCostTotals[0].total
      : undefined
  const costTrendValues = useMemo(
    () => (canShowCostMetric ? getTimelineSeries(timelineBuckets, windowRange, (bucket) => bucket.totalCost) : []),
    [canShowCostMetric, timelineBuckets, windowRange]
  )
  const requestTrendValues = useMemo(
    () => getTimelineSeries(timelineBuckets, windowRange, (bucket) => bucket.entryCount),
    [timelineBuckets, windowRange]
  )
  const tokenTrendValues = useMemo(
    () => getTimelineSeries(timelineBuckets, windowRange, (bucket) => bucket.totalTokens),
    [timelineBuckets, windowRange]
  )
  const cacheHitRateTrendValues = useMemo(
    () =>
      getTimelineSeries(timelineBuckets, windowRange, (bucket) => {
        const observableTokens = bucket.totalNoCacheTokens + bucket.totalCacheReadTokens + bucket.totalCacheWriteTokens
        return observableTokens > 0 ? bucket.totalCacheReadTokens / observableTokens : 0
      }),
    [timelineBuckets, windowRange]
  )
  const cacheHitRateDelta =
    cacheMetrics.hitRate !== undefined && previousCacheMetrics.hitRate !== undefined
      ? cacheMetrics.hitRate - previousCacheMetrics.hitRate
      : undefined
  const peakDay = useMemo(
    () =>
      timelineBuckets.reduce<(typeof timelineBuckets)[number] | undefined>(
        (best, bucket) => (!best || bucket.totalTokens > best.totalTokens ? bucket : best),
        undefined
      ),
    [timelineBuckets]
  )
  const topModel = useMemo(
    () =>
      overviewBuckets.reduce<UsageLedgerStatsBucket | undefined>(
        (best, bucket) => (!best || bucket.totalTokens > best.totalTokens ? bucket : best),
        undefined
      ),
    [overviewBuckets]
  )

  useEffect(() => {
    if (heatmapMetric === 'cost' && !canShowCostMetric) {
      setHeatmapMetric('tokens')
    }
  }, [canShowCostMetric, heatmapMetric])

  const dateFormatter = useMemo(
    () => new Intl.DateTimeFormat(i18n.language, { year: 'numeric', month: 'short', day: 'numeric' }),
    [i18n.language]
  )
  const percentFormatter = useMemo(
    () =>
      new Intl.NumberFormat(i18n.language, {
        style: 'percent',
        maximumFractionDigits: 1,
        signDisplay: 'exceptZero'
      }),
    [i18n.language]
  )
  const hitRateFormatter = useMemo(
    () =>
      new Intl.NumberFormat(i18n.language, {
        style: 'percent',
        minimumFractionDigits: 1,
        maximumFractionDigits: 1
      }),
    [i18n.language]
  )
  const formatDelta = useCallback((value: number) => percentFormatter.format(value), [percentFormatter])
  const formatShare = useCallback(
    (value: number) => (value > 0 && value < 0.001 ? '<0.1%' : hitRateFormatter.format(value)),
    [hitRateFormatter]
  )
  const entryDateFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(i18n.language, {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
      }),
    [i18n.language]
  )
  const entryTimeFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(i18n.language, {
        hour: '2-digit',
        minute: '2-digit'
      }),
    [i18n.language]
  )

  const windowOptions = useMemo(
    () =>
      WINDOW_KEYS.map((value) => ({
        value,
        label: t(WINDOW_LABEL_KEYS[value])
      })),
    [t]
  )
  const groupByOptions = useMemo(
    () =>
      GROUP_BY_KEYS.map((value) => ({
        value,
        label: t(GROUP_BY_LABEL_KEYS[value])
      })),
    [t]
  )
  const metricOptions = useMemo(
    () =>
      METRIC_KEYS.map((value) => ({
        value,
        label: t(METRIC_LABEL_KEYS[value])
      })),
    [t]
  )
  const chartTypeOptions = useMemo(
    () =>
      CHART_TYPE_KEYS.map((value) => ({
        value,
        label: t(CHART_TYPE_LABEL_KEYS[value])
      })),
    [t]
  )

  const selectedDateLabel = selectedDate ? dateFormatter.format(parseDateKey(selectedDate)) : undefined
  const analysisSummary = `${t(GROUP_BY_LABEL_KEYS[groupBy])} / ${t(METRIC_LABEL_KEYS[chartMetric])} / ${t(
    CHART_TYPE_LABEL_KEYS[chartType]
  )}`
  const hasUsage = totalEntries > 0 || timelineBuckets.some((bucket) => bucket.entryCount > 0)
  const isInitialLoading =
    timelineQueryResult.isLoading || overviewStatsResult.isLoading || exploreStatsResult.isLoading
  const totalExploreTokens = exploreBuckets.reduce((sum, bucket) => sum + bucket.totalTokens, 0)
  const totalExploreEntries = exploreBuckets.reduce((sum, bucket) => sum + bucket.entryCount, 0)
  const totalExploreCost = exploreBuckets.reduce((sum, bucket) => sum + bucket.totalCost, 0)
  const totalExploreMetric = exploreBuckets.reduce((sum, bucket) => sum + getMetricValue(bucket, chartMetric), 0)
  const exploreTopBuckets = useMemo(
    () =>
      [...exploreBuckets]
        .filter((bucket) => getMetricValue(bucket, chartMetric) > 0)
        .sort((a, b) => getMetricValue(b, chartMetric) - getMetricValue(a, chartMetric))
        .slice(0, DISTRIBUTION_SEGMENT_LIMIT),
    [chartMetric, exploreBuckets]
  )
  const displayedExploreTokens = exploreTopBuckets.reduce((sum, bucket) => sum + bucket.totalTokens, 0)
  const displayedExploreEntries = exploreTopBuckets.reduce((sum, bucket) => sum + bucket.entryCount, 0)
  const displayedExploreCost = exploreTopBuckets.reduce((sum, bucket) => sum + bucket.totalCost, 0)
  const displayedExploreMetric = exploreTopBuckets.reduce((sum, bucket) => sum + getMetricValue(bucket, chartMetric), 0)
  const otherExploreTokens = Math.max(0, totalExploreTokens - displayedExploreTokens)
  const otherExploreEntries = Math.max(0, totalExploreEntries - displayedExploreEntries)
  const otherExploreCost = Math.max(0, totalExploreCost - displayedExploreCost)
  const otherExploreMetric = Math.max(0, totalExploreMetric - displayedExploreMetric)
  const maxExploreMetric = Math.max(
    ...exploreTopBuckets.map((bucket) => getMetricValue(bucket, chartMetric)),
    otherExploreMetric,
    0
  )
  const entryTotalPages = Math.max(1, Math.ceil(entryTotal / ENTRY_PAGE_SIZE))

  const getProviderInfo = (id: string, snapshotName?: string | null) => {
    const provider = providerMap.get(id)
    return { id, name: snapshotName ?? provider?.name ?? id }
  }
  const getProviderName = (id: string, snapshotName?: string | null) => getProviderInfo(id, snapshotName).name
  const getApiKeyLabel = (apiKey: UsageApiKeyDisplay): string => {
    if (apiKey.apiKeyAttribution === 'auth') {
      return t('settings.usage.cards.providerAuth')
    }

    if (!apiKey.apiKeyId) {
      return t('settings.usage.cards.unattributedApiKey')
    }

    return apiKey.apiKeyLabel || apiKey.apiKeyMasked || apiKey.apiKeyId
  }
  const getSourceLabel = (bucket: UsageLedgerStatsBucket): string => {
    if (!bucket.sourceType || !bucket.sourceId) {
      return t('settings.usage.cards.unattributedSource')
    }

    return bucket.sourceName || bucket.sourceId
  }
  const getBucketLabel = (bucket: UsageLedgerStatsBucket): string => {
    if (groupBy === 'provider') {
      return getProviderName(bucket.providerId, bucket.providerName)
    }

    if (groupBy === 'model') {
      const modelName = displayModelId(bucket.modelId)
      return modelName || t('settings.usage.cards.none')
    }

    if (groupBy === 'source') {
      return getSourceLabel(bucket)
    }

    return getApiKeyLabel(bucket)
  }

  const getModalityLabel = (modality: UsageLedgerModality) => t(MODALITY_LABEL_KEYS[modality])
  const handleEntrySort = (sortBy: UsageLedgerListSortBy) => {
    setEntrySortDirection((currentDirection) =>
      entrySortBy === sortBy && currentDirection === 'desc' ? 'asc' : 'desc'
    )
    setEntrySortBy(sortBy)
  }
  const getEntryAriaSort = (sortBy: UsageLedgerListSortBy) =>
    entrySortBy === sortBy ? (entrySortDirection === 'asc' ? 'ascending' : 'descending') : 'none'
  const renderEntrySortHeader = (sortBy: UsageLedgerListSortBy, label: string, align: 'left' | 'right' = 'left') => {
    const isActive = entrySortBy === sortBy
    const Icon = isActive ? (entrySortDirection === 'asc' ? ArrowUp : ArrowDown) : ArrowUpDown

    return (
      <Button
        variant="ghost"
        size="sm"
        className={cn(
          '-mx-2 h-7 gap-1.5 px-2 font-medium text-muted-foreground hover:text-foreground',
          align === 'right' && 'ml-auto'
        )}
        onClick={() => handleEntrySort(sortBy)}>
        <span>{label}</span>
        <Icon className="size-3.5" />
      </Button>
    )
  }
  const renderEntryDateTime = (value: string) => {
    const date = new Date(value)

    return (
      <span className="inline-flex min-w-0 flex-wrap gap-x-1">
        <span className="break-words">{entryDateFormatter.format(date)}</span>
        <span className="break-words">{entryTimeFormatter.format(date)}</span>
      </span>
    )
  }

  const renderBucketLabel = (bucket: UsageLedgerStatsBucket) => {
    const label = getBucketLabel(bucket)

    if (groupBy === 'model') {
      return (
        <UsageModelLabel modelId={bucket.modelId} providerId={bucket.providerId}>
          {label}
        </UsageModelLabel>
      )
    }

    if (groupBy === 'source') {
      return (
        <UsageSourceLabel sourceType={bucket.sourceType} sourceIcon={bucket.sourceIcon}>
          {label}
        </UsageSourceLabel>
      )
    }

    return (
      <UsageProviderLabel provider={getProviderInfo(bucket.providerId, bucket.providerName)}>
        {label}
      </UsageProviderLabel>
    )
  }
  const formatChartValue = (value: number, bucket?: UsageLedgerStatsBucket) => {
    if (chartMetric === 'cost') {
      return formatCost(value, bucket?.costCurrency)
    }

    return formatCompactNumber(value)
  }
  const formatMilliseconds = (value: number | null | undefined) => {
    if (value === null || value === undefined) {
      return t('settings.usage.cards.none')
    }

    return value < 1000 ? `${Math.round(value)}ms` : `${(value / 1000).toFixed(1)}s`
  }
  const formatTps = (value: number | undefined) =>
    value === undefined
      ? t('settings.usage.cards.none')
      : t('settings.usage.table.tpsValue', { value: value.toFixed(0) })
  const renderDistributionChart = () => {
    if (exploreStatsResult.isLoading) {
      return (
        <div className="flex flex-col gap-2 p-3">
          {Array.from({ length: 6 }, (_, index) => (
            <Skeleton key={index} className="h-10 rounded-md" />
          ))}
        </div>
      )
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
          requests: bucket.entryCount,
          cost: bucket.totalCost,
          costCurrency: bucket.costCurrency,
          share: totalExploreMetric > 0 ? value / totalExploreMetric : 0,
          color: CHART_COLORS[index % CHART_COLORS.length],
          bucket
        }
      }),
      ...(otherExploreMetric > 0
        ? [
            {
              key: 'other',
              label: t('common.other'),
              plainLabel: t('common.other'),
              value: otherExploreMetric,
              tokens: otherExploreTokens,
              requests: otherExploreEntries,
              cost: otherExploreCost,
              costCurrency: DEFAULT_COST_CURRENCY,
              share: totalExploreMetric > 0 ? otherExploreMetric / totalExploreMetric : 0,
              color: CHART_COLORS[exploreTopBuckets.length % CHART_COLORS.length],
              bucket: undefined
            }
          ]
        : [])
    ]

    if (entries.length === 0) {
      return (
        <EmptyState
          compact
          preset="no-result"
          title={t('settings.usage.explore.noBreakdown')}
          description={t('settings.usage.explore.noBreakdownDescription')}
        />
      )
    }

    const renderHoverCardForEntry = (entry: (typeof entries)[number], children: ReactNode) => (
      <UsageDistributionHoverCard
        key={entry.key}
        label={entry.label}
        metric={formatChartValue(entry.value, entry.bucket)}
        share={formatShare(entry.share)}
        tokens={formatCompactNumber(entry.tokens)}
        requests={entry.requests}
        cost={formatCost(entry.cost, entry.costCurrency)}
        costCurrency={entry.costCurrency}
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
              <circle cx="80" cy="80" r={radius} fill="none" stroke="var(--color-muted)" strokeWidth="22" />
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
                    <title>{`${entry.plainLabel}: ${formatChartValue(entry.value, entry.bucket)} (${formatShare(entry.share)})`}</title>
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
                  <span className="shrink-0 font-medium text-foreground text-xs">
                    {formatChartValue(entry.value, entry.bucket)}
                  </span>
                </div>
              )
            )}
          </div>
        </div>
      )
    }

    if (chartType === 'line') {
      const width = 720
      const height = 220
      const maxValue = Math.max(...entries.map((entry) => entry.value), 0)
      const points = entries.map((entry, index) => {
        const x = entries.length > 1 ? (index / (entries.length - 1)) * width : width / 2
        const y = height - (maxValue > 0 ? (entry.value / maxValue) * (height - 24) : 0) - 12
        return { ...entry, x, y }
      })

      return (
        <div className="min-w-0 p-3">
          <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="h-64 w-full text-primary">
            <polyline
              points={points.map((point) => `${point.x},${point.y}`).join(' ')}
              fill="none"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="3"
            />
            {points.map((point) => (
              <circle key={point.key} cx={point.x} cy={point.y} r="5" fill={point.color}>
                <title>{`${point.plainLabel}: ${formatChartValue(point.value, point.bucket)} (${formatShare(point.share)})`}</title>
              </circle>
            ))}
          </svg>
          <div className="mt-2 grid min-w-0 @[760px]/usage:grid-cols-4 grid-cols-2 gap-2">
            {entries.map((entry) =>
              renderHoverCardForEntry(
                entry,
                <div className="flex min-w-0 items-center gap-2 text-xs">
                  <span className="size-2 rounded-full" style={{ backgroundColor: entry.color }} />
                  <span className="min-w-0 truncate text-foreground-muted">{entry.label}</span>
                </div>
              )
            )}
          </div>
        </div>
      )
    }

    if (chartType === 'bar') {
      return (
        <div
          className="grid min-h-72 min-w-0 items-end gap-3 overflow-x-auto p-3"
          style={{ gridTemplateColumns: `repeat(${entries.length}, minmax(2.5rem, 1fr))` }}>
          {entries.map((entry) => {
            const height = maxExploreMetric > 0 ? Math.max(3, (entry.value / maxExploreMetric) * 100) : 0

            return renderHoverCardForEntry(
              entry,
              <div className="flex min-h-64 min-w-10 flex-col justify-end gap-2">
                <div className="flex h-52 items-end rounded-md bg-muted">
                  <div
                    className="w-full rounded-md transition-[height]"
                    style={{ height: `${height}%`, backgroundColor: entry.color }}
                  />
                </div>
                <div className="truncate text-center text-foreground-muted text-xs">{entry.label}</div>
                <div className="text-center font-medium text-foreground text-xs">
                  {formatChartValue(entry.value, entry.bucket)}
                </div>
              </div>
            )
          })}
        </div>
      )
    }

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
                  flexGrow: Math.max(entry.value, 1),
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
                    {formatChartValue(entry.value, entry.bucket)}
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

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <UsageResponsiveShell>
        <UsageSection>
          <UsageSectionHeader>
            <div className="min-w-0">
              <h2 className="font-semibold text-base text-foreground">{t('settings.usage.overview.title')}</h2>
              <p className="mt-1 text-foreground-muted text-sm">
                {t('settings.usage.summary', {
                  window: t(WINDOW_LABEL_KEYS[windowKey]),
                  tokens: formatCompactNumber(totalTokens),
                  requests: formatCompactNumber(totalEntries)
                })}
              </p>
            </div>
            <div className="-mx-1 max-w-full overflow-x-auto px-1">
              <SegmentedControl
                options={windowOptions}
                value={windowKey}
                onValueChange={(value) => {
                  setWindowKey(value)
                  setSelectedDate(undefined)
                }}
                size="sm"
              />
            </div>
          </UsageSectionHeader>

          {isInitialLoading ? (
            <MetricStripSkeleton />
          ) : (
            <div className="grid min-w-0 @[640px]/usage:grid-cols-4 grid-cols-1 @[640px]/usage:divide-x divide-y @[640px]/usage:divide-y-0 divide-border border-border border-y">
              <MetricCell
                label={t('settings.usage.cards.totalCost')}
                trendValues={costTrendValues}
                delta={getRatioChange(totalCost, previousTotalCost)}
                deltaLabel={t('settings.usage.cards.lastPeriod')}
                formatDelta={formatDelta}
                value={
                  costTotals.length > 0 ? (
                    <div className="flex flex-col gap-1 text-base leading-5">
                      {costTotals.map((item) => (
                        <span key={item.currency}>{formatCost(item.total, item.currency)}</span>
                      ))}
                    </div>
                  ) : (
                    t('settings.usage.cards.none')
                  )
                }
                helper={
                  costTotals.length > 1 ? t('settings.usage.cards.mixedCurrency') : t('settings.usage.cards.costHint')
                }
              />
              <MetricCell
                label={t('settings.usage.cards.totalRequests')}
                trendValues={requestTrendValues}
                delta={getRatioChange(totalEntries, previousTotalEntries)}
                deltaLabel={t('settings.usage.cards.lastPeriod')}
                formatDelta={formatDelta}
                value={formatCompactNumber(totalEntries)}
              />
              <MetricCell
                label={t('settings.usage.cards.totalTokens')}
                trendValues={tokenTrendValues}
                delta={getRatioChange(totalTokens, previousTotalTokens)}
                deltaLabel={t('settings.usage.cards.lastPeriod')}
                formatDelta={formatDelta}
                value={formatCompactNumber(totalTokens)}
              />
              <MetricCell
                label={t('settings.usage.cards.cacheHitRate')}
                trendValues={cacheHitRateTrendValues}
                delta={cacheHitRateDelta}
                deltaLabel={t('settings.usage.cards.lastPeriod')}
                formatDelta={formatDelta}
                value={
                  cacheMetrics.hitRate !== undefined ? (
                    hitRateFormatter.format(cacheMetrics.hitRate)
                  ) : (
                    <span className="text-sm leading-5">{t('settings.usage.cards.cacheStartsWithNewRequests')}</span>
                  )
                }
                helper={
                  cacheMetrics.hitRate !== undefined
                    ? t('settings.usage.cards.cacheObservedTokens', {
                        tokens: formatCompactNumber(cacheMetrics.observableTokens)
                      })
                    : undefined
                }
              />
            </div>
          )}

          <UsageHeatmap
            buckets={timelineBuckets}
            selectedDate={selectedDate}
            metric={heatmapMetric}
            onMetricChange={setHeatmapMetric}
            onSelectDate={(date) => setSelectedDate((current) => (current === date ? undefined : date))}
            costCurrency={heatmapCostCurrency}
            isCostDisabled={!canShowCostMetric}
            isLoading={timelineQueryResult.isLoading}
            range={windowRange}
          />

          {!hasUsage && !isInitialLoading && (
            <div className="rounded-lg border border-border border-dashed">
              <EmptyState
                compact
                preset="no-result"
                title={t('settings.usage.empty.title')}
                description={t('settings.usage.empty.description')}
              />
            </div>
          )}

          {!isInitialLoading && hasUsage && (
            <div className="grid min-w-0 @[640px]/usage:grid-cols-4 grid-cols-1 @[640px]/usage:divide-x divide-y @[640px]/usage:divide-y-0 divide-border border-border border-t">
              <InsightCell
                label={t('settings.usage.cards.activeDays')}
                value={activeDays}
                helper={t('settings.usage.cards.streak', { days: longestStreak })}
              />
              <InsightCell
                label={t('settings.usage.cards.peakDay')}
                value={peakDay ? formatCompactNumber(peakDay.totalTokens) : t('settings.usage.cards.none')}
                helper={peakDay ? dateFormatter.format(parseDateKey(peakDay.date)) : undefined}
              />
              <InsightCell
                label={t('settings.usage.cards.topModel')}
                value={
                  topModel?.modelId ? (
                    <UsageModelLabel modelId={topModel.modelId} providerId={topModel.providerId} size={16}>
                      {displayModelId(topModel.modelId)}
                    </UsageModelLabel>
                  ) : (
                    t('settings.usage.cards.none')
                  )
                }
                helper={topModel ? formatCompactNumber(topModel.totalTokens) : undefined}
              />
              <InsightCell
                label={t('settings.usage.cards.dailyAverage')}
                value={formatCompactNumber(activeDays > 0 ? totalTokens / activeDays : 0)}
                helper={t('settings.usage.tooltip.requests', { count: totalEntries })}
              />
            </div>
          )}
        </UsageSection>

        <UsageSection variant="plain">
          <UsageSectionHeader>
            <div className="min-w-0">
              <h2 className="font-semibold text-base text-foreground">
                {selectedDateLabel
                  ? t('settings.usage.explore.drilldownTitle', { date: selectedDateLabel })
                  : t('settings.usage.explore.title')}
              </h2>
              {selectedDateLabel && (
                <div className="mt-1 flex items-center gap-2 text-foreground-muted text-xs">
                  <span>{t('settings.usage.explore.selectedDate', { date: selectedDateLabel })}</span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-6"
                    aria-label={t('settings.usage.explore.clearDate')}
                    onClick={() => setSelectedDate(undefined)}>
                    <X className="size-3.5" />
                  </Button>
                </div>
              )}
            </div>
          </UsageSectionHeader>

          <div className="flex min-w-0 flex-col gap-4">
            <div className="flex min-w-0 flex-col rounded-lg border border-border bg-background">
              <div className="flex min-w-0 flex-col gap-3 border-border border-b p-3">
                <div className="flex min-w-0 @[760px]/usage:flex-row flex-col @[760px]/usage:items-start @[760px]/usage:justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-medium text-foreground text-sm">{t('settings.usage.explore.analysis')}</div>
                    <div className="mt-1 text-foreground-muted text-xs">
                      {analysisSummary} / {formatChartValue(totalExploreMetric)}
                    </div>
                  </div>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        size="sm"
                        className="max-w-full justify-between gap-2 @[760px]/usage:self-auto self-start">
                        <span className="inline-flex min-w-0 items-center gap-2">
                          <SlidersHorizontal className="size-4 shrink-0" />
                          <span className="min-w-0 truncate">{analysisSummary}</span>
                        </span>
                        <ChevronDown className="size-4 shrink-0 text-foreground-muted" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent align="end" className="w-[calc(100vw-2rem)] max-w-lg p-3">
                      <div className="flex min-w-0 flex-col gap-3">
                        <div className="min-w-0">
                          <div className="mb-1 text-foreground-muted text-xs">
                            {t('settings.usage.explore.groupBy')}
                          </div>
                          <div className="-mx-1 max-w-full overflow-x-auto px-1">
                            <SegmentedControl
                              options={groupByOptions}
                              value={groupBy}
                              onValueChange={setGroupBy}
                              size="sm"
                            />
                          </div>
                        </div>
                        <div className="min-w-0">
                          <div className="mb-1 text-foreground-muted text-xs">{t('settings.usage.explore.metric')}</div>
                          <div className="-mx-1 max-w-full overflow-x-auto px-1">
                            <SegmentedControl
                              options={metricOptions}
                              value={chartMetric}
                              onValueChange={setChartMetric}
                              size="sm"
                            />
                          </div>
                        </div>
                        <div className="min-w-0">
                          <div className="mb-1 text-foreground-muted text-xs">{t('settings.usage.explore.chart')}</div>
                          <div className="-mx-1 max-w-full overflow-x-auto px-1">
                            <SegmentedControl
                              options={chartTypeOptions}
                              value={chartType}
                              onValueChange={setChartType}
                              size="sm"
                            />
                          </div>
                        </div>
                      </div>
                    </PopoverContent>
                  </Popover>
                </div>
              </div>
              {renderDistributionChart()}
            </div>

            <div className="flex min-w-0 flex-col rounded-lg border border-border bg-background">
              <div className="flex min-w-0 items-center justify-between gap-3 border-border border-b p-3">
                <div className="font-medium text-foreground text-sm">{t('settings.usage.explore.entries')}</div>
                <div className="text-foreground-muted text-xs">
                  {t('settings.usage.explore.totalEntries', { count: entryTotal })}
                </div>
              </div>
              <div className="min-w-0 p-3">
                {entriesLoading ? (
                  <div className="flex flex-col gap-2">
                    {Array.from({ length: 6 }, (_, index) => (
                      <Skeleton key={index} className="h-9 rounded-md" />
                    ))}
                  </div>
                ) : entries.length > 0 ? (
                  <>
                    <Table className="min-w-[900px] table-fixed">
                      <colgroup>
                        <col className="w-[32%]" />
                        <col className="w-[22%]" />
                        <col className="w-36" />
                        <col className="w-24" />
                        <col className="w-24" />
                        <col className="w-20" />
                        <col className="w-20" />
                      </colgroup>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{t('settings.usage.table.request')}</TableHead>
                          <TableHead>{t('settings.usage.table.source')}</TableHead>
                          <TableHead aria-sort={getEntryAriaSort('createdAt')}>
                            {renderEntrySortHeader('createdAt', t('settings.usage.table.date'))}
                          </TableHead>
                          <TableHead className="text-right" aria-sort={getEntryAriaSort('totalTokens')}>
                            {renderEntrySortHeader('totalTokens', t('settings.usage.table.tokens'), 'right')}
                          </TableHead>
                          <TableHead className="text-right" aria-sort={getEntryAriaSort('cost')}>
                            {renderEntrySortHeader('cost', t('settings.usage.table.cost'), 'right')}
                          </TableHead>
                          <TableHead className="text-right" aria-sort={getEntryAriaSort('timeFirstTokenMs')}>
                            {renderEntrySortHeader('timeFirstTokenMs', t('settings.usage.table.ttft'), 'right')}
                          </TableHead>
                          <TableHead className="text-right" aria-sort={getEntryAriaSort('tokensPerSecond')}>
                            {renderEntrySortHeader('tokensPerSecond', t('settings.usage.table.tps'), 'right')}
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {entries.map((entry) => {
                          const tps = getGenerationTokensPerSecond(entry)
                          const sourceName = entry.sourceId
                            ? entry.sourceName || entry.sourceId
                            : t('settings.usage.cards.unattributedSource')

                          return (
                            <TableRow key={entry.id}>
                              <TableCell className="min-w-0">
                                <div className="flex min-w-0 items-start gap-2">
                                  <UsageModelAvatar modelId={entry.modelId} providerId={entry.providerId} size={18} />
                                  <div className="min-w-0">
                                    <div className="line-clamp-2 font-medium text-foreground text-sm leading-5">
                                      {displayModelId(entry.modelId) || t('settings.usage.cards.none')}
                                    </div>
                                    <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-foreground-muted text-xs">
                                      <UsageProviderLabel
                                        provider={getProviderInfo(entry.providerId, entry.providerName)}
                                        size={14}
                                        className="max-w-full gap-1.5 [&>span:last-child]:truncate"
                                      />
                                      <span>{getModalityLabel(entry.modality)}</span>
                                    </div>
                                  </div>
                                </div>
                              </TableCell>
                              <TableCell className="min-w-0">
                                <div className="min-w-0">
                                  <div className="min-w-0 truncate text-foreground text-sm">
                                    {entry.sourceId ? (
                                      <UsageSourceLabel
                                        sourceType={entry.sourceType}
                                        sourceIcon={entry.sourceIcon}
                                        size={14}
                                        className="max-w-full gap-1.5 [&>span:last-child]:truncate">
                                        {sourceName}
                                      </UsageSourceLabel>
                                    ) : (
                                      sourceName
                                    )}
                                  </div>
                                  <div className="mt-1 truncate text-foreground-muted text-xs">
                                    {getApiKeyLabel(entry)}
                                  </div>
                                </div>
                              </TableCell>
                              <TableCell className="text-foreground-muted text-xs">
                                {renderEntryDateTime(entry.createdAt)}
                              </TableCell>
                              <TableCell className="text-right font-medium">
                                {formatCompactNumber(entry.totalTokens ?? 0)}
                              </TableCell>
                              <TableCell className="text-right">
                                {entry.cost !== null && entry.cost !== undefined
                                  ? formatCost(entry.cost, entry.costCurrency)
                                  : t('settings.usage.cards.none')}
                              </TableCell>
                              <TableCell className="text-right">{formatMilliseconds(entry.timeFirstTokenMs)}</TableCell>
                              <TableCell className="text-right">{formatTps(tps)}</TableCell>
                            </TableRow>
                          )
                        })}
                      </TableBody>
                    </Table>
                    {entryTotalPages > 1 && (
                      <div className="flex items-center justify-center gap-2 pt-3">
                        <Button
                          variant="outline"
                          size="icon-sm"
                          aria-label={t('common.previous')}
                          disabled={!hasPreviousEntryPage || entriesRefreshing}
                          onClick={previousEntryPage}>
                          <ChevronLeft className="size-4" />
                        </Button>
                        <span className="min-w-12 text-center text-foreground-muted text-xs">
                          {entryPage} / {entryTotalPages}
                        </span>
                        <Button
                          variant="outline"
                          size="icon-sm"
                          aria-label={t('common.next')}
                          disabled={!hasNextEntryPage || entriesRefreshing}
                          onClick={nextEntryPage}>
                          <ChevronRight className="size-4" />
                        </Button>
                      </div>
                    )}
                  </>
                ) : (
                  <EmptyState
                    compact
                    preset="no-result"
                    title={t('settings.usage.explore.noEntries')}
                    description={t('settings.usage.explore.noEntriesDescription')}
                  />
                )}
              </div>
            </div>
          </div>
        </UsageSection>
      </UsageResponsiveShell>
    </div>
  )
}

export default UsageSettings
