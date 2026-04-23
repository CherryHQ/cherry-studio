/**
 * Translate entity types
 *
 * Defines Zod schemas and inferred types for translate history and language entities.
 * DTO/Query/API schemas live in `@shared/data/api/schemas/translate`.
 */

import * as z from 'zod'

import { PersistedLangCodeSchema } from '../preference/preferenceTypes'

// ============================================================================
// Translate History
// ============================================================================

export const TranslateHistorySchema = z.object({
  /** UUIDv7 (time-ordered), auto-generated */
  id: z.uuidv7(),
  /** Original text, non-empty */
  sourceText: z.string().min(1),
  /** Translated text, non-empty */
  targetText: z.string().min(1),
  /** FK to translate_language.langCode, nullable (SET NULL on language delete).
   *  Uses `PersistedLangCodeSchema` (strict) to match the write-side DTOs —
   *  the `'unknown'` UI sentinel is never written and must not appear here. */
  sourceLanguage: PersistedLangCodeSchema.nullable(),
  /** FK to translate_language.langCode, nullable (SET NULL on language delete).
   *  Uses `PersistedLangCodeSchema` (strict) to match the write-side DTOs —
   *  the `'unknown'` UI sentinel is never written and must not appear here. */
  targetLanguage: PersistedLangCodeSchema.nullable(),
  /** Whether the record is starred */
  star: z.boolean(),
  /** ISO 8601 datetime */
  createdAt: z.iso.datetime(),
  /** ISO 8601 datetime */
  updatedAt: z.iso.datetime()
})
/** Translate history entity. */
export type TranslateHistory = z.infer<typeof TranslateHistorySchema>

// ============================================================================
// Translate Language
// ============================================================================

export const TranslateLanguageSchema = z.object({
  /** PK, immutable, must match PersistedLangCodeSchema (`/^[a-z]{2,3}(-[a-z]{2,4})?$/`).
   *  Persistence-only schema — the `'unknown'` UI sentinel never has a row here. */
  langCode: PersistedLangCodeSchema,
  /** Display name, non-empty (e.g. "English", "Chinese (Simplified)") */
  value: z.string().min(1),
  /** Flag emoji (e.g. "🇬🇧", "🇨🇳") */
  emoji: z.emoji(),
  /** ISO 8601 datetime */
  createdAt: z.iso.datetime(),
  /** ISO 8601 datetime */
  updatedAt: z.iso.datetime()
})
/** Translate language entity. Both builtin and user-created languages share this schema. */
export type TranslateLanguage = z.infer<typeof TranslateLanguageSchema>
