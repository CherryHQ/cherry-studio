/**
 * Usage Ledger API Schema definitions
 *
 * Usage reporting endpoints plus explicit maintenance operations. Normal
 * ledger rows are written internally by the main process; renderer-initiated
 * writes are limited to user-triggered maintenance such as historical cost
 * backfill.
 *
 * Contains endpoints for:
 * - Listing ledger entries with page pagination and provider/key/time filters
 * - Aggregated usage/cost rollups grouped by provider, API key, or model
 *
 * Entity schemas and types live in `@shared/data/types/usageLedger`.
 */

import * as z from 'zod'

import { UniqueModelIdSchema } from '../../types/model'
import { type UsageLedgerAttribution, type UsageLedgerEntry } from '../../types/usageLedger'
import type { OffsetPaginationParams, OffsetPaginationResponse } from '../apiTypes'

// ============================================================================
// Query schemas
// ============================================================================

export const USAGE_LEDGER_DEFAULT_LIMIT = 50
export const USAGE_LEDGER_MAX_LIMIT = 200
export const UsageLedgerListSortBySchema = z.enum([
  'createdAt',
  'totalTokens',
  'cost',
  'timeFirstTokenMs',
  'tokensPerSecond'
])
export type UsageLedgerListSortBy = z.infer<typeof UsageLedgerListSortBySchema>
export const UsageLedgerSortDirectionSchema = z.enum(['asc', 'desc'])
export type UsageLedgerSortDirection = z.infer<typeof UsageLedgerSortDirectionSchema>

const TimeRangeFields = {
  /** Inclusive lower bound on createdAt (epoch milliseconds) */
  from: z.number().int().nonnegative().optional(),
  /** Inclusive upper bound on createdAt (epoch milliseconds) */
  to: z.number().int().nonnegative().optional()
}

export const UsageLedgerListQuerySchema = z
  .object({
    /** Page number (1-based), defaults to 1. */
    page: z.int().positive().default(1),
    /** Positive integer, max {@link USAGE_LEDGER_MAX_LIMIT}, defaults to {@link USAGE_LEDGER_DEFAULT_LIMIT} */
    limit: z.int().positive().max(USAGE_LEDGER_MAX_LIMIT).default(USAGE_LEDGER_DEFAULT_LIMIT),
    /** Filter by provider id */
    providerId: z.string().optional(),
    /** Filter by attributed API key id */
    apiKeyId: z.string().optional(),
    sortBy: UsageLedgerListSortBySchema.default('createdAt'),
    sortDirection: UsageLedgerSortDirectionSchema.default('desc'),
    ...TimeRangeFields
  })
  .strict()
/** Parsed query parameters for listing usage ledger entries. */
export type UsageLedgerListQuery = z.infer<typeof UsageLedgerListQuerySchema>
/** Input query parameters accepted by the API before schema defaults are applied. */
export type UsageLedgerListQueryParams = z.input<typeof UsageLedgerListQuerySchema> & OffsetPaginationParams

export const UsageLedgerStatsQuerySchema = z
  .object({
    /** Aggregation dimension */
    groupBy: z.enum(['provider', 'apiKey', 'model', 'source']),
    /** Restrict aggregation to one provider */
    providerId: z.string().optional(),
    ...TimeRangeFields
  })
  .strict()
/** Parsed query parameters for usage ledger aggregation. */
export type UsageLedgerStatsQuery = z.infer<typeof UsageLedgerStatsQuerySchema>

export const UsageLedgerTimelineQuerySchema = z.object(TimeRangeFields).strict()
/** Parsed query parameters for usage ledger daily timeline. */
export type UsageLedgerTimelineQuery = z.infer<typeof UsageLedgerTimelineQuerySchema>

export const UsageLedgerCostBackfillQuerySchema = z
  .object({
    modelId: UniqueModelIdSchema,
    ...TimeRangeFields
  })
  .strict()
export type UsageLedgerCostBackfillQuery = z.infer<typeof UsageLedgerCostBackfillQuerySchema>

// ============================================================================
// Responses
// ============================================================================

export interface UsageLedgerListResponse extends OffsetPaginationResponse<UsageLedgerEntry> {
  items: UsageLedgerEntry[]
  total: number
  page: number
}

/**
 * One aggregation bucket. Group identity fields are populated according to
 * `groupBy` (provider → providerId; apiKey → providerId+apiKey fields;
 * model → providerId+modelId). `costCurrency` always participates in the
 * group key so different currencies are never summed together.
 */
export interface UsageLedgerStatsBucket {
  providerId: string
  providerName?: string | null
  sourceType?: UsageLedgerEntry['sourceType']
  sourceId?: string | null
  sourceName?: string | null
  sourceIcon?: string | null
  apiKeyId?: string | null
  apiKeyLabel?: string | null
  apiKeyMasked?: string | null
  apiKeyAttribution?: UsageLedgerAttribution
  modelId?: string | null
  costCurrency: string | null
  totalCost: number
  totalInputTokens: number
  totalOutputTokens: number
  totalTokens: number
  totalNoCacheTokens: number
  totalCacheReadTokens: number
  totalCacheWriteTokens: number
  entryCount: number
}

export interface UsageLedgerStatsResponse {
  buckets: UsageLedgerStatsBucket[]
}

export interface UsageLedgerTimelineBucket {
  /** Local calendar date, formatted as YYYY-MM-DD. */
  date: string
  totalTokens: number
  totalNoCacheTokens: number
  totalCacheReadTokens: number
  totalCacheWriteTokens: number
  totalCost: number
  entryCount: number
}

export interface UsageLedgerTimelineResponse {
  buckets: UsageLedgerTimelineBucket[]
}

export interface UsageLedgerCostBackfillCurrencyTotal {
  currency: string
  cost: number
}

export interface UsageLedgerCostBackfillPreviewResponse {
  scannedCount: number
  recalculableCount: number
  skippedNoPricingCount: number
  skippedProviderCostCount: number
  estimatedCostByCurrency: UsageLedgerCostBackfillCurrencyTotal[]
}

export interface UsageLedgerCostBackfillRunResponse extends UsageLedgerCostBackfillPreviewResponse {
  updatedCount: number
}

// ============================================================================
// API Schema Definitions
// ============================================================================

export type UsageLedgerSchemas = {
  '/usage-ledger/entries': {
    /** List usage ledger entries (newest first) with pagination and filters */
    GET: {
      query?: UsageLedgerListQueryParams
      response: UsageLedgerListResponse
    }
  }

  '/usage-ledger/stats': {
    /** Aggregate usage/cost grouped by provider, API key, or model */
    GET: {
      query: UsageLedgerStatsQuery
      response: UsageLedgerStatsResponse
    }
  }

  '/usage-ledger/timeline': {
    /** Aggregate usage/cost into local-calendar daily buckets */
    GET: {
      query?: UsageLedgerTimelineQuery
      response: UsageLedgerTimelineResponse
    }
  }

  '/usage-ledger/cost-backfill/preview': {
    /** Preview historical usage rows whose missing cost can be computed from current pricing */
    GET: {
      query: UsageLedgerCostBackfillQuery
      response: UsageLedgerCostBackfillPreviewResponse
    }
  }

  '/usage-ledger/cost-backfill/run': {
    /** Fill missing historical usage costs using current pricing for one model */
    POST: {
      body: UsageLedgerCostBackfillQuery
      response: UsageLedgerCostBackfillRunResponse
    }
  }
}
