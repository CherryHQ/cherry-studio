import { isDeepStrictEqual } from 'node:util'

import {
  and,
  asc,
  desc,
  eq,
  gt,
  gte,
  isNotNull,
  isNull,
  lt,
  lte,
  or,
  type SQL,
  sql,
  type SQLWrapper
} from 'drizzle-orm'
import type { AnySQLiteColumn } from 'drizzle-orm/sqlite-core'

import { application } from '@application'
import { notifyDataApiDataChange } from '@data/dataApiDataChange'
import { agentSessionMessageTable } from '@data/db/schemas/agentSessionMessage'
import { type AiUsageRecordRow, aiUsageRecordTable, type InsertAiUsageRecordRow } from '@data/db/schemas/aiUsageRecord'
import { messageTable } from '@data/db/schemas/message'
import type { DbOrTx } from '@data/db/types'
import { loggerService } from '@logger'
import type {
  AiUsageRecordGroupBy,
  AiUsageRecordGroupIdentity,
  AiUsageRecordListQuery,
  AiUsageRecordListResponse,
  AiUsageRecordMetric,
  AiUsageRecordStatsBucket,
  AiUsageRecordStatsGroupIdentity,
  AiUsageRecordStatsMetrics,
  AiUsageRecordStatsQuery,
  AiUsageRecordStatsResponse,
  AiUsageRecordTimelineBucket,
  AiUsageRecordTimelineQuery,
  AiUsageRecordTimelineResponse
} from '@shared/data/api/schemas/aiUsageRecords'
import type { DataApiDataChangeEffect } from '@shared/data/api/types'
import {
  type AiUsageCostBreakdown,
  type AiUsagePricingSnapshot,
  type AiUsageRecordAttribution,
  type AiUsageRecordAuthMethod,
  type AiUsageRecordCostSource,
  type AiUsageRecordEntry,
  type AiUsageRecordMessageKind,
  type AiUsageRecordModality,
  type AiUsageRecordSourceType,
  getAiUsageRecordTotalTokens
} from '@shared/data/types/aiUsageRecord'
import type {
  MessageRuntimeSpan,
  MessageRuntimeStatsInput,
  MessageRuntimeTiming,
  MessageStats
} from '@shared/data/types/message'
import type { Currency } from '@shared/data/types/model'

import { asNumericKey, decodeListCursor, encodeCursor, keysetOrdering } from './utils/keysetCursor'
import { timestampToISO } from './utils/rowMappers'

/**
 * Non-secret receipt captured by the component that selected the serving
 * credential. The raw credential never crosses into usage persistence.
 */
export type AiUsageCredentialReceipt =
  | {
      attribution: 'explicit' | 'matched'
      id: string
      label?: string
      masked: string
    }
  | { attribution: 'auth'; method: AiUsageRecordAuthMethod }
  | { attribution: 'unknown' }

export interface SourceSnapshot {
  type: AiUsageRecordSourceType
  id: string
  name: string | null
  icon: string | null
}

export interface MessageRef {
  kind: AiUsageRecordMessageKind
  id: string
}

type MessageReadModelTarget = MessageRef & { containerId: string }

export interface AiUsageCaptureContext {
  providerId: string
  providerName: string | null
  modelId: string
  modelName: string | null
  pricingSnapshot: AiUsagePricingSnapshot | null
  trustProviderReportedCost: boolean
  reportedCostCurrency: Currency | null
  credentialReceipt: AiUsageCredentialReceipt
  source: SourceSnapshot | null
  messageRef: MessageRef | null
}

export interface RecordAiInvocationInput {
  requestId: string
  context: AiUsageCaptureContext
  modality: AiUsageRecordModality
  usage?: {
    inputTokens?: number
    outputTokens?: number
    totalTokens?: number
    reasoningTokens?: number
    noCacheTokens?: number
    cacheReadTokens?: number
    cacheWriteTokens?: number
  }
  imageCount?: number
  providerCost?: {
    amount: number
    currency: Currency
    breakdown?: AiUsageCostBreakdown
  }
  metrics?: {
    timeFirstTokenMs?: number
    timeCompletionMs?: number
    timeThinkingMs?: number
  }
  completedAt: number
}

export interface LegacyAggregateInput {
  requestId: string
  requestCount: number
  messageRef: MessageRef
  providerId?: string | null
  providerName?: string | null
  modelId?: string | null
  modelName?: string | null
  source?: SourceSnapshot | null
  usage: RecordAiInvocationInput['usage']
  cost?: {
    amount: number
    currency: Currency
    source: AiUsageRecordCostSource
    breakdown?: AiUsageCostBreakdown
    pricingSnapshot?: AiUsagePricingSnapshot
  }
  modality?: AiUsageRecordModality
  createdAt: number
}

export type MessageUsageProjection = Pick<
  MessageStats,
  | 'inputTokens'
  | 'outputTokens'
  | 'totalTokens'
  | 'inputTokenDetails'
  | 'outputTokenDetails'
  | 'requestCount'
  | 'estimatedRequestCount'
  | 'unpricedRequestCount'
  | 'costs'
  | 'providerPerformance'
>

const PER_MILLION = 1_000_000

interface LanguageCostUsage {
  inputTokens?: number
  outputTokens?: number
  inputTokenDetails?: {
    noCacheTokens?: number
    cacheReadTokens?: number
    cacheWriteTokens?: number
  }
}

interface LanguageCostResult {
  cost: number
  breakdown: AiUsageCostBreakdown
}

/**
 * Compute the usage-record domain's cache-aware language cost from the all-in
 * input count and any provider breakdown. Partial cache details are subtracted
 * from the total so no token can be priced as both regular input and cached
 * input. A cost is returned only when every non-zero usage bucket has a known
 * rate.
 */
function computeLanguageCost(
  usage: LanguageCostUsage,
  pricing: AiUsagePricingSnapshot
): LanguageCostResult | undefined {
  const details = usage.inputTokenDetails
  const inputTokens =
    usage.inputTokens ??
    (details?.noCacheTokens !== undefined
      ? details.noCacheTokens + (details.cacheReadTokens ?? 0) + (details.cacheWriteTokens ?? 0)
      : undefined)
  let rates: Pick<
    AiUsagePricingSnapshot,
    'inputPerMillionTokens' | 'outputPerMillionTokens' | 'cacheReadPerMillionTokens' | 'cacheWritePerMillionTokens'
  > = pricing
  if (pricing.inputTokenTiers?.length) {
    if (inputTokens === undefined) return undefined
    for (const tier of pricing.inputTokenTiers) {
      if (inputTokens < tier.minInputTokens) break
      rates = tier
    }
  }

  const cacheReadTokens = details?.cacheReadTokens
  const cacheWriteTokens = details?.cacheWriteTokens
  const hasCacheDetails = cacheReadTokens !== undefined || cacheWriteTokens !== undefined
  const nonCacheInput =
    details?.noCacheTokens ??
    (inputTokens !== undefined
      ? hasCacheDetails
        ? Math.max(0, inputTokens - (cacheReadTokens ?? 0) - (cacheWriteTokens ?? 0))
        : inputTokens
      : undefined)

  const buckets = [
    ['input', nonCacheInput, rates.inputPerMillionTokens],
    ['cacheRead', cacheReadTokens, rates.cacheReadPerMillionTokens ?? rates.inputPerMillionTokens],
    ['cacheWrite', cacheWriteTokens, rates.cacheWritePerMillionTokens ?? rates.inputPerMillionTokens],
    ['output', usage.outputTokens, rates.outputPerMillionTokens]
  ] as const

  if (!buckets.some(([, tokens]) => tokens !== undefined)) return undefined
  if (buckets.some(([, tokens, rate]) => tokens !== undefined && tokens > 0 && rate === undefined)) return undefined

  const breakdown: AiUsageCostBreakdown = {}
  let cost = 0
  for (const [key, tokens, rate] of buckets) {
    if (tokens === undefined || rate === undefined) continue
    const value = (tokens * rate) / PER_MILLION
    breakdown[key] = value
    cost += value
  }

  return Number.isFinite(cost) && cost >= 0 ? { cost, breakdown } : undefined
}

const cursorLogger = loggerService.withContext('DataApi:AiUsageRecordCursor')

type AiUsageRecordListServiceQuery = Omit<AiUsageRecordListQuery, 'sortBy' | 'sortOrder'> &
  Partial<Pick<AiUsageRecordListQuery, 'sortBy' | 'sortOrder'>>

type AiUsageRecordListSortBy = NonNullable<AiUsageRecordListServiceQuery['sortBy']>
type AiUsageRecordListSortOrder = NonNullable<AiUsageRecordListServiceQuery['sortOrder']>

interface AiUsageRecordMetricCursor {
  value: number | null
  createdAt: number
  id: string
}

function getTokensPerSecond(row: AiUsageRecordRow): number | null {
  if (
    row.outputTokens === null ||
    row.outputTokens <= 0 ||
    row.timeCompletionMs === null ||
    row.timeCompletionMs <= 0
  ) {
    return null
  }

  const generationMs =
    row.timeFirstTokenMs !== null && row.timeFirstTokenMs < row.timeCompletionMs
      ? row.timeCompletionMs - row.timeFirstTokenMs
      : row.timeCompletionMs
  return row.outputTokens / (generationMs / 1000)
}

function getListSortValue(row: AiUsageRecordRow, sortBy: AiUsageRecordListSortBy): number | null {
  switch (sortBy) {
    case 'createdAt':
      return row.createdAt
    case 'totalTokens':
      return getAiUsageRecordTotalTokens(row)
    case 'cost':
      return row.cost
    case 'timeFirstTokenMs':
      return row.timeFirstTokenMs
    case 'tokensPerSecond':
      return getTokensPerSecond(row)
  }
}

function encodeMetricCursor(cursor: AiUsageRecordMetricCursor): string {
  return encodeURIComponent(JSON.stringify([cursor.value, cursor.createdAt, cursor.id]))
}

function decodeMetricCursor(raw: string | undefined): AiUsageRecordMetricCursor | null {
  if (!raw) return null

  try {
    const parsed: unknown = JSON.parse(decodeURIComponent(raw))
    if (!Array.isArray(parsed) || parsed.length !== 3) throw new Error('invalid tuple')

    const [value, createdAt, id] = parsed
    if (
      (value !== null && (typeof value !== 'number' || !Number.isFinite(value))) ||
      typeof createdAt !== 'number' ||
      !Number.isFinite(createdAt) ||
      typeof id !== 'string' ||
      id.length === 0
    ) {
      throw new Error('invalid boundary')
    }

    return { value, createdAt, id }
  } catch {
    cursorLogger.warn('decodeCursor: cursor unparseable, falling back to first page', {
      cursor: raw,
      context: 'ai-usage-record'
    })
    return null
  }
}

function metricCursorWhere(
  sortExpression: SQLWrapper,
  sortOrder: AiUsageRecordListSortOrder,
  cursor: AiUsageRecordMetricCursor
): SQL {
  const afterTie = or(
    lt(aiUsageRecordTable.createdAt, cursor.createdAt),
    and(eq(aiUsageRecordTable.createdAt, cursor.createdAt), gt(aiUsageRecordTable.id, cursor.id))
  )!

  if (cursor.value === null) {
    return and(isNull(sortExpression), afterTie)!
  }

  const afterMetric = sortOrder === 'asc' ? gt(sortExpression, cursor.value) : lt(sortExpression, cursor.value)
  return or(
    isNull(sortExpression),
    and(isNotNull(sortExpression), or(afterMetric, and(eq(sortExpression, cursor.value), afterTie)))
  )!
}

type GroupDimension = AiUsageRecordGroupBy | undefined

function rowToRecord(row: AiUsageRecordRow): AiUsageRecordEntry {
  return {
    id: row.id,
    requestId: row.requestId,
    recordKind: row.recordKind,
    requestCount: row.requestCount,
    messageKind: row.messageKind,
    messageId: row.messageId,
    providerId: row.providerId,
    providerName: row.providerName,
    sourceType: row.sourceType,
    sourceId: row.sourceId,
    sourceName: row.sourceName,
    sourceIcon: row.sourceIcon,
    modelId: row.modelId,
    modelName: row.modelName,
    modality: row.modality,
    apiKeyId: row.apiKeyId,
    apiKeyLabel: row.apiKeyLabel,
    apiKeyMasked: row.apiKeyMasked,
    apiKeyAttribution: row.apiKeyAttribution,
    authMethod: row.authMethod,
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    totalTokens: row.totalTokens,
    reasoningTokens: row.reasoningTokens,
    noCacheTokens: row.noCacheTokens,
    cacheReadTokens: row.cacheReadTokens,
    cacheWriteTokens: row.cacheWriteTokens,
    imageCount: row.imageCount,
    cost: row.cost,
    costCurrency: row.costCurrency,
    costSource: row.costSource,
    costBreakdown: row.costBreakdown,
    pricingSnapshot: row.pricingSnapshot,
    timeFirstTokenMs: row.timeFirstTokenMs,
    timeCompletionMs: row.timeCompletionMs,
    timeThinkingMs: row.timeThinkingMs,
    createdAt: timestampToISO(row.createdAt)
  }
}

function groupIdentityColumns(groupBy: GroupDimension) {
  switch (groupBy) {
    case 'provider':
      return [aiUsageRecordTable.providerId]
    case 'apiKey':
      return [
        aiUsageRecordTable.providerId,
        aiUsageRecordTable.apiKeyId,
        aiUsageRecordTable.apiKeyAttribution,
        aiUsageRecordTable.authMethod
      ]
    case 'model':
      return [aiUsageRecordTable.providerId, aiUsageRecordTable.modelId]
    case 'source':
      return [aiUsageRecordTable.sourceType, aiUsageRecordTable.sourceId]
    default:
      return []
  }
}

function groupIdentitySelect(groupBy: GroupDimension) {
  const bySource = groupBy === 'source'
  const byProvider = groupBy !== undefined && !bySource
  const byApiKey = groupBy === 'apiKey'

  return {
    providerId: byProvider ? aiUsageRecordTable.providerId : sql<string | null>`NULL`,
    providerName: byProvider ? sql<string | null>`max(${aiUsageRecordTable.providerName})` : sql<string | null>`NULL`,
    sourceType: bySource ? aiUsageRecordTable.sourceType : sql<AiUsageRecordSourceType | null>`NULL`,
    sourceId: bySource ? aiUsageRecordTable.sourceId : sql<string | null>`NULL`,
    sourceName: bySource ? sql<string | null>`max(${aiUsageRecordTable.sourceName})` : sql<string | null>`NULL`,
    sourceIcon: bySource ? sql<string | null>`max(${aiUsageRecordTable.sourceIcon})` : sql<string | null>`NULL`,
    apiKeyId: byApiKey ? aiUsageRecordTable.apiKeyId : sql<string | null>`NULL`,
    modelId: groupBy === 'model' ? aiUsageRecordTable.modelId : sql<string | null>`NULL`,
    apiKeyLabel: byApiKey ? sql<string | null>`max(${aiUsageRecordTable.apiKeyLabel})` : sql<string | null>`NULL`,
    apiKeyMasked: byApiKey ? sql<string | null>`max(${aiUsageRecordTable.apiKeyMasked})` : sql<string | null>`NULL`,
    apiKeyAttribution: byApiKey ? aiUsageRecordTable.apiKeyAttribution : sql<string | null>`NULL`,
    authMethod: byApiKey ? aiUsageRecordTable.authMethod : sql<string | null>`NULL`
  }
}

type GroupIdentityRow = {
  [K in keyof ReturnType<typeof groupIdentitySelect>]: string | null
}

function toGroupIdentity(row: GroupIdentityRow, groupBy: GroupDimension): AiUsageRecordGroupIdentity {
  if (groupBy === undefined) {
    return {}
  }

  return {
    ...(groupBy === 'source'
      ? {
          sourceType: row.sourceType as AiUsageRecordSourceType | null,
          sourceId: row.sourceId,
          sourceName: row.sourceName,
          sourceIcon: row.sourceIcon
        }
      : {
          providerId: row.providerId,
          providerName: row.providerName
        }),
    ...(groupBy === 'apiKey'
      ? {
          apiKeyId: row.apiKeyId,
          apiKeyLabel: row.apiKeyLabel,
          apiKeyMasked: row.apiKeyMasked,
          apiKeyAttribution: row.apiKeyAttribution as AiUsageRecordAttribution,
          authMethod: row.authMethod as AiUsageRecordEntry['authMethod']
        }
      : {}),
    ...(groupBy === 'model' ? { modelId: row.modelId } : {})
  }
}

function toStatsGroupIdentity(row: GroupIdentityRow, groupBy: AiUsageRecordGroupBy): AiUsageRecordStatsGroupIdentity {
  switch (groupBy) {
    case 'provider':
      return {
        groupBy,
        providerId: row.providerId,
        providerName: row.providerName
      }
    case 'apiKey':
      return {
        groupBy,
        providerId: row.providerId,
        providerName: row.providerName,
        apiKeyId: row.apiKeyId,
        apiKeyLabel: row.apiKeyLabel,
        apiKeyMasked: row.apiKeyMasked,
        apiKeyAttribution: row.apiKeyAttribution as AiUsageRecordAttribution,
        authMethod: row.authMethod as AiUsageRecordEntry['authMethod']
      }
    case 'model':
      return {
        groupBy,
        providerId: row.providerId,
        providerName: row.providerName,
        modelId: row.modelId
      }
    case 'source':
      return {
        groupBy,
        sourceType: row.sourceType as AiUsageRecordSourceType | null,
        sourceId: row.sourceId,
        sourceName: row.sourceName,
        sourceIcon: row.sourceIcon
      }
  }
}

function rangeConditions(query: { from: number; to: number }): SQL[] {
  return [gte(aiUsageRecordTable.createdAt, query.from), lte(aiUsageRecordTable.createdAt, query.to)]
}

function scopedCostSum(currency: Currency | undefined): SQL<number> {
  return currency
    ? sql<number>`coalesce(sum(CASE WHEN ${aiUsageRecordTable.costCurrency} = ${currency} THEN ${aiUsageRecordTable.cost} ELSE 0 END), 0)`
    : sql<number>`0`
}

function totalTokensValue(): SQL<number | null> {
  return sql<number | null>`CASE
    WHEN ${aiUsageRecordTable.totalTokens} IS NOT NULL THEN ${aiUsageRecordTable.totalTokens}
    WHEN ${aiUsageRecordTable.inputTokens} IS NOT NULL OR ${aiUsageRecordTable.outputTokens} IS NOT NULL
      THEN coalesce(${aiUsageRecordTable.inputTokens}, 0) + coalesce(${aiUsageRecordTable.outputTokens}, 0)
    ELSE NULL
  END`
}

function totalTokensSum(): SQL<number> {
  return sql<number>`coalesce(sum(${totalTokensValue()}), 0)`
}

function metricsSelect(currency: Currency | undefined) {
  return {
    totalCost: scopedCostSum(currency),
    totalInputTokens: sql<number>`coalesce(sum(${aiUsageRecordTable.inputTokens}), 0)`,
    totalOutputTokens: sql<number>`coalesce(sum(${aiUsageRecordTable.outputTokens}), 0)`,
    totalTokens: totalTokensSum(),
    totalNoCacheTokens: sql<number>`coalesce(sum(${aiUsageRecordTable.noCacheTokens}), 0)`,
    totalCacheReadTokens: sql<number>`coalesce(sum(${aiUsageRecordTable.cacheReadTokens}), 0)`,
    totalCacheWriteTokens: sql<number>`coalesce(sum(${aiUsageRecordTable.cacheWriteTokens}), 0)`,
    recordCount: sql<number>`count(*)`,
    requestCount: sql<number>`coalesce(sum(${aiUsageRecordTable.requestCount}), 0)`,
    estimatedRequestCount: sql<number>`coalesce(sum(
      CASE WHEN ${aiUsageRecordTable.recordKind} = 'legacy-aggregate'
        THEN ${aiUsageRecordTable.requestCount} ELSE 0 END
    ), 0)`,
    unpricedRequestCount: sql<number>`coalesce(sum(
      CASE WHEN ${aiUsageRecordTable.cost} IS NULL
        THEN ${aiUsageRecordTable.requestCount} ELSE 0 END
    ), 0)`
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
    recordCount: row.recordCount,
    requestCount: row.requestCount,
    estimatedRequestCount: row.estimatedRequestCount,
    unpricedRequestCount: row.unpricedRequestCount
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
    recordCount: Math.max(0, total.recordCount - sum((bucket) => bucket.recordCount)),
    requestCount: Math.max(0, total.requestCount - sum((bucket) => bucket.requestCount)),
    estimatedRequestCount: Math.max(0, total.estimatedRequestCount - sum((bucket) => bucket.estimatedRequestCount)),
    unpricedRequestCount: Math.max(0, total.unpricedRequestCount - sum((bucket) => bucket.unpricedRequestCount))
  }
}

function aggregateOrder(metric: AiUsageRecordMetric, currency: Currency | undefined): SQL<number> {
  switch (metric) {
    case 'requests':
      return sql<number>`coalesce(sum(${aiUsageRecordTable.requestCount}), 0)`
    case 'cost':
      return scopedCostSum(currency)
    case 'tokens':
      return totalTokensSum()
  }
}

function listAiUsageRecords(query: AiUsageRecordListServiceQuery): AiUsageRecordListResponse {
  const db = application.get('DbService').getDb()
  const { limit } = query
  const sortBy = query.sortBy ?? 'createdAt'
  const sortOrder = query.sortOrder ?? 'desc'

  const filterConditions: SQL[] = []
  if (query.from !== undefined) filterConditions.push(gte(aiUsageRecordTable.createdAt, query.from))
  if (query.to !== undefined) filterConditions.push(lte(aiUsageRecordTable.createdAt, query.to))
  if (query.messageKind !== undefined && query.messageId !== undefined) {
    filterConditions.push(
      eq(aiUsageRecordTable.messageKind, query.messageKind),
      eq(aiUsageRecordTable.messageId, query.messageId)
    )
  }
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
  const totalTokens = totalTokensValue()
  const sortExpression =
    sortBy === 'totalTokens'
      ? totalTokens
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

  const rows = db
    .select()
    .from(aiUsageRecordTable)
    .where(where)
    .orderBy(...orderTerms)
    .limit(limit + 1)
    .all()
  const count =
    db
      .select({ count: sql<number>`count(*)` })
      .from(aiUsageRecordTable)
      .where(filterWhere)
      .get()?.count ?? 0
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

function getAiUsageRecordStats(query: AiUsageRecordStatsQuery): AiUsageRecordStatsResponse {
  const db = application.get('DbService').getDb()
  const where = and(...rangeConditions(query))

  const rows = db
    .select({
      ...groupIdentitySelect(query.groupBy),
      ...metricsSelect(query.currency)
    })
    .from(aiUsageRecordTable)
    .where(where)
    .groupBy(...groupIdentityColumns(query.groupBy))
    .orderBy(desc(aggregateOrder(query.metric, query.currency)))
    .limit(query.limit)
    .all()
  const [totalRow] = db.select(metricsSelect(query.currency)).from(aiUsageRecordTable).where(where).all()

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
        return [nullableIdentity(aiUsageRecordTable.providerId, bucket.providerId)]
      case 'model':
        return [
          and(
            nullableIdentity(aiUsageRecordTable.providerId, bucket.providerId),
            nullableIdentity(aiUsageRecordTable.modelId, bucket.modelId)
          )!
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
            nullableIdentity(aiUsageRecordTable.providerId, bucket.providerId),
            nullableIdentity(aiUsageRecordTable.apiKeyId, bucket.apiKeyId),
            eq(aiUsageRecordTable.apiKeyAttribution, bucket.apiKeyAttribution),
            nullableIdentity(aiUsageRecordTable.authMethod, bucket.authMethod)
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
    recordCount: number
    requestCount: number
    estimatedRequestCount: number
    unpricedRequestCount: number
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
    recordCount: row.recordCount,
    requestCount: row.requestCount,
    estimatedRequestCount: row.estimatedRequestCount,
    unpricedRequestCount: row.unpricedRequestCount
  }
}

function getAiUsageRecordTimeline(query: AiUsageRecordTimelineQuery): AiUsageRecordTimelineResponse {
  const db = application.get('DbService').getDb()
  const baseConditions = rangeConditions(query)
  const where = and(...baseConditions)
  const dayBucket = sql<string>`date(${aiUsageRecordTable.createdAt} / 1000, 'unixepoch', 'localtime')`
  const timelineMetrics = {
    totalCost: scopedCostSum(query.currency),
    totalTokens: totalTokensSum(),
    totalNoCacheTokens: sql<number>`coalesce(sum(${aiUsageRecordTable.noCacheTokens}), 0)`,
    totalCacheReadTokens: sql<number>`coalesce(sum(${aiUsageRecordTable.cacheReadTokens}), 0)`,
    totalCacheWriteTokens: sql<number>`coalesce(sum(${aiUsageRecordTable.cacheWriteTokens}), 0)`,
    recordCount: sql<number>`count(*)`,
    requestCount: sql<number>`coalesce(sum(${aiUsageRecordTable.requestCount}), 0)`,
    estimatedRequestCount: sql<number>`coalesce(sum(
      CASE WHEN ${aiUsageRecordTable.recordKind} = 'legacy-aggregate'
        THEN ${aiUsageRecordTable.requestCount} ELSE 0 END
    ), 0)`,
    unpricedRequestCount: sql<number>`coalesce(sum(
      CASE WHEN ${aiUsageRecordTable.cost} IS NULL
        THEN ${aiUsageRecordTable.requestCount} ELSE 0 END
    ), 0)`
  }

  const dailyTotals = db
    .select({ date: dayBucket, ...timelineMetrics })
    .from(aiUsageRecordTable)
    .where(where)
    .groupBy(dayBucket)
    .orderBy(asc(dayBucket))
    .all()
  const dailyCostRows = db
    .select({
      date: dayBucket,
      currency: aiUsageRecordTable.costCurrency,
      total: sql<number>`coalesce(sum(${aiUsageRecordTable.cost}), 0)`
    })
    .from(aiUsageRecordTable)
    .where(and(where, isNotNull(aiUsageRecordTable.costCurrency)))
    .groupBy(dayBucket, aiUsageRecordTable.costCurrency)
    .orderBy(asc(dayBucket), asc(aiUsageRecordTable.costCurrency))
    .all()

  const dailyCosts = dailyCostRows.flatMap((row) =>
    row.currency === null ? [] : [{ date: row.date, currency: row.currency, total: row.total }]
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

  const top = getAiUsageRecordStats({
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

  const selectedRows = db
    .select({
      date: dayBucket,
      ...groupIdentitySelect(query.groupBy),
      ...timelineMetrics
    })
    .from(aiUsageRecordTable)
    .where(and(...baseConditions, identityWhere))
    .groupBy(dayBucket, ...groupIdentityColumns(query.groupBy))
    .orderBy(asc(dayBucket))
    .all()

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
    const recordCount = Math.max(0, total.recordCount - sum((bucket) => bucket.recordCount))
    if (recordCount === 0) return []

    return [
      {
        date: total.date,
        costCurrency: total.costCurrency,
        totalCost: Math.max(0, total.totalCost - sum((bucket) => bucket.totalCost)),
        totalTokens: Math.max(0, total.totalTokens - sum((bucket) => bucket.totalTokens)),
        totalNoCacheTokens: Math.max(0, total.totalNoCacheTokens - sum((bucket) => bucket.totalNoCacheTokens)),
        totalCacheReadTokens: Math.max(0, total.totalCacheReadTokens - sum((bucket) => bucket.totalCacheReadTokens)),
        totalCacheWriteTokens: Math.max(0, total.totalCacheWriteTokens - sum((bucket) => bucket.totalCacheWriteTokens)),
        recordCount,
        requestCount: Math.max(0, total.requestCount - sum((bucket) => bucket.requestCount)),
        estimatedRequestCount: Math.max(0, total.estimatedRequestCount - sum((bucket) => bucket.estimatedRequestCount)),
        unpricedRequestCount: Math.max(0, total.unpricedRequestCount - sum((bucket) => bucket.unpricedRequestCount)),
        isOther: true
      }
    ]
  })

  return { buckets: [...selected, ...other], costTotals, dailyCosts }
}

type MessageOwnedStats = Omit<MessageStats, keyof MessageUsageProjection>
type PersistedMessageStats = MessageStats & {
  cost?: unknown
  costCurrency?: unknown
  costSource?: unknown
  costBreakdown?: unknown
  pricingSnapshot?: unknown
}

const MESSAGE_USAGE_PROJECTION_KEY_BY_NAME = {
  inputTokens: 'inputTokens',
  outputTokens: 'outputTokens',
  totalTokens: 'totalTokens',
  inputTokenDetails: 'inputTokenDetails',
  outputTokenDetails: 'outputTokenDetails',
  requestCount: 'requestCount',
  estimatedRequestCount: 'estimatedRequestCount',
  unpricedRequestCount: 'unpricedRequestCount',
  costs: 'costs',
  providerPerformance: 'providerPerformance'
} satisfies { [Key in keyof Required<MessageUsageProjection>]: Key }

const MESSAGE_USAGE_PROJECTION_KEYS = Object.values(MESSAGE_USAGE_PROJECTION_KEY_BY_NAME)
const LEGACY_RECORD_OWNED_KEYS = ['cost', 'costCurrency', 'costSource', 'costBreakdown', 'pricingSnapshot'] as const

function mergeRuntimeSpan(existing: MessageRuntimeSpan, incoming: MessageRuntimeSpan): MessageRuntimeSpan {
  if (existing.kind !== incoming.kind) return existing

  const completedAt =
    existing.completedAt !== undefined && incoming.completedAt !== undefined
      ? Math.max(existing.completedAt, incoming.completedAt)
      : (incoming.completedAt ?? existing.completedAt)

  return {
    ...existing,
    ...incoming,
    startedAt: Math.min(existing.startedAt, incoming.startedAt),
    ...(completedAt !== undefined ? { completedAt } : {})
  } as MessageRuntimeSpan
}

function mergeMessageRuntimeTiming(
  existing: MessageRuntimeTiming | undefined,
  incoming: MessageRuntimeTiming | undefined
): MessageRuntimeTiming | undefined {
  if (!existing) return incoming
  if (!incoming) return existing

  const spans = new Map(existing.spans.map((span) => [span.id, span]))
  for (const span of incoming.spans) {
    const previous = spans.get(span.id)
    spans.set(span.id, previous ? mergeRuntimeSpan(previous, span) : span)
  }

  const completedAt =
    existing.completedAt !== undefined && incoming.completedAt !== undefined
      ? Math.max(existing.completedAt, incoming.completedAt)
      : (incoming.completedAt ?? existing.completedAt)

  return {
    startedAt: Math.min(existing.startedAt, incoming.startedAt),
    ...(completedAt !== undefined ? { completedAt } : {}),
    spans: [...spans.values()].sort(
      (left, right) => left.startedAt - right.startedAt || left.id.localeCompare(right.id)
    )
  }
}

export function mergeMessageRuntimeStats(
  existing: MessageStats | null | undefined,
  incoming: MessageRuntimeStatsInput | null | undefined
): MessageStats | undefined {
  const runtimeTiming = mergeMessageRuntimeTiming(existing?.runtimeTiming, incoming?.runtimeTiming)
  const merged: MessageStats = { ...existing }

  if (runtimeTiming) {
    merged.runtimeTiming = runtimeTiming
    // `runtimeTiming` is the sole timing source for new-format messages.
    delete merged.timeFirstTokenMs
    delete merged.timeCompletionMs
    delete merged.timeThinkingMs
  }
  if (incoming?.contextTokens !== undefined) {
    merged.contextTokens = incoming.contextTokens
  }

  return Object.keys(merged).length > 0 ? merged : undefined
}

export function mergeMessageUsageProjection(
  existing: MessageStats | null | undefined,
  projection: MessageUsageProjection
): MessageStats {
  const persisted: PersistedMessageStats = existing ?? {}
  const messageOwned: PersistedMessageStats = { ...persisted }

  for (const key of MESSAGE_USAGE_PROJECTION_KEYS) delete messageOwned[key]
  for (const key of LEGACY_RECORD_OWNED_KEYS) delete messageOwned[key]

  const normalizedMessageOwned: MessageOwnedStats = messageOwned.runtimeTiming
    ? {
        runtimeTiming: messageOwned.runtimeTiming,
        ...(messageOwned.contextTokens !== undefined ? { contextTokens: messageOwned.contextTokens } : {})
      }
    : messageOwned
  return { ...normalizedMessageOwned, ...projection }
}

function sumOptional(
  rows: readonly AiUsageRecordRow[],
  read: (row: AiUsageRecordRow) => number | null
): number | undefined {
  let sawValue = false
  let total = 0
  for (const row of rows) {
    const value = read(row)
    if (value === null) continue
    sawValue = true
    total += value
  }
  return sawValue ? total : undefined
}

function getMessageUsageProjectionTx(db: DbOrTx, ref: MessageRef): MessageUsageProjection {
  const rows = db
    .select()
    .from(aiUsageRecordTable)
    .where(and(eq(aiUsageRecordTable.messageKind, ref.kind), eq(aiUsageRecordTable.messageId, ref.id)))
    .all()

  const inputTokens = sumOptional(rows, (row) => row.inputTokens)
  const outputTokens = sumOptional(rows, (row) => row.outputTokens)
  const totalTokens = sumOptional(
    rows,
    (row) =>
      row.totalTokens ??
      (row.inputTokens !== null || row.outputTokens !== null ? (row.inputTokens ?? 0) + (row.outputTokens ?? 0) : null)
  )
  const noCacheTokens = sumOptional(rows, (row) => row.noCacheTokens)
  const cacheReadTokens = sumOptional(rows, (row) => row.cacheReadTokens)
  const cacheWriteTokens = sumOptional(rows, (row) => row.cacheWriteTokens)
  const reasoningTokens = sumOptional(rows, (row) => row.reasoningTokens)
  const textTokens = sumOptional(rows, (row) =>
    row.outputTokens !== null ? Math.max(0, row.outputTokens - (row.reasoningTokens ?? 0)) : null
  )
  let measuredOutputTokens = 0
  let generationDurationMs = 0
  let measuredInvocationCount = 0
  const costs = new Map<
    string,
    {
      currency: NonNullable<MessageStats['costs']>[number]['currency']
      amount: number
      providerReportedRequestCount: number
      computedRequestCount: number
    }
  >()

  for (const row of rows) {
    if (row.outputTokens !== null && row.timeCompletionMs !== null && row.timeCompletionMs > 0) {
      const duration =
        row.timeFirstTokenMs !== null && row.timeFirstTokenMs < row.timeCompletionMs
          ? row.timeCompletionMs - row.timeFirstTokenMs
          : row.timeCompletionMs
      if (duration > 0) {
        measuredOutputTokens += row.outputTokens
        generationDurationMs += duration
        measuredInvocationCount += 1
      }
    }

    if (row.cost === null || row.costCurrency === null || row.costSource === null) continue
    const bucket = costs.get(row.costCurrency) ?? {
      currency: row.costCurrency,
      amount: 0,
      providerReportedRequestCount: 0,
      computedRequestCount: 0
    }
    bucket.amount += row.cost
    if (row.costSource === 'provider') bucket.providerReportedRequestCount += row.requestCount
    else bucket.computedRequestCount += row.requestCount
    costs.set(row.costCurrency, bucket)
  }

  return {
    ...(inputTokens !== undefined ? { inputTokens } : {}),
    ...(outputTokens !== undefined ? { outputTokens } : {}),
    ...(totalTokens !== undefined ? { totalTokens } : {}),
    ...(noCacheTokens !== undefined || cacheReadTokens !== undefined || cacheWriteTokens !== undefined
      ? {
          inputTokenDetails: {
            ...(noCacheTokens !== undefined ? { noCacheTokens } : {}),
            ...(cacheReadTokens !== undefined ? { cacheReadTokens } : {}),
            ...(cacheWriteTokens !== undefined ? { cacheWriteTokens } : {})
          }
        }
      : {}),
    ...(textTokens !== undefined || reasoningTokens !== undefined
      ? {
          outputTokenDetails: {
            ...(textTokens !== undefined ? { textTokens } : {}),
            ...(reasoningTokens !== undefined ? { reasoningTokens } : {})
          }
        }
      : {}),
    requestCount: rows.reduce((sum, row) => sum + row.requestCount, 0),
    estimatedRequestCount: rows.reduce(
      (sum, row) => sum + (row.recordKind === 'legacy-aggregate' ? row.requestCount : 0),
      0
    ),
    unpricedRequestCount: rows.reduce((sum, row) => sum + (row.cost === null ? row.requestCount : 0), 0),
    costs: [...costs.values()].sort((left, right) => left.currency.localeCompare(right.currency)),
    ...(measuredInvocationCount > 0
      ? {
          providerPerformance: {
            measuredOutputTokens,
            generationDurationMs
          }
        }
      : {})
  }
}

function rebuildMessageUsageProjectionTx(
  db: DbOrTx,
  ref: MessageRef
): { changed: boolean; target: MessageReadModelTarget } | null {
  const projection = getMessageUsageProjectionTx(db, ref)
  if (ref.kind === 'chat') {
    const row = db
      .select({ stats: messageTable.stats, topicId: messageTable.topicId })
      .from(messageTable)
      .where(eq(messageTable.id, ref.id))
      .get()
    if (!row) return null
    const nextStats = mergeMessageUsageProjection(row.stats, projection)
    const changed = !isDeepStrictEqual(row.stats, nextStats)
    if (changed) db.update(messageTable).set({ stats: nextStats }).where(eq(messageTable.id, ref.id)).run()
    return { changed, target: { ...ref, containerId: row.topicId } }
  } else {
    const row = db
      .select({ stats: agentSessionMessageTable.stats, sessionId: agentSessionMessageTable.sessionId })
      .from(agentSessionMessageTable)
      .where(eq(agentSessionMessageTable.id, ref.id))
      .get()
    if (!row) return null
    const nextStats = mergeMessageUsageProjection(row.stats, projection)
    const changed = !isDeepStrictEqual(row.stats, nextStats)
    if (changed) {
      db.update(agentSessionMessageTable).set({ stats: nextStats }).where(eq(agentSessionMessageTable.id, ref.id)).run()
    }
    return { changed, target: { ...ref, containerId: row.sessionId } }
  }
}

const logger = loggerService.withContext('DataApi:AiUsageRecordService')

const AI_USAGE_RECORD_READ_MODEL_CHANGES = [
  { endpoint: '/ai-usage-records', kind: 'membership' },
  { endpoint: '/ai-usage-records/stats' },
  { endpoint: '/ai-usage-records/timeline' }
] satisfies DataApiDataChangeEffect[]

function optionalCount(value: number | undefined, field: string): number | null {
  if (value === undefined) return null
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${field} must be a nonnegative safe integer`)
  }
  return value
}

function requiredCount(value: number, field: string): number {
  const validated = optionalCount(value, field)
  if (validated === null) throw new Error(`${field} is required`)
  if (validated === 0) throw new Error(`${field} must be positive`)
  return validated
}

function requiredTimestamp(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${field} must be a nonnegative safe integer`)
  }
  return value
}

function requiredAmount(value: number, field: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${field} must be a nonnegative finite number`)
  }
  return value
}

function validatedBreakdown(breakdown: AiUsageCostBreakdown | undefined, field: string): AiUsageCostBreakdown | null {
  if (!breakdown) return null
  for (const [bucket, value] of Object.entries(breakdown)) {
    requiredAmount(value, `${field}.${bucket}`)
  }
  return structuredClone(breakdown)
}

function computedCost(
  input: RecordAiInvocationInput,
  pricing: AiUsagePricingSnapshot | null
): { amount: number; breakdown: AiUsageCostBreakdown } | undefined {
  if (!pricing) return undefined

  if (input.modality === 'image') {
    if (!pricing.perImage || pricing.perImage.unit !== 'image' || input.imageCount === undefined) return undefined
    const amount = input.imageCount * pricing.perImage.price
    return { amount, breakdown: { image: amount } }
  }
  if (input.modality === 'rerank') return undefined

  const usage = input.usage
  if (!usage) return undefined
  const computed = computeLanguageCost(
    {
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      inputTokenDetails: {
        noCacheTokens: usage.noCacheTokens,
        cacheReadTokens: usage.cacheReadTokens,
        cacheWriteTokens: usage.cacheWriteTokens
      }
    },
    pricing
  )
  return computed ? { amount: computed.cost, breakdown: computed.breakdown } : undefined
}

function completeProviderBreakdown(
  amount: number,
  breakdown: AiUsageCostBreakdown | undefined
): AiUsageCostBreakdown | null {
  if (!breakdown) return null
  const values = Object.values(breakdown)
  if (values.length === 0 || values.some((value) => !Number.isFinite(value) || value < 0)) return null
  const sum = values.reduce((total, value) => total + value, 0)
  return Math.abs(sum - amount) <= Math.max(1e-9, Math.abs(amount) * 1e-9) ? structuredClone(breakdown) : null
}

function invocationToRow(input: RecordAiInvocationInput): InsertAiUsageRecordRow {
  const { context, usage, metrics } = input
  const providerCost =
    context.trustProviderReportedCost &&
    input.providerCost &&
    Number.isFinite(input.providerCost.amount) &&
    input.providerCost.amount >= 0
      ? input.providerCost
      : undefined
  const localCost = providerCost ? undefined : computedCost(input, context.pricingSnapshot)
  const cost = providerCost?.amount ?? localCost?.amount
  const credential = context.credentialReceipt

  return {
    requestId: input.requestId,
    recordKind: 'invocation',
    requestCount: 1,
    messageKind: context.messageRef?.kind ?? null,
    messageId: context.messageRef?.id ?? null,
    providerId: context.providerId,
    providerName: context.providerName,
    modelId: context.modelId,
    modelName: context.modelName,
    sourceType: context.source?.type ?? null,
    sourceId: context.source?.id ?? null,
    sourceName: context.source?.name ?? null,
    sourceIcon: context.source?.icon ?? null,
    modality: input.modality,
    apiKeyId: credential.attribution === 'explicit' || credential.attribution === 'matched' ? credential.id : null,
    apiKeyLabel:
      credential.attribution === 'explicit' || credential.attribution === 'matched' ? (credential.label ?? null) : null,
    apiKeyMasked:
      credential.attribution === 'explicit' || credential.attribution === 'matched' ? credential.masked : null,
    apiKeyAttribution: credential.attribution,
    authMethod: credential.attribution === 'auth' ? credential.method : null,
    inputTokens: optionalCount(usage?.inputTokens, 'inputTokens'),
    outputTokens: optionalCount(usage?.outputTokens, 'outputTokens'),
    totalTokens: optionalCount(usage?.totalTokens, 'totalTokens'),
    reasoningTokens: optionalCount(usage?.reasoningTokens, 'reasoningTokens'),
    noCacheTokens: optionalCount(usage?.noCacheTokens, 'noCacheTokens'),
    cacheReadTokens: optionalCount(usage?.cacheReadTokens, 'cacheReadTokens'),
    cacheWriteTokens: optionalCount(usage?.cacheWriteTokens, 'cacheWriteTokens'),
    imageCount: input.modality === 'image' ? optionalCount(input.imageCount ?? 0, 'imageCount') : null,
    cost: cost ?? null,
    costCurrency: providerCost?.currency ?? (localCost ? context.pricingSnapshot?.currency : null) ?? null,
    costSource: providerCost ? 'provider' : localCost ? 'computed' : null,
    costBreakdown: providerCost
      ? completeProviderBreakdown(providerCost.amount, providerCost.breakdown)
      : (localCost?.breakdown ?? null),
    pricingSnapshot: context.pricingSnapshot,
    timeFirstTokenMs: optionalCount(metrics?.timeFirstTokenMs, 'timeFirstTokenMs'),
    timeCompletionMs: optionalCount(metrics?.timeCompletionMs, 'timeCompletionMs'),
    timeThinkingMs: optionalCount(metrics?.timeThinkingMs, 'timeThinkingMs'),
    createdAt: requiredTimestamp(input.completedAt, 'completedAt')
  }
}

function legacyToRow(input: LegacyAggregateInput): InsertAiUsageRecordRow {
  const legacyCost = input.cost
    ? {
        amount: requiredAmount(input.cost.amount, 'cost.amount'),
        currency: input.cost.currency,
        source: input.cost.source,
        breakdown: validatedBreakdown(input.cost.breakdown, 'cost.breakdown'),
        pricingSnapshot: input.cost.pricingSnapshot ? structuredClone(input.cost.pricingSnapshot) : null
      }
    : null

  return {
    requestId: input.requestId,
    recordKind: 'legacy-aggregate',
    requestCount: requiredCount(input.requestCount, 'requestCount'),
    messageKind: input.messageRef.kind,
    messageId: input.messageRef.id,
    providerId: input.providerId ?? null,
    providerName: input.providerName ?? null,
    modelId: input.modelId ?? null,
    modelName: input.modelName ?? null,
    sourceType: input.source?.type ?? null,
    sourceId: input.source?.id ?? null,
    sourceName: input.source?.name ?? null,
    sourceIcon: input.source?.icon ?? null,
    modality: input.modality ?? 'language',
    apiKeyId: null,
    apiKeyLabel: null,
    apiKeyMasked: null,
    apiKeyAttribution: 'unknown',
    authMethod: null,
    inputTokens: optionalCount(input.usage?.inputTokens, 'inputTokens'),
    outputTokens: optionalCount(input.usage?.outputTokens, 'outputTokens'),
    totalTokens: optionalCount(input.usage?.totalTokens, 'totalTokens'),
    reasoningTokens: optionalCount(input.usage?.reasoningTokens, 'reasoningTokens'),
    noCacheTokens: optionalCount(input.usage?.noCacheTokens, 'noCacheTokens'),
    cacheReadTokens: optionalCount(input.usage?.cacheReadTokens, 'cacheReadTokens'),
    cacheWriteTokens: optionalCount(input.usage?.cacheWriteTokens, 'cacheWriteTokens'),
    imageCount: input.modality === 'image' ? 0 : null,
    cost: legacyCost?.amount ?? null,
    costCurrency: legacyCost?.currency ?? null,
    costSource: legacyCost?.source ?? null,
    costBreakdown: legacyCost?.breakdown ?? null,
    pricingSnapshot: legacyCost?.pricingSnapshot ?? null,
    timeFirstTokenMs: null,
    timeCompletionMs: null,
    timeThinkingMs: null,
    createdAt: requiredTimestamp(input.createdAt, 'createdAt')
  }
}

function comparableRow(row: InsertAiUsageRecordRow): Omit<InsertAiUsageRecordRow, 'id'> {
  const comparable = { ...row }
  delete comparable.id
  return comparable
}

function insertRowsTx(
  db: DbOrTx,
  rows: readonly InsertAiUsageRecordRow[],
  warnOnConflict: boolean
): { inserted: number; affectedMessages: MessageReadModelTarget[] } {
  let inserted = 0
  const affectedMessages = new Map<string, MessageRef>()
  for (const row of rows) {
    if (row.messageKind && row.messageId) {
      const ref = { kind: row.messageKind, id: row.messageId }
      affectedMessages.set(`${ref.kind}:${ref.id}`, ref)
    }
    const result = db.insert(aiUsageRecordTable).values(row).onConflictDoNothing().run()
    if (result.changes === 0) {
      if (warnOnConflict) {
        const existing = db
          .select()
          .from(aiUsageRecordTable)
          .where(eq(aiUsageRecordTable.requestId, row.requestId))
          .get()
        if (existing && !isDeepStrictEqual(comparableRow(existing), comparableRow(row))) {
          logger.warn('duplicate requestId has a different immutable payload', { requestId: row.requestId })
        }
      }
      continue
    }
    inserted += 1
  }

  const affectedReadModels = [...affectedMessages.values()].flatMap((ref) => {
    const rebuilt = rebuildMessageUsageProjectionTx(db, ref)
    return rebuilt ? [rebuilt.target] : []
  })
  return { inserted, affectedMessages: affectedReadModels }
}

function messageReadModelEffects(refs: readonly MessageReadModelTarget[]): DataApiDataChangeEffect[] {
  const chatIds = refs.filter((ref) => ref.kind === 'chat').map((ref) => ref.id)
  const agentIds = refs.filter((ref) => ref.kind === 'agent-session').map((ref) => ref.id)
  const chatIdsByTopic = new Map<string, string[]>()
  const agentIdsBySession = new Map<string, string[]>()
  for (const ref of refs) {
    const idsByContainer = ref.kind === 'chat' ? chatIdsByTopic : agentIdsBySession
    const ids = idsByContainer.get(ref.containerId) ?? []
    ids.push(ref.id)
    idsByContainer.set(ref.containerId, ids)
  }
  return [
    ...[...chatIdsByTopic].map(
      ([topicId, entityIds]) =>
        ({
          endpoint: '/topics/:topicId/messages',
          kind: 'projection',
          routeParams: { topicId },
          entityIds
        }) as const
    ),
    ...(chatIds.length > 0 ? [{ endpoint: '/messages/:id', entityIds: chatIds } as const] : []),
    ...[...agentIdsBySession].map(
      ([sessionId, entityIds]) =>
        ({
          endpoint: '/agent-sessions/:sessionId/messages',
          kind: 'projection',
          routeParams: { sessionId },
          entityIds
        }) as const
    ),
    ...(agentIds.length > 0
      ? [{ endpoint: '/agent-sessions/:sessionId/messages/:messageId', entityIds: agentIds } as const]
      : [])
  ]
}

export class AiUsageRecordService {
  recordInvocation(input: RecordAiInvocationInput): void {
    this.recordInvocations([input])
  }

  recordInvocations(inputs: readonly RecordAiInvocationInput[]): void {
    if (inputs.length === 0) return
    try {
      const result = application
        .get('DbService')
        .withWriteTx((tx) => insertRowsTx(tx, inputs.map(invocationToRow), true))
      if (result.inserted === 0) return
      notifyDataApiDataChange([
        ...AI_USAGE_RECORD_READ_MODEL_CHANGES,
        ...messageReadModelEffects(result.affectedMessages)
      ])
    } catch (err) {
      logger.error('recordInvocations failed', err as Error, { requestIds: inputs.map((input) => input.requestId) })
    }
  }

  getMessageUsageProjection(ref: MessageRef): MessageUsageProjection {
    return getMessageUsageProjectionTx(application.get('DbService').getDb(), ref)
  }

  refreshMessageProjection(ref: MessageRef): void {
    try {
      const rebuilt = application.get('DbService').withWriteTx((tx) => rebuildMessageUsageProjectionTx(tx, ref))
      if (rebuilt?.changed) notifyDataApiDataChange(messageReadModelEffects([rebuilt.target]))
    } catch (err) {
      logger.error('refreshMessageProjection failed', err as Error, ref)
    }
  }

  recordLegacyAggregatesTx(db: DbOrTx, inputs: readonly LegacyAggregateInput[]): number {
    return insertRowsTx(db, inputs.map(legacyToRow), false).inserted
  }

  list(query: AiUsageRecordListServiceQuery): AiUsageRecordListResponse {
    return listAiUsageRecords(query)
  }

  stats(query: AiUsageRecordStatsQuery): AiUsageRecordStatsResponse {
    return getAiUsageRecordStats(query)
  }

  timeline(query: AiUsageRecordTimelineQuery): AiUsageRecordTimelineResponse {
    return getAiUsageRecordTimeline(query)
  }
}

export const aiUsageRecordService = new AiUsageRecordService()
