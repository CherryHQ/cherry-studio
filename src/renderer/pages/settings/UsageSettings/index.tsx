import {
  Button,
  EmptyState,
  PageHeader,
  SegmentedControl,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@cherrystudio/ui'
import { useInfiniteFlatItems, useInfiniteQuery, useQuery } from '@renderer/data/hooks/useDataApi'
import { useProviders } from '@renderer/hooks/useProvider'
import { formatCompactNumber } from '@renderer/utils'
import type { UsageLedgerStatsBucket, UsageLedgerTimelineBucket } from '@shared/data/api/schemas/usageLedger'
import type { UsageLedgerModality } from '@shared/data/types/usageLedger'
import { X } from 'lucide-react'
import type { ReactNode } from 'react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingsContentColumn } from '..'
import UsageHeatmap, { type UsageHeatmapMetric } from './UsageHeatmap'

const DAY_MS = 24 * 60 * 60 * 1000
const ALL_PROVIDERS_VALUE = '__all__'
const DEFAULT_COST_CURRENCY = 'USD'
const ENTRY_PAGE_SIZE = 25

const WINDOW_KEYS = ['30d', '90d', '365d', 'all'] as const
const GROUP_BY_KEYS = ['provider', 'model', 'apiKey'] as const

type WindowKey = (typeof WINDOW_KEYS)[number]
type GroupByKey = (typeof GROUP_BY_KEYS)[number]

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
  apiKey: 'settings.usage.groupBy.apiKey'
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

function getWindowRange(windowKey: WindowKey): TimeRange {
  if (windowKey === 'all') {
    return {}
  }

  const days = windowKey === '30d' ? 30 : windowKey === '90d' ? 90 : 365
  const today = startOfLocalDay(new Date())
  const from = new Date(today)
  from.setDate(today.getDate() - days + 1)

  return {
    from: from.getTime(),
    to: endOfLocalDay(today).getTime()
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

function StatCard({ label, value, helper }: { label: string; value: ReactNode; helper?: ReactNode }) {
  return (
    <div className="flex min-h-24 flex-col justify-between gap-3 rounded-lg border border-border/60 bg-card p-4">
      <div className="text-foreground-muted text-xs">{label}</div>
      <div className="min-w-0 break-words font-semibold text-foreground text-xl leading-6">{value}</div>
      {helper && <div className="min-w-0 text-foreground-muted text-xs">{helper}</div>}
    </div>
  )
}

function UsageSettings() {
  const { t, i18n } = useTranslation()
  const [windowKey, setWindowKey] = useState<WindowKey>('30d')
  const [providerId, setProviderId] = useState(ALL_PROVIDERS_VALUE)
  const [groupBy, setGroupBy] = useState<GroupByKey>('provider')
  const [selectedDate, setSelectedDate] = useState<string | undefined>()
  const [heatmapMetric, setHeatmapMetric] = useState<UsageHeatmapMetric>('tokens')

  const windowRange = useMemo(() => getWindowRange(windowKey), [windowKey])
  const selectedRange = useMemo(() => (selectedDate ? rangeFromDateKey(selectedDate) : undefined), [selectedDate])
  const activeRange = selectedRange ?? windowRange

  const timelineQuery = useMemo(() => toQueryRange(windowRange), [windowRange])
  const overviewStatsQuery = useMemo(() => ({ groupBy: 'model' as const, ...toQueryRange(windowRange) }), [windowRange])
  const exploreStatsQuery = useMemo(
    () => ({
      groupBy,
      ...(providerId !== ALL_PROVIDERS_VALUE ? { providerId } : {}),
      ...toQueryRange(activeRange)
    }),
    [activeRange, groupBy, providerId]
  )
  const entriesQuery = useMemo(
    () => ({
      ...(providerId !== ALL_PROVIDERS_VALUE ? { providerId } : {}),
      ...toQueryRange(activeRange)
    }),
    [activeRange, providerId]
  )

  const { providers } = useProviders()
  const providerNameMap = useMemo(() => new Map(providers.map((provider) => [provider.id, provider.name])), [providers])

  const timelineQueryResult = useQuery('/usage-ledger/timeline', { query: timelineQuery })
  const overviewStatsResult = useQuery('/usage-ledger/stats', { query: overviewStatsQuery })
  const exploreStatsResult = useQuery('/usage-ledger/stats', { query: exploreStatsQuery })
  const {
    pages: entryPages,
    isLoading: entriesLoading,
    isRefreshing: entriesRefreshing,
    hasNext: hasMoreEntries,
    loadNext: loadMoreEntries,
    reset: resetEntries
  } = useInfiniteQuery('/usage-ledger/entries', {
    query: entriesQuery,
    limit: ENTRY_PAGE_SIZE
  })
  const entries = useInfiniteFlatItems(entryPages)

  useEffect(() => {
    resetEntries()
  }, [entriesQuery, resetEntries])

  const timelineBuckets = timelineQueryResult.data?.buckets ?? EMPTY_TIMELINE_BUCKETS
  const overviewBuckets = overviewStatsResult.data?.buckets ?? EMPTY_STATS_BUCKETS
  const exploreBuckets = exploreStatsResult.data?.buckets ?? EMPTY_STATS_BUCKETS

  const activeDateKeys = useMemo(
    () => timelineBuckets.filter((bucket) => bucket.entryCount > 0).map((bucket) => bucket.date),
    [timelineBuckets]
  )
  const totalTokens = overviewBuckets.reduce((sum, bucket) => sum + bucket.totalTokens, 0)
  const totalEntries = overviewBuckets.reduce((sum, bucket) => sum + bucket.entryCount, 0)
  const costTotals = useMemo(() => getCostTotals(overviewBuckets), [overviewBuckets])
  const canShowCostMetric = costTotals.length === 1
  const heatmapCostCurrency = canShowCostMetric ? costTotals[0].currency : undefined
  const activeDays = activeDateKeys.length
  const longestStreak = useMemo(() => getLongestStreak(activeDateKeys), [activeDateKeys])
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
  const entryDateFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(i18n.language, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
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

  const selectedDateLabel = selectedDate ? dateFormatter.format(parseDateKey(selectedDate)) : undefined
  const hasUsage = totalEntries > 0 || timelineBuckets.some((bucket) => bucket.entryCount > 0)
  const isInitialLoading =
    timelineQueryResult.isLoading || overviewStatsResult.isLoading || exploreStatsResult.isLoading
  const maxExploreTokens = Math.max(...exploreBuckets.map((bucket) => bucket.totalTokens), 0)
  const entryTotal = entryPages[0]?.total ?? 0

  const getProviderName = (id: string) => providerNameMap.get(id) ?? id
  const getBucketLabel = (bucket: UsageLedgerStatsBucket): string => {
    if (groupBy === 'provider') {
      return getProviderName(bucket.providerId)
    }

    if (groupBy === 'model') {
      const modelName = displayModelId(bucket.modelId)
      return modelName || t('settings.usage.cards.none')
    }

    return bucket.apiKeyLabel || bucket.apiKeyMasked || t('settings.usage.cards.none')
  }

  const getBucketHelper = (bucket: UsageLedgerStatsBucket): string => {
    const pieces = [
      t('settings.usage.tooltip.tokens', { value: formatCompactNumber(bucket.totalTokens) }),
      t('settings.usage.tooltip.requests', { count: bucket.entryCount })
    ]

    if (bucket.totalCost > 0) {
      pieces.push(t('settings.usage.tooltip.cost', { value: formatCost(bucket.totalCost, bucket.costCurrency) }))
    }

    if (groupBy !== 'provider') {
      pieces.push(getProviderName(bucket.providerId))
    }

    return pieces.join(' / ')
  }

  const getModalityLabel = (modality: UsageLedgerModality) => t(MODALITY_LABEL_KEYS[modality])

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title={t('settings.usage.title')} bordered />
      <SettingsContentColumn innerClassName="max-w-5xl">
        <div className="flex flex-col gap-4">
          <section className="flex flex-col gap-4 rounded-lg border border-border/60 bg-background p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="font-semibold text-base text-foreground">{t('settings.usage.overview.title')}</h2>
                <p className="mt-1 text-foreground-muted text-sm">
                  {t('settings.usage.summary', {
                    window: t(WINDOW_LABEL_KEYS[windowKey]),
                    tokens: formatCompactNumber(totalTokens),
                    activeDays,
                    streak: longestStreak
                  })}
                </p>
              </div>
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

            <UsageHeatmap
              buckets={timelineBuckets}
              selectedDate={selectedDate}
              metric={heatmapMetric}
              onMetricChange={setHeatmapMetric}
              onSelectDate={(date) => setSelectedDate((current) => (current === date ? undefined : date))}
              costCurrency={heatmapCostCurrency}
              isCostDisabled={!canShowCostMetric}
              isLoading={timelineQueryResult.isLoading}
            />

            {!hasUsage && !isInitialLoading && (
              <div className="rounded-lg border border-border/60 border-dashed">
                <EmptyState
                  compact
                  preset="no-result"
                  title={t('settings.usage.empty.title')}
                  description={t('settings.usage.empty.description')}
                />
              </div>
            )}
          </section>

          <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {isInitialLoading ? (
              Array.from({ length: 6 }, (_, index) => <Skeleton key={index} className="h-24 rounded-lg" />)
            ) : (
              <>
                <StatCard label={t('settings.usage.cards.totalTokens')} value={formatCompactNumber(totalTokens)} />
                <StatCard
                  label={t('settings.usage.cards.totalCost')}
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
                <StatCard
                  label={t('settings.usage.cards.activeDays')}
                  value={activeDays}
                  helper={t('settings.usage.cards.streak', { days: longestStreak })}
                />
                <StatCard
                  label={t('settings.usage.cards.peakDay')}
                  value={peakDay ? formatCompactNumber(peakDay.totalTokens) : t('settings.usage.cards.none')}
                  helper={peakDay ? dateFormatter.format(parseDateKey(peakDay.date)) : undefined}
                />
                <StatCard
                  label={t('settings.usage.cards.topModel')}
                  value={topModel?.modelId ? displayModelId(topModel.modelId) : t('settings.usage.cards.none')}
                  helper={topModel ? formatCompactNumber(topModel.totalTokens) : undefined}
                />
                <StatCard
                  label={t('settings.usage.cards.dailyAverage')}
                  value={formatCompactNumber(activeDays > 0 ? totalTokens / activeDays : 0)}
                  helper={t('settings.usage.tooltip.requests', { count: totalEntries })}
                />
              </>
            )}
          </section>

          <section className="flex flex-col gap-4 rounded-lg border border-border/60 bg-background p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <h2 className="font-semibold text-base text-foreground">{t('settings.usage.explore.title')}</h2>
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

              <div className="flex flex-wrap items-center gap-2">
                <Select value={providerId} onValueChange={setProviderId}>
                  <SelectTrigger size="sm" className="w-44">
                    <SelectValue placeholder={t('settings.usage.explore.provider')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value={ALL_PROVIDERS_VALUE}>{t('settings.usage.explore.allProviders')}</SelectItem>
                      {providers.map((provider) => (
                        <SelectItem key={provider.id} value={provider.id}>
                          {provider.name}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <SegmentedControl options={groupByOptions} value={groupBy} onValueChange={setGroupBy} size="sm" />
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
              <div className="flex min-h-72 flex-col gap-3 rounded-lg border border-border/60 p-3">
                <div className="font-medium text-foreground text-sm">{t('settings.usage.explore.breakdown')}</div>
                {exploreStatsResult.isLoading ? (
                  <div className="flex flex-col gap-2">
                    {Array.from({ length: 6 }, (_, index) => (
                      <Skeleton key={index} className="h-10 rounded-md" />
                    ))}
                  </div>
                ) : exploreBuckets.length > 0 ? (
                  <div className="flex flex-col gap-3">
                    {exploreBuckets.map((bucket) => {
                      const percent =
                        maxExploreTokens > 0 ? Math.max(4, (bucket.totalTokens / maxExploreTokens) * 100) : 0
                      const key = `${bucket.providerId}-${bucket.apiKeyId ?? ''}-${bucket.modelId ?? ''}-${bucket.costCurrency ?? ''}`

                      return (
                        <div key={key} className="flex flex-col gap-1.5">
                          <div className="flex min-w-0 items-center justify-between gap-3">
                            <div className="min-w-0 truncate text-foreground text-sm">{getBucketLabel(bucket)}</div>
                            <div className="shrink-0 font-medium text-foreground text-xs">
                              {formatCompactNumber(bucket.totalTokens)}
                            </div>
                          </div>
                          <div className="h-2 overflow-hidden rounded-full bg-muted">
                            <div className="h-full rounded-full bg-primary" style={{ width: `${percent}%` }} />
                          </div>
                          <div className="truncate text-foreground-muted text-xs">{getBucketHelper(bucket)}</div>
                        </div>
                      )
                    })}
                  </div>
                ) : (
                  <EmptyState
                    compact
                    preset="no-result"
                    title={t('settings.usage.explore.noBreakdown')}
                    description={t('settings.usage.explore.noBreakdownDescription')}
                  />
                )}
              </div>

              <div className="flex min-h-72 min-w-0 flex-col gap-3 rounded-lg border border-border/60 p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="font-medium text-foreground text-sm">{t('settings.usage.explore.entries')}</div>
                  <div className="text-foreground-muted text-xs">
                    {t('settings.usage.explore.totalEntries', { count: entryTotal })}
                  </div>
                </div>

                {entriesLoading ? (
                  <div className="flex flex-col gap-2">
                    {Array.from({ length: 6 }, (_, index) => (
                      <Skeleton key={index} className="h-9 rounded-md" />
                    ))}
                  </div>
                ) : entries.length > 0 ? (
                  <>
                    <Table className="min-w-[760px] table-fixed text-xs">
                      <TableHeader>
                        <TableRow className="hover:bg-transparent">
                          <TableHead className="w-36">{t('settings.usage.table.date')}</TableHead>
                          <TableHead>{t('settings.usage.table.provider')}</TableHead>
                          <TableHead>{t('settings.usage.table.model')}</TableHead>
                          <TableHead className="w-24">{t('settings.usage.table.modality')}</TableHead>
                          <TableHead className="w-28">{t('settings.usage.table.apiKey')}</TableHead>
                          <TableHead className="w-24 text-right">{t('settings.usage.table.tokens')}</TableHead>
                          <TableHead className="w-24 text-right">{t('settings.usage.table.cost')}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {entries.map((entry) => (
                          <TableRow key={entry.id}>
                            <TableCell className="truncate text-foreground-muted">
                              {entryDateFormatter.format(new Date(entry.createdAt))}
                            </TableCell>
                            <TableCell className="truncate">{getProviderName(entry.providerId)}</TableCell>
                            <TableCell className="truncate">
                              {displayModelId(entry.modelId) || t('settings.usage.cards.none')}
                            </TableCell>
                            <TableCell>{getModalityLabel(entry.modality)}</TableCell>
                            <TableCell className="truncate">
                              {entry.apiKeyLabel || entry.apiKeyMasked || t('settings.usage.cards.none')}
                            </TableCell>
                            <TableCell className="text-right">{formatCompactNumber(entry.totalTokens ?? 0)}</TableCell>
                            <TableCell className="text-right">
                              {entry.cost !== null && entry.cost !== undefined
                                ? formatCost(entry.cost, entry.costCurrency)
                                : t('settings.usage.cards.none')}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                    {hasMoreEntries && (
                      <div className="flex justify-center">
                        <Button variant="outline" size="sm" onClick={loadMoreEntries}>
                          {entriesRefreshing
                            ? t('settings.usage.explore.loading')
                            : t('settings.usage.explore.loadMore')}
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
          </section>
        </div>
      </SettingsContentColumn>
    </div>
  )
}

export default UsageSettings
