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

export const TranslateHistoryKindSchema = z.enum(['text', 'file'])
/**
 * What a history row's two text columns hold: the translation itself
 * (`'text'`), or the display names of a pair of files (`'file'`).
 *
 * Deliberately NOT the source format. A `'file'` row's format is already
 * recoverable from its `file_entry.ext`, so naming the kind `'pdf'` would both
 * duplicate it and force every consumer that only cares about the row *shape*
 * — the badge, the file cards, open / reveal / save-as — to re-widen to
 * `kind !== 'text'` the day a second format lands. Today the only producer is
 * the layout-preserving PDF flow; a docx/xlsx pipeline would write `'file'`
 * rows too, with no schema or enum change. The one genuinely PDF-specific
 * affordance (reopening the side-by-side preview) gates on the file names
 * instead — see renderer `pages/translate/translationFiles.ts#isPdfTranslation`.
 *
 * A `'file'` row is written ONLY from main, in the same transaction as its
 * `translate_history_file_ref` rows — it is deliberately not reachable through
 * the DataApi POST/PATCH surface, because a refless `'file'` row is not a
 * representable state and a DataApi handler may not touch the filesystem to
 * create the missing entries.
 */
export type TranslateHistoryKind = z.infer<typeof TranslateHistoryKindSchema>

export const TranslateHistorySchema = z.strictObject({
  /** UUIDv7 (time-ordered), auto-generated */
  id: z.uuidv7(),
  /** Whether this row records a text translation or a file one. Immutable. */
  kind: TranslateHistoryKindSchema,
  /**
   * `kind='text'`: the original text.
   * `kind='file'`: the source file's name (e.g. `paper.pdf`) — a display label
   * snapshotted at translation time, not a live reference. The real path lives
   * on the `role='source'` file entry; renaming that entry does not update this
   * column, exactly like a text row does not follow later edits.
   * Non-empty either way, which is what keeps this column NOT NULL.
   */
  sourceText: z.string().min(1),
  /**
   * `kind='text'`: the translated text.
   * `kind='file'`: the translated file's name (e.g. `paper.zh-CN.pdf`).
   *
   * Note for future maintainers: file rows are searchable by file name only —
   * `TranslateHistoryService.list` runs `LIKE` over these two columns. Do NOT
   * "improve" that by stuffing the document's extracted text in here; it would
   * bloat rows to tens of KB, slow the list query, and make `HistoryRow` render
   * a wall of text. Content search wants an FTS5 external-content table instead.
   */
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

export const TranslateLanguageSchema = z.strictObject({
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
