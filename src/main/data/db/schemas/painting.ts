import { sqliteTable, text } from 'drizzle-orm/sqlite-core'

import { createUpdateDeleteTimestamps, orderKeyColumns, orderKeyIndex, uuidPrimaryKey } from './_columnHelpers'

/**
 * Painting row — a frozen receipt of a completed image generation.
 *
 * Output and input files are NOT stored on the row. Each painting has zero or
 * more `painting_file_ref` rows with `sourceId=painting.id`,
 * `role='output'|'input'`. PaintingService writes those refs on create/update;
 * row deletion cascades refs at the database layer. The row otherwise avoids
 * mutable form state (mode, seed, etc.); the live draft stays in renderer
 * React state. `params` is the one exception: the parameter snapshot used for
 * this generation, so a reopened batch can show each column's settings.
 *
 * `batchId` groups the rows created by one multi-model send; null for single-model sends.
 */
export const paintingTable = sqliteTable(
  'painting',
  {
    id: uuidPrimaryKey(),
    providerId: text('provider_id').notNull(),
    modelId: text('model_id'),
    prompt: text().notNull(),
    batchId: text(),
    params: text({ mode: 'json' }).$type<Record<string, unknown>>(),
    ...orderKeyColumns,
    ...createUpdateDeleteTimestamps
  },
  (t) => [orderKeyIndex('painting')(t)]
)

export type PaintingRow = typeof paintingTable.$inferSelect
export type InsertPaintingRow = typeof paintingTable.$inferInsert
