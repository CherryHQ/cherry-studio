import { ChartColumn, ChartLine, ChartPie, type LucideIcon } from 'lucide-react'
import { memo, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import {
  Button,
  ButtonGroup,
  EmptyState,
  SegmentedControl,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@cherrystudio/ui'
import { usePersistCache } from '@data/hooks/useCache'
import { useProviders } from '@renderer/hooks/useProvider'
import { formatCompactNumber } from '@renderer/utils/number'
import { cn } from '@renderer/utils/style'
import type {
  AiUsageRecordGroupIdentity,
  AiUsageRecordListSortBy,
  AiUsageRecordStatsBucket
} from '@shared/data/api/schemas/aiUsageRecords'
import type { Currency } from '@shared/data/types/model'

import {
  type BoundedTimeRange,
  CHART_TYPE_KEYS,
  CHART_TYPE_LABEL_KEYS,
  displayModelId,
  getCacheUsageMetrics,
  getLongestStreak,
  getMetricValue,
  getPreviousWindowRange,
  getRatioChange,
  getTimelineSeries,
  getWindowRange,
  GROUP_BY_KEYS,
  GROUP_BY_LABEL_KEYS,
  METRIC_KEYS,
  METRIC_LABEL_KEYS,
  ROLLUP_LABEL_KEYS,
  TOP_COUNT_KEYS,
  TREND_ROLLUP_KEYS,
  type UsageChartType,
  type UsageTopCount,
  WINDOW_KEYS,
  WINDOW_LABEL_KEYS
} from './usageAnalytics'
import { formatCost, parseDateKey } from './usageDisplay'
import { UsageDistributionChart } from './UsageDistributionChart'
import { UsageEntriesTable } from './UsageEntriesTable'
import UsageHeatmap from './UsageHeatmap'
import {
  InsightCell,
  MetricCell,
  MetricStripSkeleton,
  UsageControlRow,
  UsageModelLabel,
  UsagePanel,
  UsagePanelHeader,
  UsageResponsiveShell,
  UsageSection,
  UsageSectionHeader,
  UsageSectionTitle
} from './UsageSettingsPrimitives'
import { useUsageData, useUsageEntriesData } from './useUsageData'

type UsageApiKeyStatsBucket = Extract<AiUsageRecordStatsBucket, { groupBy: 'apiKey' }>
type UsageApiKeyDisplay = Pick<
  UsageApiKeyStatsBucket,
  'apiKeyId' | 'apiKeyLabel' | 'apiKeyMasked' | 'apiKeyAttribution' | 'authMethod'
>

const CHART_TYPE_ICONS: Record<UsageChartType, LucideIcon> = {
  bar: ChartColumn,
  line: ChartLine,
  pie: ChartPie
}

const UsageEntriesSection = memo(function UsageEntriesSection({
  range,
  currency,
  getProviderInfo,
  dateFormatter,
  timeFormatter
}: {
  range: BoundedTimeRange
  currency: Currency | undefined
  getProviderInfo: (id: string, snapshotName?: string | null) => { id: string; name: string }
  dateFormatter: Intl.DateTimeFormat
  timeFormatter: Intl.DateTimeFormat
}) {
  const [sortBy, setSortBy] = usePersistCache('settings.usage.entry_sort_by')
  const [sortOrder, setSortOrder] = usePersistCache('settings.usage.entry_sort_order')
  const { entries, total, isLoading, isRefreshing, hasNext, loadNext } = useUsageEntriesData({
    windowRange: range,
    currency,
    sortBy,
    sortOrder
  })
  const handleSort = (nextSortBy: AiUsageRecordListSortBy) => {
    setSortOrder((currentOrder) => (sortBy === nextSortBy && currentOrder === 'desc' ? 'asc' : 'desc'))
    setSortBy(nextSortBy)
  }

  return (
    <UsageEntriesTable
      entries={entries}
      entryTotal={total}
      isLoading={isLoading}
      isRefreshing={isRefreshing}
      hasNextPage={hasNext}
      sortBy={sortBy}
      sortOrder={sortOrder}
      onSort={handleSort}
      onLoadNext={loadNext}
      getProviderInfo={getProviderInfo}
      dateFormatter={dateFormatter}
      timeFormatter={timeFormatter}
    />
  )
})

function UsageSettings() {
  const { t, i18n } = useTranslation()
  const [windowKey, setWindowKey] = usePersistCache('settings.usage.window')
  const [groupBy, setGroupBy] = usePersistCache('settings.usage.group_by')
  const [chartMetric, setChartMetric] = usePersistCache('settings.usage.chart_metric')
  const [selectedChartType, setSelectedChartType] = usePersistCache('settings.usage.chart_type')
  const [persistedRollup, setRollup] = usePersistCache('settings.usage.rollup')
  const [topCount, setTopCount] = usePersistCache('settings.usage.top_count')
  const [persistedCurrency, setSelectedCurrency] = usePersistCache('settings.usage.currency')
  const selectedCurrency = persistedCurrency ?? undefined
  const chartType: UsageChartType =
    selectedChartType === 'line' || selectedChartType === 'pie' ? selectedChartType : 'bar'
  const rollup = persistedRollup === 'total' ? 'daily' : persistedRollup

  const windowRange = useMemo(() => getWindowRange(windowKey), [windowKey])
  const previousWindowRange = useMemo(() => getPreviousWindowRange(windowKey), [windowKey])

  const { providers } = useProviders()
  const providerMap = useMemo(() => new Map(providers.map((provider) => [provider.id, provider])), [providers])

  const {
    costTotals,
    costCurrency,
    timelineBuckets,
    overviewBuckets,
    exploreTimelineRows,
    overviewTotals,
    previousOverviewTotals,
    exploreTotals,
    timelineLoading,
    overviewLoading,
    exploreTimelineLoading
  } = useUsageData({
    windowRange,
    previousWindowRange,
    groupBy,
    chartMetric,
    rollup,
    topCount,
    selectedCurrency
  })

  const activeDateKeys = useMemo(
    () => timelineBuckets.filter((bucket) => bucket.requestCount > 0).map((bucket) => bucket.date),
    [timelineBuckets]
  )
  const totalTokens = overviewTotals.totalTokens
  const totalRequests = overviewTotals.requestCount
  const previousTotalTokens = previousOverviewTotals.totalTokens
  const previousTotalRequests = previousOverviewTotals.requestCount
  const activeDays = activeDateKeys.length
  const longestStreak = useMemo(() => getLongestStreak(activeDateKeys), [activeDateKeys])
  const cacheMetrics = useMemo(() => getCacheUsageMetrics([overviewTotals]), [overviewTotals])
  const previousCacheMetrics = useMemo(() => getCacheUsageMetrics([previousOverviewTotals]), [previousOverviewTotals])
  const totalCost = costCurrency ? overviewTotals.totalCost : undefined
  const previousTotalCost = costCurrency ? previousOverviewTotals.totalCost : undefined
  const costTrendValues = useMemo(
    () => getTimelineSeries(timelineBuckets, windowRange, (bucket) => bucket.totalCost),
    [timelineBuckets, windowRange]
  )
  const requestTrendValues = useMemo(
    () => getTimelineSeries(timelineBuckets, windowRange, (bucket) => bucket.requestCount),
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
      overviewBuckets
        .filter(
          (bucket): bucket is Extract<AiUsageRecordStatsBucket, { groupBy: 'model' }> => bucket.groupBy === 'model'
        )
        .reduce<Extract<AiUsageRecordStatsBucket, { groupBy: 'model' }> | undefined>(
          (best, bucket) => (!best || bucket.totalTokens > best.totalTokens ? bucket : best),
          undefined
        ),
    [overviewBuckets]
  )

  const dateFormatter = useMemo(
    () => new Intl.DateTimeFormat(i18n.language, { year: 'numeric', month: 'short', day: 'numeric' }),
    [i18n.language]
  )
  const monthFormatter = useMemo(
    () => new Intl.DateTimeFormat(i18n.language, { year: 'numeric', month: 'short' }),
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
  const currencyOptions = useMemo(
    () => costTotals.map((item) => ({ value: item.currency, label: item.currency })),
    [costTotals]
  )
  const rollupOptions = useMemo(
    () =>
      TREND_ROLLUP_KEYS.map((value) => ({
        value,
        label: t(ROLLUP_LABEL_KEYS[value])
      })),
    [t]
  )
  const topCountOptions = useMemo(
    () => TOP_COUNT_KEYS.map((value) => ({ value: String(value), label: String(value) })),
    []
  )
  const chartTypeOptions = useMemo(
    () => CHART_TYPE_KEYS.map((value) => ({ value, label: t(CHART_TYPE_LABEL_KEYS[value]) })),
    [t]
  )

  const hasUsage = totalRequests > 0 || timelineBuckets.some((bucket) => bucket.requestCount > 0)
  // Explore refetches must not blank the window-scoped cards;
  // the distribution chart renders its own skeleton.
  const isInitialLoading = timelineLoading || overviewLoading
  const totalExploreMetric = getMetricValue(exploreTotals, chartMetric)

  const getProviderInfo = useCallback(
    (id: string, snapshotName?: string | null) => {
      const provider = providerMap.get(id)
      return { id, name: snapshotName ?? provider?.name ?? id }
    },
    [providerMap]
  )
  const getProviderName = (id: string, snapshotName?: string | null) => getProviderInfo(id, snapshotName).name
  const getApiKeyLabel = (apiKey: UsageApiKeyDisplay): string => {
    if (apiKey.apiKeyAttribution === 'auth') {
      return apiKey.authMethod
        ? `${t('settings.usage.cards.providerAuth')} · ${apiKey.authMethod}`
        : t('settings.usage.cards.providerAuth')
    }

    if (!apiKey.apiKeyId) {
      return t('settings.usage.cards.unattributedApiKey')
    }

    const keyLabel = apiKey.apiKeyLabel || apiKey.apiKeyMasked || apiKey.apiKeyId
    const attributionLabel =
      apiKey.apiKeyAttribution === 'matched'
        ? t('settings.usage.cards.matchedApiKey')
        : t('settings.usage.cards.explicitApiKey')
    return `${keyLabel} · ${attributionLabel}`
  }
  const getSourceLabel = (bucket: AiUsageRecordGroupIdentity): string => {
    if (!bucket.sourceType || !bucket.sourceId) {
      return t('settings.usage.cards.unattributedSource')
    }

    return bucket.sourceName || bucket.sourceId
  }
  const getBucketLabel = (bucket: AiUsageRecordGroupIdentity): string => {
    if (groupBy === 'provider') {
      return getProviderName(bucket.providerId ?? '', bucket.providerName)
    }

    if (groupBy === 'model') {
      const modelName = displayModelId(bucket.modelId)
      return modelName || t('settings.usage.cards.none')
    }

    if (groupBy === 'source') {
      return getSourceLabel(bucket)
    }

    return getApiKeyLabel({
      apiKeyId: bucket.apiKeyId ?? null,
      apiKeyLabel: bucket.apiKeyLabel ?? null,
      apiKeyMasked: bucket.apiKeyMasked ?? null,
      apiKeyAttribution: bucket.apiKeyAttribution ?? 'unknown',
      authMethod: bucket.authMethod ?? null
    })
  }

  const formatChartValue = (value: number) =>
    chartMetric === 'cost' ? formatCost(value, costCurrency) : formatCompactNumber(value)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <UsageResponsiveShell>
        <div className="flex min-w-0 @[640px]/usage:flex-row flex-col @[640px]/usage:items-start @[640px]/usage:justify-between gap-3">
          <div className="min-w-0">
            <UsageSectionTitle>{t('settings.usage.overview.title')}</UsageSectionTitle>
            <p className="mt-1 text-muted-foreground text-sm">
              {t('settings.usage.summary', {
                window: t(WINDOW_LABEL_KEYS[windowKey]),
                tokens: formatCompactNumber(totalTokens),
                requests: formatCompactNumber(totalRequests)
              })}
            </p>
          </div>
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            {currencyOptions.length > 1 && (
              <SegmentedControl
                aria-label={t('settings.usage.currency')}
                options={currencyOptions}
                value={costCurrency}
                onValueChange={setSelectedCurrency}
                size="sm"
              />
            )}
            <SegmentedControl options={windowOptions} value={windowKey} onValueChange={setWindowKey} size="sm" />
          </div>
        </div>

        <UsageSection>
          <UsagePanel>
            {isInitialLoading ? (
              <MetricStripSkeleton />
            ) : (
              <div
                className={cn(
                  'grid min-w-0 @[560px]/usage:grid-cols-2 @[900px]/usage:grid-cols-4 grid-cols-1 gap-px bg-border',
                  hasUsage && 'border-border border-b'
                )}>
                <MetricCell
                  label={t('settings.usage.cards.totalCost')}
                  trendValues={costTrendValues}
                  delta={getRatioChange(totalCost, previousTotalCost)}
                  deltaLabel={t('settings.usage.cards.lastPeriod')}
                  formatDelta={formatDelta}
                  value={totalCost !== undefined ? formatCost(totalCost, costCurrency) : t('settings.usage.cards.none')}
                />
                <MetricCell
                  label={t('settings.usage.cards.totalRequests')}
                  trendValues={requestTrendValues}
                  delta={getRatioChange(totalRequests, previousTotalRequests)}
                  deltaLabel={t('settings.usage.cards.lastPeriod')}
                  formatDelta={formatDelta}
                  value={formatCompactNumber(totalRequests)}
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

            {!isInitialLoading && hasUsage && (
              <div className="grid min-w-0 @[560px]/usage:grid-cols-2 @[900px]/usage:grid-cols-4 grid-cols-1 gap-px bg-border">
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
                      <UsageModelLabel modelId={topModel.modelId} providerId={topModel.providerId ?? ''} size={16}>
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
                  helper={t('settings.usage.tooltip.requests', { count: totalRequests })}
                />
              </div>
            )}
          </UsagePanel>

          {hasUsage && (
            <UsagePanel>
              <UsageHeatmap
                buckets={timelineBuckets}
                costCurrency={costCurrency}
                isLoading={timelineLoading}
                range={windowRange}
              />
            </UsagePanel>
          )}

          {!hasUsage && !isInitialLoading && (
            <UsagePanel className="@[640px]/usage:p-4 p-3">
              <EmptyState
                compact
                preset="no-result"
                title={t('settings.usage.empty.title')}
                description={t('settings.usage.empty.description')}
              />
            </UsagePanel>
          )}
        </UsageSection>

        <UsageSection className={cn(!hasUsage && 'hidden')}>
          <UsageSectionHeader>
            <div className="min-w-0">
              <UsageSectionTitle>{t('settings.usage.explore.analysis')}</UsageSectionTitle>
              <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1 text-foreground-tertiary text-xs">
                <span>{t(WINDOW_LABEL_KEYS[windowKey])}</span>
                <span className="ml-1 text-muted-foreground">· {formatChartValue(totalExploreMetric)}</span>
              </div>
            </div>
          </UsageSectionHeader>

          <div className="flex min-w-0 flex-col gap-3">
            <UsagePanel>
              <UsagePanelHeader className="flex min-w-0 flex-wrap items-end gap-3">
                <UsageControlRow className="w-40" label={t('settings.usage.explore.groupBy')}>
                  <Select value={groupBy} onValueChange={(value) => setGroupBy(value as typeof groupBy)}>
                    <SelectTrigger size="sm" className="w-full" aria-label={t('settings.usage.explore.groupBy')}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {groupByOptions.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </UsageControlRow>
                <UsageControlRow className="w-32" label={t('settings.usage.explore.metric')}>
                  <Select value={chartMetric} onValueChange={(value) => setChartMetric(value as typeof chartMetric)}>
                    <SelectTrigger size="sm" className="w-full" aria-label={t('settings.usage.explore.metric')}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {metricOptions.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </UsageControlRow>
                <UsageControlRow className="w-24" label={t('settings.usage.explore.top')}>
                  <Select
                    value={String(topCount)}
                    onValueChange={(value) => setTopCount(Number(value) as UsageTopCount)}>
                    <SelectTrigger size="sm" className="w-full" aria-label={t('settings.usage.explore.top')}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {topCountOptions.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </UsageControlRow>
                <UsageControlRow className="@[760px]/usage:ml-auto" label={t('settings.usage.explore.chart')}>
                  <ButtonGroup attached={false} aria-label={t('settings.usage.explore.chart')}>
                    {chartTypeOptions.map((option) => {
                      const Icon = CHART_TYPE_ICONS[option.value]
                      const isActive = chartType === option.value

                      return (
                        <Button
                          key={option.value}
                          type="button"
                          variant={isActive ? 'secondary' : 'ghost'}
                          size="sm"
                          aria-pressed={isActive}
                          onClick={() => setSelectedChartType(option.value)}>
                          <Icon className="size-3.5" />
                          {option.label}
                        </Button>
                      )
                    })}
                  </ButtonGroup>
                </UsageControlRow>
                <UsageControlRow label={t('settings.usage.explore.granularity')}>
                  <SegmentedControl options={rollupOptions} value={rollup} onValueChange={setRollup} size="sm" />
                </UsageControlRow>
              </UsagePanelHeader>
              <UsageDistributionChart
                range={windowRange}
                timelineBuckets={timelineBuckets}
                exploreTimelineRows={exploreTimelineRows}
                rollup={rollup}
                chartMetric={chartMetric}
                chartType={chartType}
                topCount={topCount}
                costCurrency={costCurrency}
                exploreTimelineLoading={exploreTimelineLoading}
                dateFormatter={dateFormatter}
                monthFormatter={monthFormatter}
                getBucketLabel={getBucketLabel}
              />
            </UsagePanel>

            <UsageEntriesSection
              range={windowRange}
              currency={costCurrency}
              getProviderInfo={getProviderInfo}
              dateFormatter={entryDateFormatter}
              timeFormatter={entryTimeFormatter}
            />
          </div>
        </UsageSection>
      </UsageResponsiveShell>
    </div>
  )
}

export default UsageSettings
