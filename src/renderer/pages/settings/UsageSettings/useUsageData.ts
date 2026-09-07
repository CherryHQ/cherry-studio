import { useDataChange, useInfiniteFlatItems, useInfiniteQuery, useQuery } from '@renderer/data/hooks/useDataApi'
import type {
  AiUsageRecordListSortBy,
  AiUsageRecordSortOrder,
  AiUsageRecordStatsBucket
} from '@shared/data/api/schemas/aiUsageRecords'
import { CURRENCY, type Currency } from '@shared/data/types/model'
import { debounce } from 'es-toolkit/compat'
import { useEffect, useMemo, useRef } from 'react'

import {
  applyTimelineCurrency,
  type BoundedTimeRange,
  EMPTY_STATS_METRICS,
  EMPTY_TIMELINE_BUCKETS,
  type GroupByKey,
  selectCostTotal,
  toQueryRange,
  type UsageMetricKey,
  type UsageRollupKey
} from './usageAnalytics'

const ENTRY_PAGE_SIZE = 25
const USAGE_REFRESH_DEBOUNCE_MS = 300
const EMPTY_STATS_BUCKETS: AiUsageRecordStatsBucket[] = []

interface UseUsageDataOptions {
  windowRange: BoundedTimeRange
  previousWindowRange: BoundedTimeRange
  groupBy: GroupByKey
  chartMetric: UsageMetricKey
  rollup: UsageRollupKey
  topCount: number
  selectedCurrency?: Currency
}

export function useUsageData({
  windowRange,
  previousWindowRange,
  groupBy,
  chartMetric,
  rollup,
  topCount,
  selectedCurrency
}: UseUsageDataOptions) {
  const timelineQuery = useMemo(
    () => ({ metric: 'tokens' as const, limit: 1, ...toQueryRange(windowRange) }),
    [windowRange]
  )
  const timelineQueryResult = useQuery('/ai-usage-records/timeline', { query: timelineQuery })
  const costTotals = useMemo(() => timelineQueryResult.data?.costTotals ?? [], [timelineQueryResult.data?.costTotals])
  const activeCostTotal = selectCostTotal(costTotals, selectedCurrency)
  const costCurrency = activeCostTotal?.currency
  const queryCurrency = costCurrency ?? selectedCurrency ?? CURRENCY.USD

  const overviewStatsQuery = useMemo(
    () => ({
      groupBy: 'model' as const,
      metric: 'tokens' as const,
      currency: queryCurrency,
      limit: 1,
      ...toQueryRange(windowRange)
    }),
    [queryCurrency, windowRange]
  )
  const previousOverviewStatsQuery = useMemo(
    () => ({
      groupBy: 'model' as const,
      metric: 'tokens' as const,
      currency: queryCurrency,
      limit: 1,
      ...toQueryRange(previousWindowRange)
    }),
    [previousWindowRange, queryCurrency]
  )
  const exploreQuery = useMemo(
    () => ({
      groupBy,
      metric: chartMetric,
      currency: queryCurrency,
      limit: topCount,
      ...toQueryRange(windowRange)
    }),
    [chartMetric, groupBy, queryCurrency, topCount, windowRange]
  )
  const overviewStatsResult = useQuery('/ai-usage-records/stats', { query: overviewStatsQuery })
  const previousOverviewStatsResult = useQuery('/ai-usage-records/stats', { query: previousOverviewStatsQuery })
  const exploreStatsResult = useQuery('/ai-usage-records/stats', { query: exploreQuery })
  const exploreTimelineResult = useQuery('/ai-usage-records/timeline', {
    query: exploreQuery,
    enabled: rollup !== 'total'
  })
  const refetchTimeline = timelineQueryResult.refetch
  const refetchOverviewStats = overviewStatsResult.refetch
  const refetchPreviousOverviewStats = previousOverviewStatsResult.refetch
  const refetchExploreStats = exploreStatsResult.refetch
  const refetchExploreTimeline = exploreTimelineResult.refetch
  const refreshUsageReadModels = useMemo(
    () =>
      debounce(() => {
        void Promise.all([
          refetchTimeline(),
          refetchOverviewStats(),
          refetchPreviousOverviewStats(),
          refetchExploreStats(),
          refetchExploreTimeline()
        ])
      }, USAGE_REFRESH_DEBOUNCE_MS),
    [refetchExploreStats, refetchExploreTimeline, refetchOverviewStats, refetchPreviousOverviewStats, refetchTimeline]
  )
  useDataChange(['/ai-usage-records', '/ai-usage-records/stats', '/ai-usage-records/timeline'], refreshUsageReadModels)
  useEffect(() => () => refreshUsageReadModels.cancel(), [refreshUsageReadModels])

  const timelineRows = timelineQueryResult.data?.buckets ?? EMPTY_TIMELINE_BUCKETS
  const overviewBuckets = overviewStatsResult.data?.buckets ?? EMPTY_STATS_BUCKETS
  const exploreBuckets = exploreStatsResult.data?.buckets ?? EMPTY_STATS_BUCKETS
  const exploreTimelineRows =
    rollup === 'total' ? EMPTY_TIMELINE_BUCKETS : (exploreTimelineResult.data?.buckets ?? EMPTY_TIMELINE_BUCKETS)
  const timelineBuckets = useMemo(
    () => applyTimelineCurrency(timelineRows, timelineQueryResult.data?.dailyCosts ?? [], costCurrency),
    [costCurrency, timelineQueryResult.data?.dailyCosts, timelineRows]
  )

  return {
    costTotals,
    costCurrency,
    timelineBuckets,
    overviewBuckets,
    exploreBuckets,
    exploreTimelineRows,
    overviewTotals: overviewStatsResult.data?.totals ?? EMPTY_STATS_METRICS,
    previousOverviewTotals: previousOverviewStatsResult.data?.totals ?? EMPTY_STATS_METRICS,
    exploreTotals: exploreStatsResult.data?.totals ?? EMPTY_STATS_METRICS,
    exploreOther: exploreStatsResult.data?.other ?? EMPTY_STATS_METRICS,
    timelineLoading: timelineQueryResult.isLoading && timelineQueryResult.data === undefined,
    overviewLoading: overviewStatsResult.isLoading && overviewStatsResult.data === undefined,
    exploreStatsLoading: exploreStatsResult.isLoading && exploreStatsResult.data === undefined,
    exploreTimelineLoading: exploreTimelineResult.isLoading && exploreTimelineResult.data === undefined
  }
}

interface UseUsageEntriesDataOptions {
  windowRange: BoundedTimeRange
  currency: Currency | undefined
  sortBy: AiUsageRecordListSortBy
  sortOrder: AiUsageRecordSortOrder
}

export function useUsageEntriesData({ windowRange, currency, sortBy, sortOrder }: UseUsageEntriesDataOptions) {
  const queryCurrency = currency ?? CURRENCY.USD
  const entriesQuery = useMemo(
    () => ({
      sortBy,
      sortOrder,
      ...(sortBy === 'cost' ? { costCurrency: queryCurrency } : {}),
      ...toQueryRange(windowRange)
    }),
    [queryCurrency, sortBy, sortOrder, windowRange]
  )
  const { pages, isLoading, isRefreshing, hasNext, loadNext, refresh, reset } = useInfiniteQuery('/ai-usage-records', {
    query: entriesQuery,
    limit: ENTRY_PAGE_SIZE,
    swrOptions: { keepPreviousData: true }
  })
  const entries = useInfiniteFlatItems(pages)
  const total = pages[0]?.total ?? 0

  const resetRef = useRef(reset)
  resetRef.current = reset
  useEffect(() => {
    resetRef.current()
  }, [queryCurrency, sortBy, sortOrder, windowRange.from, windowRange.to])

  const refreshEntries = useMemo(
    () =>
      debounce(() => {
        reset()
        void refresh()
      }, USAGE_REFRESH_DEBOUNCE_MS),
    [refresh, reset]
  )
  useDataChange(['/ai-usage-records'], refreshEntries)
  useEffect(() => () => refreshEntries.cancel(), [refreshEntries])

  return {
    entries,
    total,
    isLoading,
    isRefreshing,
    hasNext,
    loadNext
  }
}
