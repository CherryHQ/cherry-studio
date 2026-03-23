/**
 * Translate API Schema definitions
 *
 * Contains endpoints for:
 * - Translate history CRUD with pagination/search/star filtering
 * - Translate language CRUD (builtin + user-defined)
 */

import * as z from 'zod'

import type { OffsetPaginationResponse } from '../apiTypes'

/** Language code pattern: e.g. "en-us", "zh-cn", "ja-jp" */
export const LangCodeSchema = z.string().regex(/^[a-z]{2,3}(-[a-z]{2,4})?$/)

// ============================================================================
// Translate History Types
// ============================================================================

export const TranslateHistorySchema = z.object({
  id: z.uuid(),
  sourceText: z.string().min(1),
  targetText: z.string().min(1),
  sourceLanguage: LangCodeSchema.nullable(),
  targetLanguage: LangCodeSchema.nullable(),
  star: z.boolean(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime()
})
export type TranslateHistory = z.infer<typeof TranslateHistorySchema>

export const CreateTranslateHistorySchema = z.object({
  sourceText: z.string().min(1),
  targetText: z.string().min(1),
  sourceLanguage: LangCodeSchema,
  targetLanguage: LangCodeSchema
})
export type CreateTranslateHistoryDto = z.infer<typeof CreateTranslateHistorySchema>

export const UpdateTranslateHistorySchema = z.object({
  sourceText: z.string().min(1).optional(),
  targetText: z.string().min(1).optional(),
  sourceLanguage: LangCodeSchema.optional(),
  targetLanguage: LangCodeSchema.optional(),
  star: z.boolean().optional()
})
export type UpdateTranslateHistoryDto = z.infer<typeof UpdateTranslateHistorySchema>

export const TranslateHistoryQuerySchema = z.object({
  page: z.number().int().positive().optional(),
  limit: z.number().int().positive().max(100).optional(),
  search: z.string().optional(),
  star: z.boolean().optional()
})
export type TranslateHistoryQuery = z.infer<typeof TranslateHistoryQuerySchema>

// ============================================================================
// Translate Language Types
// ============================================================================

export const TranslateLanguageSchema = z.object({
  langCode: LangCodeSchema,
  value: z.string().min(1),
  emoji: z.string().min(1),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime()
})
export type TranslateLanguage = z.infer<typeof TranslateLanguageSchema>

export const CreateTranslateLanguageSchema = z.object({
  langCode: LangCodeSchema,
  value: z.string().min(1),
  emoji: z.string().min(1)
})
export type CreateTranslateLanguageDto = z.infer<typeof CreateTranslateLanguageSchema>

export const UpdateTranslateLanguageSchema = z
  .object({
    value: z.string().min(1).optional(),
    emoji: z.string().min(1).optional()
  })
  .strict()
export type UpdateTranslateLanguageDto = z.infer<typeof UpdateTranslateLanguageSchema>

// ============================================================================
// API Schema Definitions
// ============================================================================

export interface TranslateSchemas {
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
