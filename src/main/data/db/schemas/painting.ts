import { sqliteTable, text } from 'drizzle-orm/sqlite-core'

import { createUpdateTimestamps, orderKeyColumns, orderKeyIndex, uuidPrimaryKey } from './_columnHelpers'

/**
 * Painting row — a frozen receipt of a completed image generation.
 *
 * Output and input files are NOT stored on the row. Each painting has zero or
 * more `file_ref` rows with `sourceType='painting'`, `sourceId=painting.id`,
 * `role='output'|'input'`. PaintingService writes those refs on create and
 * derefs via `fileRefService.cleanupBySourceTx` on delete. The frozen receipt
 * shape avoids carrying mutable form state (mode, size, seed, etc.) on the
 * row — the live painting draft lives in renderer React state and is
 * discarded on app exit.
 */
export const paintingTable = sqliteTable(
  'painting',
  {
    id: uuidPrimaryKey(),
    providerId: text('provider_id').notNull(),
    modelId: text('model_id'),
    prompt: text().notNull(),
    ...orderKeyColumns,
    ...createUpdateTimestamps
  },
  (t) => [orderKeyIndex('painting')(t)]
)

export type PaintingRow = typeof paintingTable.$inferSelect
export type InsertPaintingRow = typeof paintingTable.$inferInsert
