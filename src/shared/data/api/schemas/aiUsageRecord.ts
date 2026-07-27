/**
 * Read-only DataApi contracts for best-effort AI usage records.
 */

import * as z from 'zod'

import { type AiUsageRecordAttribution, type AiUsageRecordEntry } from '../../types/aiUsageRecord'
import { CURRENCY, type Currency, objectValues } from '../../types/model'
import type { CursorPaginationParams, CursorPaginationResponse } from '../types'

export const AI_USAGE_RECORD_DEFAULT_LIMIT = 50
export const AI_USAGE_RECORD_MAX_LIMIT = 200
export const AI_USAGE_RECORD_AGGREGATE_DEFAULT_LIMIT = 10
export const AI_USAGE_RECORD_AGGREGATE_MAX_LIMIT = 50
export const AI_USAGE_RECORD_MAX_RANGE_DAYS = 366

const CurrencySchema = z.enum(objectValues(CURRENCY))
const TimeRangeFields = {
  from: z.number().int().nonnegative(),
  to: z.number().int().nonnegative()
}

function validateTimeRange(value: { from: number; to: number }, ctx: z.RefinementCtx): void {
  if (value.to < value.from) {
    ctx.addIssue({ code: 'custom', path: ['to'], message: 'to must be greater than or equal to from' })
    return
  }

  const maxRangeMs = AI_USAGE_RECORD_MAX_RANGE_DAYS * 24 * 60 * 60 * 1000
  if (value.to - value.from > maxRangeMs) {
    ctx.addIssue({
      code: 'custom',
      path: ['to'],
      message: `time range must not exceed ${AI_USAGE_RECORD_MAX_RANGE_DAYS} days`
    })
  }
}

export const AiUsageRecordListSortBySchema = z.enum([
  'createdAt',
  'totalTokens',
  'cost',
  'timeFirstTokenMs',
  'tokensPerSecond'
])
export type AiUsageRecordListSortBy = z.infer<typeof AiUsageRecordListSortBySchema>
export const AiUsageRecordSortOrderSchema = z.enum(['asc', 'desc'])
export type AiUsageRecordSortOrder = z.infer<typeof AiUsageRecordSortOrderSchema>

export const AiUsageRecordListQuerySchema = z
  .strictObject({
    cursor: z.string().optional(),
    limit: z.int().positive().max(AI_USAGE_RECORD_MAX_LIMIT).default(AI_USAGE_RECORD_DEFAULT_LIMIT),
    sortBy: AiUsageRecordListSortBySchema.default('createdAt'),
    sortOrder: AiUsageRecordSortOrderSchema.default('desc'),
    from: z.number().int().nonnegative().optional(),
    to: z.number().int().nonnegative().optional(),
    /** Required when sorting monetary values so unlike currencies never compete. */
    costCurrency: CurrencySchema.optional()
  })
  .superRefine((value, ctx) => {
    if (value.sortBy === 'cost' && value.costCurrency === undefined) {
      ctx.addIssue({ code: 'custom', path: ['costCurrency'], message: 'costCurrency is required for cost sorting' })
    }
  })
export type AiUsageRecordListQuery = z.infer<typeof AiUsageRecordListQuerySchema>
export type AiUsageRecordListQueryParams = z.input<typeof AiUsageRecordListQuerySchema> & CursorPaginationParams

export const AiUsageRecordGroupBySchema = z.enum(['provider', 'apiKey', 'model', 'source'])
export type AiUsageRecordGroupBy = z.infer<typeof AiUsageRecordGroupBySchema>
export const AiUsageRecordMetricSchema = z.enum(['tokens', 'requests', 'cost'])
export type AiUsageRecordMetric = z.infer<typeof AiUsageRecordMetricSchema>

const AggregateQueryFields = {
  metric: AiUsageRecordMetricSchema.default('tokens'),
  currency: CurrencySchema.optional(),
  limit: z.int().positive().max(AI_USAGE_RECORD_AGGREGATE_MAX_LIMIT).default(AI_USAGE_RECORD_AGGREGATE_DEFAULT_LIMIT),
  ...TimeRangeFields
}

function validateAggregateQuery(
  value: { metric: AiUsageRecordMetric; currency?: Currency; from: number; to: number },
  ctx: z.RefinementCtx
): void {
  validateTimeRange(value, ctx)
  if (value.metric === 'cost' && value.currency === undefined) {
    ctx.addIssue({ code: 'custom', path: ['currency'], message: 'currency is required for cost aggregation' })
  }
}

export const AiUsageRecordStatsQuerySchema = z
  .strictObject({
    groupBy: AiUsageRecordGroupBySchema,
    ...AggregateQueryFields
  })
  .superRefine(validateAggregateQuery)
export type AiUsageRecordStatsQuery = z.infer<typeof AiUsageRecordStatsQuerySchema>

export const AiUsageRecordTimelineQuerySchema = z
  .strictObject({
    groupBy: AiUsageRecordGroupBySchema.optional(),
    ...AggregateQueryFields
  })
  .superRefine(validateAggregateQuery)
export type AiUsageRecordTimelineQuery = z.infer<typeof AiUsageRecordTimelineQuerySchema>

export interface AiUsageRecordListResponse extends CursorPaginationResponse<AiUsageRecordEntry> {
  total: number
}

export interface AiUsageRecordGroupIdentity {
  providerId?: string
  providerName?: string | null
  sourceType?: AiUsageRecordEntry['sourceType']
  sourceId?: string | null
  sourceName?: string | null
  sourceIcon?: string | null
  apiKeyId?: string | null
  apiKeyLabel?: string | null
  apiKeyMasked?: string | null
  apiKeyAttribution?: AiUsageRecordAttribution
  modelId?: string | null
}

export type AiUsageRecordStatsGroupIdentity =
  | {
      groupBy: 'provider'
      providerId: string
      providerName: string | null
    }
  | {
      groupBy: 'apiKey'
      providerId: string
      providerName: string | null
      apiKeyId: string | null
      apiKeyLabel: string | null
      apiKeyMasked: string | null
      apiKeyAttribution: AiUsageRecordAttribution
    }
  | {
      groupBy: 'model'
      providerId: string
      providerName: string | null
      modelId: string
    }
  | {
      groupBy: 'source'
      sourceType: AiUsageRecordEntry['sourceType']
      sourceId: string | null
      sourceName: string | null
      sourceIcon: string | null
    }

export interface AiUsageRecordStatsMetrics {
  costCurrency: Currency | null
  totalCost: number
  totalInputTokens: number
  totalOutputTokens: number
  totalTokens: number
  totalNoCacheTokens: number
  totalCacheReadTokens: number
  totalCacheWriteTokens: number
  entryCount: number
}

export type AiUsageRecordStatsBucket = AiUsageRecordStatsGroupIdentity & AiUsageRecordStatsMetrics

export interface AiUsageRecordStatsResponse {
  /** Server-ranked top-N groups. */
  buckets: AiUsageRecordStatsBucket[]
  /** Full-range totals, independent of the top-N limit. */
  totals: AiUsageRecordStatsMetrics
  /** Full totals minus the returned top-N groups. */
  other: AiUsageRecordStatsMetrics
}

export interface AiUsageRecordTimelineBucket extends AiUsageRecordGroupIdentity {
  date: string
  costCurrency: Currency | null
  totalTokens: number
  totalNoCacheTokens: number
  totalCacheReadTokens: number
  totalCacheWriteTokens: number
  totalCost: number
  entryCount: number
  /** Aggregate of every group outside the server-ranked top-N. */
  isOther?: true
}

export interface AiUsageRecordCostTotal {
  currency: Currency
  total: number
}

export interface AiUsageRecordDailyCost extends AiUsageRecordCostTotal {
  date: string
}

export interface AiUsageRecordTimelineResponse {
  buckets: AiUsageRecordTimelineBucket[]
  costTotals: AiUsageRecordCostTotal[]
  /** Bounded by the validated day range and the closed currency enum. */
  dailyCosts: AiUsageRecordDailyCost[]
}

export type AiUsageRecordSchemas = {
  '/ai-usage-records': {
    GET: {
      query?: AiUsageRecordListQueryParams
      response: AiUsageRecordListResponse
    }
  }
  '/ai-usage-records/stats': {
    GET: {
      query: AiUsageRecordStatsQuery
      response: AiUsageRecordStatsResponse
    }
  }
  '/ai-usage-records/timeline': {
    GET: {
      query: AiUsageRecordTimelineQuery
      response: AiUsageRecordTimelineResponse
    }
  }
}
