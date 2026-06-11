/**
 * Usage Ledger API Schema definitions
 *
 * Read-only endpoints — ledger rows are written internally by the main
 * process (`UsageLedgerService.recordFromMessage`, fired from
 * `MessageService.update`), never by the renderer.
 *
 * Contains endpoints for:
 * - Listing ledger entries with cursor pagination and provider/key/time filters
 * - Aggregated usage/cost rollups grouped by provider, API key, or model
 *
 * Entity schemas and types live in `@shared/data/types/usageLedger`.
 */

import * as z from 'zod'

import { type UsageLedgerAttribution, type UsageLedgerEntry } from '../../types/usageLedger'
import type { CursorPaginationParams, CursorPaginationResponse } from '../apiTypes'

// ============================================================================
// Query schemas
// ============================================================================

export const USAGE_LEDGER_DEFAULT_LIMIT = 50
export const USAGE_LEDGER_MAX_LIMIT = 200

const TimeRangeFields = {
  /** Inclusive lower bound on createdAt (epoch milliseconds) */
  from: z.number().int().nonnegative().optional(),
  /** Inclusive upper bound on createdAt (epoch milliseconds) */
  to: z.number().int().nonnegative().optional()
}

export const UsageLedgerListQuerySchema = z
  .object({
    /** Cursor returned by the previous page. Omitted for the first page. */
    cursor: z.string().optional(),
    /** Positive integer, max {@link USAGE_LEDGER_MAX_LIMIT}, defaults to {@link USAGE_LEDGER_DEFAULT_LIMIT} */
    limit: z.int().positive().max(USAGE_LEDGER_MAX_LIMIT).default(USAGE_LEDGER_DEFAULT_LIMIT),
    /** Filter by provider id */
    providerId: z.string().optional(),
    /** Filter by attributed API key id */
    apiKeyId: z.string().optional(),
    ...TimeRangeFields
  })
  .strict()
/** Parsed query parameters for listing usage ledger entries. */
export type UsageLedgerListQuery = z.infer<typeof UsageLedgerListQuerySchema>
/** Input query parameters accepted by the API before schema defaults are applied. */
export type UsageLedgerListQueryParams = z.input<typeof UsageLedgerListQuerySchema> & CursorPaginationParams

export const UsageLedgerStatsQuerySchema = z
  .object({
    /** Aggregation dimension */
    groupBy: z.enum(['provider', 'apiKey', 'model']),
    /** Restrict aggregation to one provider */
    providerId: z.string().optional(),
    ...TimeRangeFields
  })
  .strict()
/** Parsed query parameters for usage ledger aggregation. */
export type UsageLedgerStatsQuery = z.infer<typeof UsageLedgerStatsQuerySchema>

// ============================================================================
// Responses
// ============================================================================

export interface UsageLedgerListResponse extends CursorPaginationResponse<UsageLedgerEntry> {
  items: UsageLedgerEntry[]
  total: number
}

/**
 * One aggregation bucket. Group identity fields are populated according to
 * `groupBy` (provider → providerId; apiKey → providerId+apiKey fields;
 * model → providerId+modelId). `costCurrency` always participates in the
 * group key so different currencies are never summed together.
 */
export interface UsageLedgerStatsBucket {
  providerId: string
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
  entryCount: number
}

export interface UsageLedgerStatsResponse {
  buckets: UsageLedgerStatsBucket[]
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
}
