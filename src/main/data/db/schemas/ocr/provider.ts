import type { OcrProviderCapabilityRecord, OcrProviderConfig } from '@types'
import { index, sqliteTable, text } from 'drizzle-orm/sqlite-core'

import { createUpdateTimestamps } from '../columnHelpers'

export const ocrProviderTable = sqliteTable(
  'ocr_provider',
  {
    /**
     * Unique identifier for the provider.
     * For built-in providers, it's 'tesseract', 'system', etc.
     * For custom providers, it can be any unique string.
     * As the primary key, it ensures the uniqueness of each provider.
     */
    id: text('id').primaryKey(),

    /**
     * Display name of the provider, e.g., "Tesseract OCR".
     * Cannot be null.
     */
    name: text('name').notNull(),

    /**
     * Object describing the provider's capabilities, e.g., { image: true }.
     * Stored as JSON in a text column. Drizzle's `mode: 'json'` handles
     * serialization and deserialization automatically. `$type` provides strong typing.
     * Cannot be null; should store an empty object `{}` even if no specific capabilities.
     */
    capabilities: text('capabilities', { mode: 'json' }).$type<OcrProviderCapabilityRecord>().notNull(),

    /**
     * Provider-specific configuration. This is a polymorphic field, its structure varies by provider type.
     * For example, Tesseract's configuration is entirely different from PaddleOCR's.
     * Storing it as JSON is the most flexible approach to accommodate any configuration structure.
     * This field is nullable because `config` in the `OcrProvider` type is optional.
     */
    config: text('config', { mode: 'json' }).$type<OcrProviderConfig>(),

    /** Timestamps. */
    ...createUpdateTimestamps
  },
  (t) => [index('name').on(t.name)]
)

export type OcrProviderInsert = typeof ocrProviderTable.$inferInsert
export type OcrProviderSelect = typeof ocrProviderTable.$inferSelect
