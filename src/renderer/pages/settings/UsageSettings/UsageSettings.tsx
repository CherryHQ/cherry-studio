import { Button, EmptyState, Popover, PopoverContent, PopoverTrigger, SegmentedControl } from '@cherrystudio/ui'
import { useProviders } from '@renderer/hooks/useProvider'
import { formatCompactNumber } from '@renderer/utils/number'
import { cn } from '@renderer/utils/style'
import type {
  AiUsageRecordGroupIdentity,
  AiUsageRecordListSortBy,
  AiUsageRecordSortOrder,
  AiUsageRecordStatsBucket
} from '@shared/data/api/schemas/aiUsageRecord'
import type { Currency } from '@shared/data/types/model'
import { ChevronDown, SlidersHorizontal, X } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
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
  type GroupByKey,
  METRIC_KEYS,
  METRIC_LABEL_KEYS,
  PERIOD_CHART_TYPES,
  rangeFromDateKey,
  ROLLUP_KEYS,
  ROLLUP_LABEL_KEYS,
  TOP_COUNT_KEYS,
  TOTAL_CHART_TYPES,
  type UsageChartType,
  type UsageMetricKey,
  type UsageRollupKey,
  WINDOW_KEYS,
  WINDOW_LABEL_KEYS,
  type WindowKey
} from './usageAnalytics'
import { formatCost, parseDateKey } from './usageDisplay'
import { UsageDistributionChart } from './UsageDistributionChart'
import { UsageEntriesTable } from './UsageEntriesTable'
import UsageHeatmap, { type UsageHeatmapMetric } from './UsageHeatmap'
import {
  InsightCell,
  MetricCell,
  MetricStripSkeleton,
  UsageControlRow,
  UsageModelLabel,
  UsageProviderLabel,
  UsageResponsiveShell,
  UsageSection,
  UsageSectionHeader,
  UsageSourceLabel
} from './UsageSettingsPrimitives'
import { useUsageData } from './useUsageData'

type UsageApiKeyStatsBucket = Extract<AiUsageRecordStatsBucket, { groupBy: 'apiKey' }>
type UsageApiKeyDisplay = Pick<
  UsageApiKeyStatsBucket,
  'apiKeyId' | 'apiKeyLabel' | 'apiKeyMasked' | 'apiKeyAttribution' | 'authMethod'
>

function UsageSettings() {
  const { t, i18n } = useTranslation()
  const [windowKey, setWindowKey] = useState<WindowKey>('30d')
  const [groupBy, setGroupBy] = useState<GroupByKey>('provider')
  const [chartMetric, setChartMetric] = useState<UsageMetricKey>('tokens')
  const [selectedChartType, setSelectedChartType] = useState<UsageChartType>('bar')
  const [rollup, setRollup] = useState<UsageRollupKey>('daily')
  const [topCount, setTopCount] = useState<number>(10)
  const [selectedDate, setSelectedDate] = useState<string | undefined>()
  const [selectedCurrency, setSelectedCurrency] = useState<Currency | undefined>()
  const [heatmapMetric, setHeatmapMetric] = useState<UsageHeatmapMetric>('tokens')
  const [entrySortBy, setEntrySortBy] = useState<AiUsageRecordListSortBy>('createdAt')
  const [entrySortOrder, setEntrySortOrder] = useState<AiUsageRecordSortOrder>('desc')

  const windowRange = useMemo(() => getWindowRange(windowKey), [windowKey])
  const previousWindowRange = useMemo(() => getPreviousWindowRange(windowKey), [windowKey])
  const selectedRange = useMemo(() => (selectedDate ? rangeFromDateKey(selectedDate) : undefined), [selectedDate])
  const activeRange = selectedRange ?? windowRange

  const { providers } = useProviders()
  const providerMap = useMemo(() => new Map(providers.map((provider) => [provider.id, provider])), [providers])

  const {
    costTotals,
    costCurrency,
    timelineBuckets,
    overviewBuckets,
    exploreBuckets,
    exploreTimelineRows,
    overviewTotals,
    previousOverviewTotals,
    exploreTotals,
    exploreOther,
    timelineLoading,
    overviewLoading,
    exploreStatsLoading,
    exploreTimelineLoading,
    entries,
    entryTotal,
    entriesLoading,
    entriesRefreshing,
    hasNextEntryPage,
    loadNextEntryPage
  } = useUsageData({
    windowRange,
    previousWindowRange,
    activeRange,
    groupBy,
    chartMetric,
    rollup,
    topCount,
    selectedCurrency,
    entrySortBy,
    entrySortOrder
  })

  const activeDateKeys = useMemo(
    () => timelineBuckets.filter((bucket) => bucket.entryCount > 0).map((bucket) => bucket.date),
    [timelineBuckets]
  )
  const totalTokens = overviewTotals.totalTokens
  const totalEntries = overviewTotals.entryCount
  const previousTotalTokens = previousOverviewTotals.totalTokens
  const previousTotalEntries = previousOverviewTotals.entryCount
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
  const currencyOptions = useMemo(
    () => costTotals.map((item) => ({ value: item.currency, label: item.currency })),
    [costTotals]
  )
  const rollupOptions = useMemo(
    () =>
      ROLLUP_KEYS.map((value) => ({
        value,
        label: t(ROLLUP_LABEL_KEYS[value])
      })),
    [t]
  )
  const topCountOptions = useMemo(
    () => TOP_COUNT_KEYS.map((value) => ({ value: String(value), label: String(value) })),
    []
  )
  // A chart type the current rollup cannot draw falls back during render instead
  // of being reset by an effect, so switching rollup back restores the choice.
  const availableChartTypes: readonly UsageChartType[] = rollup === 'total' ? TOTAL_CHART_TYPES : PERIOD_CHART_TYPES
  const chartType = availableChartTypes.includes(selectedChartType) ? selectedChartType : availableChartTypes[0]
  const chartTypeOptions = useMemo(
    () =>
      availableChartTypes.map((value) => ({
        value,
        label: t(CHART_TYPE_LABEL_KEYS[value])
      })),
    [availableChartTypes, t]
  )

  const selectedDateLabel = selectedDate ? dateFormatter.format(parseDateKey(selectedDate)) : undefined
  const analysisSummary = [
    t(GROUP_BY_LABEL_KEYS[groupBy]),
    t(METRIC_LABEL_KEYS[chartMetric]),
    t(ROLLUP_LABEL_KEYS[rollup]),
    t(CHART_TYPE_LABEL_KEYS[chartType])
  ].join(' / ')
  const hasUsage = totalEntries > 0 || timelineBuckets.some((bucket) => bucket.entryCount > 0)
  // Explore refetches (group-by / heatmap day) must not blank the window-scoped cards;
  // the distribution chart renders its own skeleton.
  const isInitialLoading = timelineLoading || overviewLoading
  const totalExploreMetric = getMetricValue(exploreTotals, chartMetric)

  const getProviderInfo = (id: string, snapshotName?: string | null) => {
    const provider = providerMap.get(id)
    return { id, name: snapshotName ?? provider?.name ?? id }
  }
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

  const handleEntrySort = (sortBy: AiUsageRecordListSortBy) => {
    setEntrySortOrder((currentOrder) => (entrySortBy === sortBy && currentOrder === 'desc' ? 'asc' : 'desc'))
    setEntrySortBy(sortBy)
  }

  const renderBucketLabel = (bucket: AiUsageRecordGroupIdentity) => {
    const label = getBucketLabel(bucket)

    if (groupBy === 'model') {
      return (
        <UsageModelLabel modelId={bucket.modelId} providerId={bucket.providerId ?? ''}>
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
      <UsageProviderLabel provider={getProviderInfo(bucket.providerId ?? '', bucket.providerName)}>
        {label}
      </UsageProviderLabel>
    )
  }
  const formatChartValue = (value: number) =>
    chartMetric === 'cost' ? formatCost(value, costCurrency) : formatCompactNumber(value)

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
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              {currencyOptions.length > 1 && (
                <div className="-mx-1 max-w-[calc(100%+0.5rem)] overflow-x-auto px-1">
                  <SegmentedControl
                    aria-label={t('settings.usage.currency')}
                    options={currencyOptions}
                    value={costCurrency}
                    onValueChange={setSelectedCurrency}
                    size="sm"
                  />
                </div>
              )}
              <div className="-mx-1 max-w-[calc(100%+0.5rem)] overflow-x-auto px-1">
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
            </div>
          </UsageSectionHeader>

          {isInitialLoading ? (
            <MetricStripSkeleton />
          ) : (
            <div className="grid min-w-0 @[820px]/usage:grid-cols-4 grid-cols-1 @[820px]/usage:divide-x divide-y @[820px]/usage:divide-y-0 divide-border border-border border-y">
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

          {!isInitialLoading && hasUsage && (
            <div className="grid min-w-0 @[820px]/usage:grid-cols-4 grid-cols-1 @[820px]/usage:divide-x divide-y @[820px]/usage:divide-y-0 divide-border border-border border-b">
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
                helper={t('settings.usage.tooltip.requests', { count: totalEntries })}
              />
            </div>
          )}

          {hasUsage && (
            <UsageHeatmap
              buckets={timelineBuckets}
              selectedDate={selectedDate}
              metric={heatmapMetric}
              onMetricChange={setHeatmapMetric}
              onSelectDate={(date) => setSelectedDate((current) => (current === date ? undefined : date))}
              costCurrency={costCurrency}
              isLoading={timelineLoading}
              range={windowRange}
            />
          )}

          {!hasUsage && !isInitialLoading && (
            <EmptyState
              compact
              preset="no-result"
              title={t('settings.usage.empty.title')}
              description={t('settings.usage.empty.description')}
              className="rounded-lg bg-muted/30"
            />
          )}
        </UsageSection>

        <UsageSection variant="plain" className={cn(!hasUsage && 'hidden')}>
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
                        <UsageControlRow label={t('settings.usage.explore.groupBy')}>
                          <SegmentedControl
                            options={groupByOptions}
                            value={groupBy}
                            onValueChange={setGroupBy}
                            size="sm"
                          />
                        </UsageControlRow>
                        <UsageControlRow label={t('settings.usage.explore.metric')}>
                          <SegmentedControl
                            options={metricOptions}
                            value={chartMetric}
                            onValueChange={setChartMetric}
                            size="sm"
                          />
                        </UsageControlRow>
                        <UsageControlRow label={t('settings.usage.explore.rollup')}>
                          <SegmentedControl
                            options={rollupOptions}
                            value={rollup}
                            onValueChange={setRollup}
                            size="sm"
                          />
                        </UsageControlRow>
                        <UsageControlRow label={t('settings.usage.explore.top')}>
                          <SegmentedControl
                            options={topCountOptions}
                            value={String(topCount)}
                            onValueChange={(value) => setTopCount(Number(value))}
                            size="sm"
                          />
                        </UsageControlRow>
                        <UsageControlRow label={t('settings.usage.explore.chart')}>
                          <SegmentedControl
                            options={chartTypeOptions}
                            value={chartType}
                            onValueChange={setSelectedChartType}
                            size="sm"
                          />
                        </UsageControlRow>
                      </div>
                    </PopoverContent>
                  </Popover>
                </div>
              </div>
              <UsageDistributionChart
                activeRange={activeRange}
                timelineBuckets={timelineBuckets}
                exploreBuckets={exploreBuckets}
                exploreTimelineRows={exploreTimelineRows}
                exploreTotals={exploreTotals}
                exploreOther={exploreOther}
                rollup={rollup}
                chartMetric={chartMetric}
                chartType={chartType}
                topCount={topCount}
                costCurrency={costCurrency}
                exploreStatsLoading={exploreStatsLoading}
                exploreTimelineLoading={exploreTimelineLoading}
                dateFormatter={dateFormatter}
                monthFormatter={monthFormatter}
                formatShare={formatShare}
                getBucketLabel={getBucketLabel}
                renderBucketLabel={renderBucketLabel}
              />
            </div>

            <UsageEntriesTable
              entries={entries}
              entryTotal={entryTotal}
              isLoading={entriesLoading}
              isRefreshing={entriesRefreshing}
              hasNextPage={hasNextEntryPage}
              sortBy={entrySortBy}
              sortOrder={entrySortOrder}
              onSort={handleEntrySort}
              onLoadNext={loadNextEntryPage}
              getProviderInfo={getProviderInfo}
              getApiKeyLabel={getApiKeyLabel}
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
