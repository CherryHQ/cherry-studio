/**
 * Translate API Schema definitions
 *
 * Contains endpoints for:
 * - Translate history CRUD with pagination/search/star filtering
 * - Translate language CRUD (builtin + user-defined)
 *
 * Entity schemas and types live in `@shared/data/types/translate`.
 */

import { PersistedLangCodeSchema } from '@shared/data/preference/preferenceTypes'
import * as z from 'zod'

import type { TranslateHistory, TranslateLanguage } from '../../types/translate'
import type { OffsetPaginationResponse } from '../apiTypes'

// ============================================================================
// Translate History DTOs & Query
// ============================================================================

export const CreateTranslateHistorySchema = z.object({
  /** Non-empty string */
  sourceText: z.string().min(1),
  /** Non-empty string */
  targetText: z.string().min(1),
  /** Required, must match PersistedLangCodeSchema — the `'unknown'` UI sentinel is rejected. */
  sourceLanguage: PersistedLangCodeSchema,
  /** Required, must match PersistedLangCodeSchema — the `'unknown'` UI sentinel is rejected. */
  targetLanguage: PersistedLangCodeSchema
})
/** DTO for creating a translate history record. */
export type CreateTranslateHistoryDto = z.infer<typeof CreateTranslateHistorySchema>

export const UpdateTranslateHistorySchema = z
  .object({
    /** Non-empty string if provided */
    sourceText: z.string().min(1).optional(),
    /** Non-empty string if provided */
    targetText: z.string().min(1).optional(),
    /** Must match PersistedLangCodeSchema if provided — the `'unknown'` UI sentinel is rejected. */
    sourceLanguage: PersistedLangCodeSchema.optional(),
    /** Must match PersistedLangCodeSchema if provided — the `'unknown'` UI sentinel is rejected. */
    targetLanguage: PersistedLangCodeSchema.optional(),
    /** Boolean if provided */
    star: z.boolean().optional()
  })
  .strict()
/**
 * DTO for updating a translate history record. All fields optional. Uses
 * `.strict()` — unknown fields (including `id`/`createdAt`) are rejected
 * rather than silently stripped, matching `UpdateTranslateLanguageSchema`.
 */
export type UpdateTranslateHistoryDto = z.infer<typeof UpdateTranslateHistorySchema>

export const TRANSLATE_HISTORY_DEFAULT_PAGE = 1
export const TRANSLATE_HISTORY_DEFAULT_LIMIT = 20
export const TRANSLATE_HISTORY_MAX_LIMIT = 100

export const TranslateHistoryQuerySchema = z.object({
  /** Positive integer, defaults to {@link TRANSLATE_HISTORY_DEFAULT_PAGE} */
  page: z.int().positive().default(TRANSLATE_HISTORY_DEFAULT_PAGE),
  /** Positive integer, max {@link TRANSLATE_HISTORY_MAX_LIMIT}, defaults to {@link TRANSLATE_HISTORY_DEFAULT_LIMIT} */
  limit: z.int().positive().max(TRANSLATE_HISTORY_MAX_LIMIT).default(TRANSLATE_HISTORY_DEFAULT_LIMIT),
  /** LIKE search on sourceText and targetText (wildcards are escaped) */
  search: z.string().optional(),
  /** Filter by starred status */
  star: z.boolean().optional()
})
/** Query parameters for listing translate histories. */
export type TranslateHistoryQuery = z.infer<typeof TranslateHistoryQuerySchema>

// ============================================================================
// Translate Language DTOs
// ============================================================================

export const CreateTranslateLanguageSchema = z.object({
  /** Becomes the PK, immutable after creation. Normalized to lowercase before insert. */
  langCode: PersistedLangCodeSchema,
  /** Display name, non-empty */
  value: z.string().min(1),
  /** Flag emoji */
  emoji: z.emoji()
})
/** DTO for creating a translate language. */
export type CreateTranslateLanguageDto = z.infer<typeof CreateTranslateLanguageSchema>

export const UpdateTranslateLanguageSchema = z
  .object({
    /** Display name, non-empty if provided */
    value: z.string().min(1).optional(),
    /** Flag emoji if provided */
    emoji: z.emoji().optional()
  })
  .strict()
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
