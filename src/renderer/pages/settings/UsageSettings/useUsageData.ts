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
  activeRange: BoundedTimeRange
  groupBy: GroupByKey
  chartMetric: UsageMetricKey
  rollup: UsageRollupKey
  topCount: number
  selectedCurrency?: Currency
  entrySortBy: AiUsageRecordListSortBy
  entrySortOrder: AiUsageRecordSortOrder
}

export function useUsageData({
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
}: UseUsageDataOptions) {
  const timelineQuery = useMemo(
    () => ({ metric: 'tokens' as const, limit: 1, ...toQueryRange(windowRange) }),
    [windowRange]
  )
  const timelineQueryResult = useQuery('/ai-usage-records/timeline', { query: timelineQuery })
  const costTotals = useMemo(() => timelineQueryResult.data?.costTotals ?? [], [timelineQueryResult.data?.costTotals])
  const activeCostTotal = selectCostTotal(costTotals, selectedCurrency)
  const costCurrency = activeCostTotal?.currency
  const queryCurrency = costCurrency ?? CURRENCY.USD

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
      ...toQueryRange(activeRange)
    }),
    [activeRange, chartMetric, groupBy, queryCurrency, topCount]
  )
  const entriesQuery = useMemo(
    () => ({
      sortBy: entrySortBy,
      sortOrder: entrySortOrder,
      ...(entrySortBy === 'cost' ? { costCurrency: queryCurrency } : {}),
      ...toQueryRange(activeRange)
    }),
    [activeRange, entrySortBy, entrySortOrder, queryCurrency]
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
  const {
    pages: entryPages,
    isLoading: entriesLoading,
    isRefreshing: entriesRefreshing,
    hasNext: hasNextEntryPage,
    loadNext: loadNextEntryPage,
    refresh: refreshEntryPages,
    reset: resetEntryPages
  } = useInfiniteQuery('/ai-usage-records', {
    query: entriesQuery,
    limit: ENTRY_PAGE_SIZE,
    swrOptions: { keepPreviousData: false }
  })
  const entries = useInfiniteFlatItems(entryPages)
  const entryTotal = entryPages[0]?.total ?? 0

  const resetEntryPagesRef = useRef(resetEntryPages)
  resetEntryPagesRef.current = resetEntryPages
  useEffect(() => {
    resetEntryPagesRef.current()
  }, [activeRange.from, activeRange.to, entrySortBy, entrySortOrder, queryCurrency])

  const refreshUsageReadModels = useMemo(
    () =>
      debounce(() => {
        const refreshEntries = () => {
          resetEntryPages()
          return refreshEntryPages()
        }
        void Promise.all([
          refetchTimeline(),
          refetchOverviewStats(),
          refetchPreviousOverviewStats(),
          refetchExploreStats(),
          refetchExploreTimeline(),
          refreshEntries()
        ])
      }, USAGE_REFRESH_DEBOUNCE_MS),
    [
      refetchExploreStats,
      refetchExploreTimeline,
      refetchOverviewStats,
      refetchPreviousOverviewStats,
      refetchTimeline,
      refreshEntryPages,
      resetEntryPages
    ]
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
    timelineLoading: timelineQueryResult.isLoading,
    overviewLoading: overviewStatsResult.isLoading,
    exploreStatsLoading: exploreStatsResult.isLoading,
    exploreTimelineLoading: exploreTimelineResult.isLoading,
    entries,
    entryTotal,
    entriesLoading,
    entriesRefreshing,
    hasNextEntryPage,
    loadNextEntryPage
  }
}
