import './UsageSettings.css'
import { ChartColumn, ChartLine, ChartPie, Download, type LucideIcon } from 'lucide-react'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  Button,
  ButtonGroup,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EmptyState,
  SegmentedControl,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton
} from '@cherrystudio/ui'
import { usePersistCache } from '@data/hooks/useCache'
import { useDataChange } from '@renderer/data/hooks/useDataApi'
import { useProviders } from '@renderer/hooks/useProvider'
import { exportService } from '@renderer/services/ExportService'
import { toast } from '@renderer/services/toast'
import { formatCompactNumber } from '@renderer/utils/number'
import { cn } from '@renderer/utils/style'
import type {
  AiUsageRecordGroupIdentity,
  AiUsageRecordListSortBy,
  AiUsageRecordStatsBucket
} from '@shared/data/api/schemas/aiUsageRecords'
import { CURRENCY, type Currency } from '@shared/data/types/model'

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
  ROLLUP_KEYS,
  ROLLUP_LABEL_KEYS,
  TOP_COUNT_KEYS,
  type UsageChartType,
  type UsageTopCount,
  WINDOW_KEYS,
  WINDOW_LABEL_KEYS
} from './usageAnalytics'
import { formatCost, parseDateKey } from './usageDisplay'
import { UsageDistributionChart } from './UsageDistributionChart'
import { UsageEntriesTable } from './UsageEntriesTable'
import {
  buildUsageExportFileStem,
  buildUsageWorkbookBytes,
  fetchAllUsageEntries,
  type UsageExportContext,
  UsageExportError,
  type UsageRecordExportResolvers,
  type UsageWorkbookLabels
} from './usageExport'
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
  timeFormatter,
  onReadinessChange
}: {
  range: BoundedTimeRange
  currency: Currency | undefined
  getProviderInfo: (id: string, snapshotName?: string | null) => { id: string; name: string }
  dateFormatter: Intl.DateTimeFormat
  timeFormatter: Intl.DateTimeFormat
  onReadinessChange: (ready: boolean, error: boolean) => void
}) {
  const [sortBy, setSortBy] = usePersistCache('settings.usage.entry_sort_by')
  const [sortOrder, setSortOrder] = usePersistCache('settings.usage.entry_sort_order')
  const { entries, total, isLoading, isRefreshing, hasNext, loadNext, entriesReady, entriesError } =
    useUsageEntriesData({
      windowRange: range,
      currency,
      sortBy,
      sortOrder
    })
  useEffect(() => {
    onReadinessChange(entriesReady, entriesError)
    return () => onReadinessChange(false, false)
  }, [entriesReady, entriesError, onReadinessChange])
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
  const [rollup, setRollup] = usePersistCache('settings.usage.rollup')
  const [topCount, setTopCount] = usePersistCache('settings.usage.top_count')
  const [persistedCurrency, setSelectedCurrency] = usePersistCache('settings.usage.currency')
  const [sortBy] = usePersistCache('settings.usage.entry_sort_by')
  const [sortOrder] = usePersistCache('settings.usage.entry_sort_order')
  const [heatmapMetric] = usePersistCache('settings.usage.heatmap_metric')
  const captureRef = useRef<HTMLDivElement>(null)
  const mountedRef = useRef(true)
  const revisionRef = useRef(0)
  const inFlightRef = useRef(false)
  const entriesReadinessRef = useRef({ ready: false, error: false })
  const [exporting, setExporting] = useState(false)
  const [exportProgress, setExportProgress] = useState<string>()
  const onEntriesReadinessChange = useCallback((ready: boolean, error: boolean) => {
    entriesReadinessRef.current = { ready, error }
  }, [])
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])
  const selectedCurrency = persistedCurrency ?? undefined
  const chartType: UsageChartType =
    selectedChartType === 'pie' ? 'pie' : selectedChartType === 'line' && rollup !== 'total' ? 'line' : 'bar'

  const windowRange = useMemo(() => getWindowRange(windowKey), [windowKey])
  const previousWindowRange = useMemo(() => getPreviousWindowRange(windowKey), [windowKey])

  const { providers } = useProviders()
  const providerMap = useMemo(() => new Map(providers.map((provider) => [provider.id, provider])), [providers])

  const {
    aggregateReady,
    aggregateError,
    costTotals,
    costCurrency,
    timelineBuckets,
    overviewBuckets,
    exploreTimelineRows,
    exploreBuckets,
    exploreOther,
    exploreStatsLoading,
    exploreStatsError,
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

  const aggregateReadinessRef = useRef({ ready: aggregateReady, error: aggregateError })
  aggregateReadinessRef.current = { ready: aggregateReady, error: aggregateError }
  useEffect(() => {
    revisionRef.current += 1
  }, [
    windowKey,
    sortBy,
    sortOrder,
    costCurrency,
    groupBy,
    chartMetric,
    selectedChartType,
    rollup,
    topCount,
    heatmapMetric
  ])
  useDataChange(
    ['/ai-usage-records'],
    useCallback(() => {
      revisionRef.current += 1
    }, [])
  )

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
    chartMetric === 'cost' ? formatCost(value, exploreTotals.costCurrency) : formatCompactNumber(value)

  const handleExport = async (format: 'png' | 'xlsx') => {
    if (inFlightRef.current) return
    inFlightRef.current = true
    setExporting(true)
    setExportProgress(undefined)
    const startRevision = revisionRef.current
    const assertValid = () => {
      if (!mountedRef.current || revisionRef.current !== startRevision) throw new UsageExportError('ABORTED')
    }
    const pngReady = () =>
      aggregateReadinessRef.current.ready &&
      !aggregateReadinessRef.current.error &&
      entriesReadinessRef.current.ready &&
      !entriesReadinessRef.current.error
    const context: UsageExportContext = {
      windowKey,
      query:
        sortBy === 'cost'
          ? { ...windowRange, sortBy: 'cost', sortOrder, costCurrency: costCurrency ?? CURRENCY.USD }
          : { ...windowRange, sortBy, sortOrder },
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      locale: i18n.language,
      exportedAt: new Date().toISOString(),
      display: {
        persistedCurrency,
        costCurrency: costCurrency ?? null,
        groupBy,
        chartMetric,
        chartType,
        rollup,
        topCount,
        heatmapMetric
      }
    }
    const messages = {
      notReady: t('settings.usage.export.notReady'),
      success: t('settings.usage.export.success'),
      imageNotSaved: t('settings.usage.export.imageNotSaved'),
      failed: t('settings.usage.export.failed'),
      imageFailed: t('settings.usage.export.imageFailed'),
      dataChanged: t('settings.usage.export.dataChanged'),
      limitExceeded: t('settings.usage.export.limitExceeded', { count: 1_048_575 }),
      progress: t('settings.usage.export.progress', { replace: { count: '__COUNT__', total: '__TOTAL__' } }),
      excel: t('common.export.excel')
    }
    const modalityLabels = {
      language: t('common.language'),
      embedding: t('models.type.embedding'),
      image: t('models.type.image'),
      rerank: t('models.type.rerank')
    }
    const providerNames = new Map(providers.map(({ id, name }) => [id, name]))
    const resolvers: UsageRecordExportResolvers = {
      providerName: (id, snapshot) => (snapshot ?? providerNames.get(id) ?? id) || '-',
      modelDisplay: (id) => displayModelId(id) || '-',
      modalityLabel: (modality) => modalityLabels[modality],
      sourceLabel: (entry) => (entry.sourceId ? entry.sourceName || entry.sourceId : modalityLabels[entry.modality])
    }
    const labels: UsageWorkbookLabels = {
      usageSheetName: 'Usage',
      metadataSheetName: 'Metadata',
      columns: [
        t('settings.usage.table.model'),
        t('settings.usage.export.columns.provider'),
        t('settings.usage.table.source'),
        t('settings.usage.table.date'),
        t('settings.usage.table.tokens'),
        t('settings.usage.table.cost'),
        t('settings.usage.currency'),
        t('settings.usage.table.ttft'),
        t('settings.usage.table.tps'),
        t('settings.usage.export.columns.recordId'),
        t('settings.usage.export.columns.recordKind'),
        t('settings.usage.export.columns.requestCount'),
        t('settings.usage.export.columns.providerId'),
        t('settings.usage.export.columns.modelId'),
        t('settings.usage.export.columns.sourceType'),
        t('settings.usage.export.columns.sourceId'),
        t('settings.usage.export.columns.modality'),
        t('settings.usage.export.columns.inputTokens'),
        t('settings.usage.export.columns.outputTokens'),
        t('settings.usage.export.columns.reasoningTokens'),
        t('settings.usage.export.columns.noCacheTokens'),
        t('settings.usage.export.columns.cacheReadTokens'),
        t('settings.usage.export.columns.cacheWriteTokens'),
        t('settings.usage.export.columns.imageCount'),
        t('settings.usage.export.columns.completionMs'),
        t('settings.usage.export.columns.thinkingMs'),
        t('settings.usage.export.columns.costSource'),
        t('settings.usage.export.columns.apiKeyId'),
        t('settings.usage.export.columns.apiKeyLabel'),
        t('settings.usage.export.columns.apiKeyMasked'),
        t('settings.usage.export.columns.apiKeyAttribution'),
        t('settings.usage.export.columns.authMethod')
      ],
      metadata: [
        {
          label: t('settings.usage.export.metadata.window'),
          value: `${windowKey} / ${t(WINDOW_LABEL_KEYS[windowKey])}`
        },
        {
          label: t('settings.usage.export.metadata.from'),
          value: `${windowRange.from} / ${new Date(windowRange.from).toISOString()}`
        },
        {
          label: t('settings.usage.export.metadata.to'),
          value: `${windowRange.to} / ${new Date(windowRange.to).toISOString()}`
        },
        { label: t('settings.usage.export.metadata.timezone'), value: context.timezone },
        { label: t('settings.usage.export.metadata.exportedAt'), value: context.exportedAt },
        { label: t('settings.usage.export.metadata.locale'), value: context.locale },
        { label: t('settings.usage.export.metadata.viewSettings'), value: JSON.stringify(context.display) },
        { label: t('selector.common.sort_label'), value: `${sortBy} / ${sortOrder}` },
        { label: t('settings.usage.export.metadata.recordQuery'), value: JSON.stringify(context.query) },
        { label: t('settings.usage.export.metadata.recordCount'), value: '' },
        {
          label: t('settings.usage.export.metadata.numberPolicy'),
          value: t('settings.usage.export.metadata.numberPolicyValue')
        }
      ]
    }
    try {
      const stem = buildUsageExportFileStem(context, windowRange, new Date(context.exportedAt))
      if (format === 'png') {
        if (!pngReady()) {
          toast.warning(messages.notReady)
          return
        }
        const deadline = performance.now() + 1500
        while (captureRef.current?.querySelector('[data-usage-export-chart-pending]') && performance.now() < deadline) {
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
          assertValid()
        }
        if (!pngReady() || captureRef.current?.querySelector('[data-usage-export-chart-pending]')) {
          toast.warning(messages.notReady)
          return
        }
        const dataUrl = await exportService.captureScrollableAsDataUrl(captureRef)
        assertValid()
        if (!pngReady()) {
          toast.warning(messages.notReady)
          return
        }
        if (!dataUrl) throw new Error(messages.imageFailed)
        const saved = await window.api.file.saveImage(stem, dataUrl)
        if (saved) toast.success(messages.success)
        else toast.info(messages.imageNotSaved)
      } else {
        const { entries, total } = await fetchAllUsageEntries(context.query, assertValid, (count, total) => {
          if (mountedRef.current)
            setExportProgress(messages.progress.replace('__COUNT__', String(count)).replace('__TOTAL__', String(total)))
        })
        assertValid()
        setExportProgress(undefined)
        const workbookLabels = {
          ...labels,
          metadata: labels.metadata.map((row, index) =>
            index === 9 ? { ...row, value: `${entries.length} / ${total}` } : row
          )
        }
        const bytes = await buildUsageWorkbookBytes(entries, context, workbookLabels, resolvers)
        assertValid()
        const path = await window.api.file.save(`${stem}.xlsx`, bytes, {
          filters: [{ name: messages.excel, extensions: ['xlsx'] }]
        })
        if (typeof path === 'string') toast.success(messages.success)
      }
    } catch (error) {
      if (!mountedRef.current) return
      if (format === 'png' && error instanceof UsageExportError && error.code === 'ABORTED') {
        toast.warning(messages.notReady)
      } else {
        const description =
          error instanceof UsageExportError
            ? error.code === 'DATA_CHANGED'
              ? messages.dataChanged
              : error.code === 'LIMIT_EXCEEDED'
                ? messages.limitExceeded
                : messages.failed
            : format === 'png'
              ? messages.imageFailed
              : messages.failed
        toast.error({ title: messages.failed, description })
      }
    } finally {
      inFlightRef.current = false
      if (mountedRef.current) {
        setExporting(false)
        setExportProgress(undefined)
      }
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <UsageResponsiveShell captureRef={captureRef}>
        <div
          id="setting-usage-overview"
          className="flex min-w-0 @[640px]/usage:flex-row flex-col @[640px]/usage:items-start @[640px]/usage:justify-between gap-3">
          <div className="min-w-0">
            <UsageSectionTitle>{t('settings.usage.overview.title')}</UsageSectionTitle>
            <p className="mt-1 text-muted-foreground text-sm">
              {t('settings.usage.summary', {
                window: t(WINDOW_LABEL_KEYS[windowKey]),
                tokens: formatCompactNumber(totalTokens),
                requests: formatCompactNumber(totalRequests)
              })}
            </p>
            <div data-usage-export-only className="text-muted-foreground text-xs">
              {t('settings.usage.export.range', {
                from: entryDateFormatter.format(windowRange.from),
                to: entryDateFormatter.format(windowRange.to),
                timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
              })}
            </div>
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
            <div data-usage-export-action className="flex items-center gap-2">
              <DropdownMenu>
                <DropdownMenuTrigger asChild disabled={exporting}>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={exporting}
                    aria-label={t('settings.usage.export.title')}>
                    <Download />
                    {t(exporting ? 'settings.usage.export.inProgress' : 'settings.usage.export.title')}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => void handleExport('png')}>
                    {t('settings.usage.export.png')}
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => void handleExport('xlsx')}>
                    {t('settings.usage.export.xlsx')}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              {exportProgress && (
                <span className="text-xs" aria-live="polite">
                  {exportProgress}
                </span>
              )}
            </div>
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
                {exploreStatsError ? (
                  <span className="ml-1 text-muted-foreground">· {t('common.error')}</span>
                ) : exploreStatsLoading ? (
                  <Skeleton className="ml-1 h-3 w-12" />
                ) : (
                  <span className="ml-1 text-muted-foreground">· {formatChartValue(totalExploreMetric)}</span>
                )}
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
                          disabled={rollup === 'total' && option.value === 'line'}
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
                exploreBuckets={exploreBuckets}
                exploreOther={exploreOther}
                exploreTotals={exploreTotals}
                exploreStatsLoading={exploreStatsLoading}
                exploreStatsError={exploreStatsError}
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
              onReadinessChange={onEntriesReadinessChange}
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
