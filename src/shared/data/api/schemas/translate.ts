/**
 * Translate API Schema definitions
 *
 * Contains endpoints for:
 * - Translate history CRUD with pagination/search/star filtering
 * - Translate language CRUD (builtin + user-defined)
 *
 * Entity schemas and types live in `@shared/data/types/translate`.
 */

import * as z from 'zod'

import {
  type TranslateHistory,
  TranslateHistorySchema,
  type TranslateLanguage,
  TranslateLanguageSchema
} from '../../types/translate'
import type { OffsetPaginationResponse } from '../apiTypes'

// ============================================================================
// Translate History DTOs & Query
// ============================================================================

export const CreateTranslateHistorySchema = TranslateHistorySchema.pick({
  sourceText: true,
  targetText: true,
  sourceLanguage: true,
  targetLanguage: true
})
/**
 * DTO for creating a translate history record. Uses `.strict()` — unknown
 * fields (including server-managed `id`/`createdAt`/`updatedAt`/`star`) are
 * rejected rather than silently stripped, matching `UpdateTranslateHistorySchema`.
 */
export type CreateTranslateHistoryDto = z.infer<typeof CreateTranslateHistorySchema>

export const UpdateTranslateHistorySchema = TranslateHistorySchema.pick({
  sourceText: true,
  targetText: true,
  sourceLanguage: true,
  targetLanguage: true,
  star: true
}).partial()
/**
 * DTO for updating a translate history record. All fields optional. Uses
 * `.strict()` — unknown fields (including `id`/`createdAt`) are rejected
 * rather than silently stripped, matching `UpdateTranslateLanguageSchema`.
 */
export type UpdateTranslateHistoryDto = z.infer<typeof UpdateTranslateHistorySchema>

export const TRANSLATE_HISTORY_DEFAULT_PAGE = 1
export const TRANSLATE_HISTORY_DEFAULT_LIMIT = 20
export const TRANSLATE_HISTORY_MAX_LIMIT = 100
export const TRANSLATE_HISTORY_SEARCH_MAX_LENGTH = 200

export const TranslateHistoryQuerySchema = z.object({
  /** Positive integer, defaults to {@link TRANSLATE_HISTORY_DEFAULT_PAGE} */
  page: z.int().positive().default(TRANSLATE_HISTORY_DEFAULT_PAGE),
  /** Positive integer, max {@link TRANSLATE_HISTORY_MAX_LIMIT}, defaults to {@link TRANSLATE_HISTORY_DEFAULT_LIMIT} */
  limit: z.int().positive().max(TRANSLATE_HISTORY_MAX_LIMIT).default(TRANSLATE_HISTORY_DEFAULT_LIMIT),
  /**
   * LIKE search on sourceText and targetText (wildcards are escaped).
   * Bounded `[1, TRANSLATE_HISTORY_SEARCH_MAX_LENGTH]` so an empty value can't
   * widen the query to `LIKE '%%'` (effectively returning everything) and an
   * unbounded value can't be used to push expensive scans.
   */
  search: z.string().min(1).max(TRANSLATE_HISTORY_SEARCH_MAX_LENGTH).optional(),
  /** Filter by starred status */
  star: z.boolean().optional()
})
/** Query parameters for listing translate histories. */
export type TranslateHistoryQuery = z.infer<typeof TranslateHistoryQuerySchema>

// ============================================================================
// Translate Language DTOs
// ============================================================================

export const CreateTranslateLanguageSchema = TranslateLanguageSchema.pick({
  langCode: true,
  value: true,
  emoji: true
})
/**
 * DTO for creating a translate language. Uses `.strict()` — unknown fields
 * are rejected rather than silently stripped, matching `UpdateTranslateLanguageSchema`.
 */
export type CreateTranslateLanguageDto = z.infer<typeof CreateTranslateLanguageSchema>

export const UpdateTranslateLanguageSchema = TranslateLanguageSchema.pick({
  value: true,
  emoji: true
}).partial()
/**
 * DTO for updating a translate language. Uses `.strict()` — unknown fields
 * (including `langCode`) are rejected, not silently stripped.
 */
export type UpdateTranslateLanguageDto = z.infer<typeof UpdateTranslateLanguageSchema>

// ============================================================================
// API Schema Definitions
// ============================================================================

export type TranslateSchemas = {
  '/translate/histories': {
    /** List translate histories with pagination, search, and star filter */
    GET: {
      query?: TranslateHistoryQuery
      response: OffsetPaginationResponse<TranslateHistory>
    }
    /** Create a new translate history record */
    POST: {
      body: CreateTranslateHistoryDto
      response: TranslateHistory
    }
    /** Clear all translate histories */
    DELETE: {
      response: void
    }
  }

  '/translate/histories/:id': {
    /** Get a translate history by ID */
    GET: {
      params: { id: string }
      response: TranslateHistory
    }
    /** Update a translate history */
    PATCH: {
      params: { id: string }
      body: UpdateTranslateHistoryDto
      response: TranslateHistory
    }
    /** Delete a translate history */
    DELETE: {
      params: { id: string }
      response: void
    }
  }

  '/translate/languages': {
    /** List all translate languages */
    GET: {
      response: TranslateLanguage[]
    }
    /** Create a new translate language */
    POST: {
      body: CreateTranslateLanguageDto
      response: TranslateLanguage
    }
  }

  '/translate/languages/:langCode': {
    /** Get a translate language by langCode */
    GET: {
      params: { langCode: string }
      response: TranslateLanguage
    }
    /** Update a translate language (value/emoji only, langCode is immutable) */
    PATCH: {
      params: { langCode: string }
      body: UpdateTranslateLanguageDto
      response: TranslateLanguage
    }
    /** Delete a translate language */
    DELETE: {
      params: { langCode: string }
      response: void
    }
  }
}
