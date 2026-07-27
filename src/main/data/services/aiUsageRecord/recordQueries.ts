import { application } from '@application'
import { aiUsageRecordTable } from '@data/db/schemas/aiUsageRecord'
import type {
  AiUsageRecordGroupBy,
  AiUsageRecordListResponse,
  AiUsageRecordMetric,
  AiUsageRecordStatsBucket,
  AiUsageRecordStatsMetrics,
  AiUsageRecordStatsQuery,
  AiUsageRecordStatsResponse,
  AiUsageRecordTimelineBucket,
  AiUsageRecordTimelineQuery,
  AiUsageRecordTimelineResponse
} from '@shared/data/api/schemas/aiUsageRecord'
import type { Currency } from '@shared/data/types/model'
import { and, asc, desc, eq, gte, isNotNull, isNull, lte, or, type SQL, sql } from 'drizzle-orm'
import type { AnySQLiteColumn } from 'drizzle-orm/sqlite-core'

import { asNumericKey, decodeListCursor, encodeCursor, keysetOrdering } from '../utils/keysetCursor'
import {
  type AiUsageRecordListServiceQuery,
  decodeMetricCursor,
  encodeMetricCursor,
  getListSortValue,
  metricCursorWhere
} from './recordCursor'
import {
  groupIdentityColumns,
  groupIdentitySelect,
  rowToRecord,
  toGroupIdentity,
  toStatsGroupIdentity
} from './recordMappers'

function rangeConditions(query: { from: number; to: number }): SQL[] {
  return [gte(aiUsageRecordTable.createdAt, query.from), lte(aiUsageRecordTable.createdAt, query.to)]
}

function scopedCostSum(currency: Currency | undefined): SQL<number> {
  return currency
    ? sql<number>`coalesce(sum(CASE WHEN ${aiUsageRecordTable.costCurrency} = ${currency} THEN ${aiUsageRecordTable.cost} ELSE 0 END), 0)`
    : sql<number>`0`
}

function metricsSelect(currency: Currency | undefined) {
  return {
    totalCost: scopedCostSum(currency),
    totalInputTokens: sql<number>`coalesce(sum(${aiUsageRecordTable.inputTokens}), 0)`,
    totalOutputTokens: sql<number>`coalesce(sum(${aiUsageRecordTable.outputTokens}), 0)`,
    totalTokens: sql<number>`coalesce(sum(${aiUsageRecordTable.totalTokens}), 0)`,
    totalNoCacheTokens: sql<number>`coalesce(sum(${aiUsageRecordTable.noCacheTokens}), 0)`,
    totalCacheReadTokens: sql<number>`coalesce(sum(${aiUsageRecordTable.cacheReadTokens}), 0)`,
    totalCacheWriteTokens: sql<number>`coalesce(sum(${aiUsageRecordTable.cacheWriteTokens}), 0)`,
    entryCount: sql<number>`count(*)`
  }
}

type MetricsRow = {
  [K in keyof ReturnType<typeof metricsSelect>]: number
}

function toMetrics(row: MetricsRow, currency: Currency | undefined): AiUsageRecordStatsMetrics {
  return {
    costCurrency: currency ?? null,
    totalCost: row.totalCost,
    totalInputTokens: row.totalInputTokens,
    totalOutputTokens: row.totalOutputTokens,
    totalTokens: row.totalTokens,
    totalNoCacheTokens: row.totalNoCacheTokens,
    totalCacheReadTokens: row.totalCacheReadTokens,
    totalCacheWriteTokens: row.totalCacheWriteTokens,
    entryCount: row.entryCount
  }
}

function subtractMetrics(
  total: AiUsageRecordStatsMetrics,
  buckets: readonly AiUsageRecordStatsMetrics[]
): AiUsageRecordStatsMetrics {
  const sum = (read: (bucket: AiUsageRecordStatsMetrics) => number) =>
    buckets.reduce((value, bucket) => value + read(bucket), 0)
  return {
    costCurrency: total.costCurrency,
    totalCost: Math.max(0, total.totalCost - sum((bucket) => bucket.totalCost)),
    totalInputTokens: Math.max(0, total.totalInputTokens - sum((bucket) => bucket.totalInputTokens)),
    totalOutputTokens: Math.max(0, total.totalOutputTokens - sum((bucket) => bucket.totalOutputTokens)),
    totalTokens: Math.max(0, total.totalTokens - sum((bucket) => bucket.totalTokens)),
    totalNoCacheTokens: Math.max(0, total.totalNoCacheTokens - sum((bucket) => bucket.totalNoCacheTokens)),
    totalCacheReadTokens: Math.max(0, total.totalCacheReadTokens - sum((bucket) => bucket.totalCacheReadTokens)),
    totalCacheWriteTokens: Math.max(0, total.totalCacheWriteTokens - sum((bucket) => bucket.totalCacheWriteTokens)),
    entryCount: Math.max(0, total.entryCount - sum((bucket) => bucket.entryCount))
  }
}

function aggregateOrder(metric: AiUsageRecordMetric, currency: Currency | undefined): SQL<number> {
  switch (metric) {
    case 'requests':
      return sql<number>`count(*)`
    case 'cost':
      return scopedCostSum(currency)
    case 'tokens':
      return sql<number>`coalesce(sum(${aiUsageRecordTable.totalTokens}), 0)`
  }
}

export async function listAiUsageRecords(query: AiUsageRecordListServiceQuery): Promise<AiUsageRecordListResponse> {
  const db = application.get('DbService').getDb()
  const { limit } = query
  const sortBy = query.sortBy ?? 'createdAt'
  const sortOrder = query.sortOrder ?? 'desc'

  const filterConditions: SQL[] = []
  if (query.from !== undefined) filterConditions.push(gte(aiUsageRecordTable.createdAt, query.from))
  if (query.to !== undefined) filterConditions.push(lte(aiUsageRecordTable.createdAt, query.to))
  if (sortBy === 'cost' && query.costCurrency) {
    filterConditions.push(eq(aiUsageRecordTable.costCurrency, query.costCurrency))
  }
  const filterWhere = filterConditions.length > 0 ? and(...filterConditions) : undefined
  const tokensPerSecond = sql<number>`CASE
    WHEN ${aiUsageRecordTable.outputTokens} IS NULL
      OR ${aiUsageRecordTable.outputTokens} <= 0
      OR ${aiUsageRecordTable.timeCompletionMs} IS NULL
      OR ${aiUsageRecordTable.timeCompletionMs} <= 0
    THEN NULL
    ELSE ${aiUsageRecordTable.outputTokens} / (
      (CASE
        WHEN ${aiUsageRecordTable.timeFirstTokenMs} IS NOT NULL
          AND ${aiUsageRecordTable.timeFirstTokenMs} < ${aiUsageRecordTable.timeCompletionMs}
        THEN ${aiUsageRecordTable.timeCompletionMs} - ${aiUsageRecordTable.timeFirstTokenMs}
        ELSE ${aiUsageRecordTable.timeCompletionMs}
      END) / 1000.0
    )
  END`
  const sortExpression =
    sortBy === 'totalTokens'
      ? aiUsageRecordTable.totalTokens
      : sortBy === 'cost'
        ? aiUsageRecordTable.cost
        : sortBy === 'timeFirstTokenMs'
          ? aiUsageRecordTable.timeFirstTokenMs
          : sortBy === 'tokensPerSecond'
            ? tokensPerSecond
            : aiUsageRecordTable.createdAt
  const orderExpression = sortOrder === 'asc' ? asc(sortExpression) : desc(sortExpression)
  const sortsByCreatedAt = sortBy === 'createdAt'
  const createdAtOrdering = keysetOrdering(aiUsageRecordTable.createdAt, aiUsageRecordTable.id, {
    major: sortOrder,
    tie: 'asc'
  })
  const orderTerms: SQL[] = sortsByCreatedAt
    ? createdAtOrdering.orderBy
    : [sql`${sortExpression} IS NULL`, orderExpression, desc(aiUsageRecordTable.createdAt), asc(aiUsageRecordTable.id)]
  const conditions = [...filterConditions]
  if (sortsByCreatedAt) {
    const cursor = decodeListCursor(query.cursor, asNumericKey, 'ai-usage-record')
    if (cursor) conditions.push(createdAtOrdering.where(cursor))
  } else {
    const cursor = decodeMetricCursor(query.cursor)
    if (cursor) conditions.push(metricCursorWhere(sortExpression, sortOrder, cursor))
  }
  const where = conditions.length > 0 ? and(...conditions) : undefined

  const [rows, [{ count }]] = await Promise.all([
    db
      .select()
      .from(aiUsageRecordTable)
      .where(where)
      .orderBy(...orderTerms)
      .limit(limit + 1),
    db.select({ count: sql<number>`count(*)` }).from(aiUsageRecordTable).where(filterWhere)
  ])
  const pageRows = rows.slice(0, limit)
  const tail = pageRows.at(-1)

  return {
    items: pageRows.map(rowToRecord),
    total: count,
    nextCursor:
      rows.length > limit && tail
        ? sortsByCreatedAt
          ? encodeCursor(tail.createdAt, tail.id)
          : encodeMetricCursor({
              value: getListSortValue(tail, sortBy),
              createdAt: tail.createdAt,
              id: tail.id
            })
        : undefined
  }
}

export async function getAiUsageRecordStats(query: AiUsageRecordStatsQuery): Promise<AiUsageRecordStatsResponse> {
  const db = application.get('DbService').getDb()
  const where = and(...rangeConditions(query))

  const [rows, [totalRow]] = await Promise.all([
    db
      .select({
        ...groupIdentitySelect(query.groupBy),
        ...metricsSelect(query.currency)
      })
      .from(aiUsageRecordTable)
      .where(where)
      .groupBy(...groupIdentityColumns(query.groupBy))
      .orderBy(desc(aggregateOrder(query.metric, query.currency)))
      .limit(query.limit),
    db.select(metricsSelect(query.currency)).from(aiUsageRecordTable).where(where)
  ])

  const buckets: AiUsageRecordStatsBucket[] = rows.map((row) => ({
    ...toStatsGroupIdentity(row, query.groupBy),
    ...toMetrics(row, query.currency)
  }))
  const totals = toMetrics(totalRow, query.currency)

  return {
    buckets,
    totals,
    other: subtractMetrics(totals, buckets)
  }
}

function nullableIdentity(column: AnySQLiteColumn, value: string | null): SQL {
  return value === null ? isNull(column) : eq(column, value)
}

function topGroupCondition(groupBy: AiUsageRecordGroupBy, buckets: AiUsageRecordStatsBucket[]): SQL | undefined {
  const conditions = buckets.flatMap((bucket): SQL[] => {
    if (bucket.groupBy !== groupBy) return []

    switch (bucket.groupBy) {
      case 'provider':
        return [eq(aiUsageRecordTable.providerId, bucket.providerId)]
      case 'model':
        return [
          and(eq(aiUsageRecordTable.providerId, bucket.providerId), eq(aiUsageRecordTable.modelId, bucket.modelId))!
        ]
      case 'source':
        return [
          and(
            bucket.sourceType === null
              ? isNull(aiUsageRecordTable.sourceType)
              : eq(aiUsageRecordTable.sourceType, bucket.sourceType),
            nullableIdentity(aiUsageRecordTable.sourceId, bucket.sourceId)
          )!
        ]
      case 'apiKey':
        return [
          and(
            eq(aiUsageRecordTable.providerId, bucket.providerId),
            nullableIdentity(aiUsageRecordTable.apiKeyId, bucket.apiKeyId),
            ...(bucket.apiKeyId === null ? [eq(aiUsageRecordTable.apiKeyAttribution, bucket.apiKeyAttribution)] : [])
          )!
        ]
    }
  })

  return conditions.length > 0 ? or(...conditions) : undefined
}

function toTimelineMetrics(
  row: {
    totalCost: number
    totalTokens: number
    totalNoCacheTokens: number
    totalCacheReadTokens: number
    totalCacheWriteTokens: number
    entryCount: number
  },
  currency: Currency | undefined
) {
  return {
    costCurrency: currency ?? null,
    totalCost: row.totalCost,
    totalTokens: row.totalTokens,
    totalNoCacheTokens: row.totalNoCacheTokens,
    totalCacheReadTokens: row.totalCacheReadTokens,
    totalCacheWriteTokens: row.totalCacheWriteTokens,
    entryCount: row.entryCount
  }
}

export async function getAiUsageRecordTimeline(
  query: AiUsageRecordTimelineQuery
): Promise<AiUsageRecordTimelineResponse> {
  const db = application.get('DbService').getDb()
  const baseConditions = rangeConditions(query)
  const where = and(...baseConditions)
  const dayBucket = sql<string>`date(${aiUsageRecordTable.createdAt} / 1000, 'unixepoch', 'localtime')`
  const timelineMetrics = {
    totalCost: scopedCostSum(query.currency),
    totalTokens: sql<number>`coalesce(sum(${aiUsageRecordTable.totalTokens}), 0)`,
    totalNoCacheTokens: sql<number>`coalesce(sum(${aiUsageRecordTable.noCacheTokens}), 0)`,
    totalCacheReadTokens: sql<number>`coalesce(sum(${aiUsageRecordTable.cacheReadTokens}), 0)`,
    totalCacheWriteTokens: sql<number>`coalesce(sum(${aiUsageRecordTable.cacheWriteTokens}), 0)`,
    entryCount: sql<number>`count(*)`
  }

  const [dailyTotals, dailyCostRows] = await Promise.all([
    db
      .select({ date: dayBucket, ...timelineMetrics })
      .from(aiUsageRecordTable)
      .where(where)
      .groupBy(dayBucket)
      .orderBy(asc(dayBucket)),
    db
      .select({
        date: dayBucket,
        currency: aiUsageRecordTable.costCurrency,
        total: sql<number>`coalesce(sum(${aiUsageRecordTable.cost}), 0)`
      })
      .from(aiUsageRecordTable)
      .where(and(where, isNotNull(aiUsageRecordTable.costCurrency)))
      .groupBy(dayBucket, aiUsageRecordTable.costCurrency)
      .orderBy(asc(dayBucket), asc(aiUsageRecordTable.costCurrency))
  ])

  const dailyCosts = dailyCostRows.flatMap((row) =>
    row.currency === null || row.total <= 0 ? [] : [{ date: row.date, currency: row.currency, total: row.total }]
  )
  const costTotals = Array.from(
    dailyCosts.reduce((totals, item) => {
      totals.set(item.currency, (totals.get(item.currency) ?? 0) + item.total)
      return totals
    }, new Map<Currency, number>()),
    ([currency, total]) => ({ currency, total })
  ).sort((a, b) => a.currency.localeCompare(b.currency))
  const ungrouped = dailyTotals.map(
    (row): AiUsageRecordTimelineBucket => ({
      date: row.date,
      ...toTimelineMetrics(row, query.currency)
    })
  )

  if (!query.groupBy || dailyTotals.length === 0) {
    return { buckets: ungrouped, costTotals, dailyCosts }
  }

  const top = await getAiUsageRecordStats({
    groupBy: query.groupBy,
    metric: query.metric,
    currency: query.currency,
    limit: query.limit,
    from: query.from,
    to: query.to
  })
  const identityWhere = topGroupCondition(query.groupBy, top.buckets)
  if (!identityWhere) {
    return { buckets: [], costTotals, dailyCosts }
  }

  const selectedRows = await db
    .select({
      date: dayBucket,
      ...groupIdentitySelect(query.groupBy),
      ...timelineMetrics
    })
    .from(aiUsageRecordTable)
    .where(and(...baseConditions, identityWhere))
    .groupBy(dayBucket, ...groupIdentityColumns(query.groupBy))
    .orderBy(asc(dayBucket))

  const selected = selectedRows.map(
    (row): AiUsageRecordTimelineBucket => ({
      ...toGroupIdentity(row, query.groupBy),
      date: row.date,
      ...toTimelineMetrics(row, query.currency)
    })
  )
  const selectedByDate = new Map<string, AiUsageRecordTimelineBucket[]>()
  for (const bucket of selected) {
    const dateBuckets = selectedByDate.get(bucket.date) ?? []
    dateBuckets.push(bucket)
    selectedByDate.set(bucket.date, dateBuckets)
  }

  const other = ungrouped.flatMap((total): AiUsageRecordTimelineBucket[] => {
    const dateBuckets = selectedByDate.get(total.date) ?? []
    const sum = (read: (bucket: AiUsageRecordTimelineBucket) => number) =>
      dateBuckets.reduce((value, bucket) => value + read(bucket), 0)
    const entryCount = Math.max(0, total.entryCount - sum((bucket) => bucket.entryCount))
    if (entryCount === 0) return []

    return [
      {
        date: total.date,
        costCurrency: total.costCurrency,
        totalCost: Math.max(0, total.totalCost - sum((bucket) => bucket.totalCost)),
        totalTokens: Math.max(0, total.totalTokens - sum((bucket) => bucket.totalTokens)),
        totalNoCacheTokens: Math.max(0, total.totalNoCacheTokens - sum((bucket) => bucket.totalNoCacheTokens)),
        totalCacheReadTokens: Math.max(0, total.totalCacheReadTokens - sum((bucket) => bucket.totalCacheReadTokens)),
        totalCacheWriteTokens: Math.max(0, total.totalCacheWriteTokens - sum((bucket) => bucket.totalCacheWriteTokens)),
        entryCount,
        isOther: true
      }
    ]
  })

  return { buckets: [...selected, ...other], costTotals, dailyCosts }
}
