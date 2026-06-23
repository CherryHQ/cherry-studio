import { sqliteTable, text } from 'drizzle-orm/sqlite-core'

import { createUpdateTimestamps, orderKeyColumns, orderKeyIndex, uuidPrimaryKey } from './_columnHelpers'

/**
 * Creation row — a frozen receipt of a completed generation, unifying the
 * former `painting` and `video` tables. `kind` discriminates image vs video;
 * the rest of the row is media-agnostic.
 *
 * Output and input files are NOT stored on the row. Each creation has zero or
 * more `file_ref` rows with `sourceType='creation'`, `sourceId=creation.id`,
 * `role='output'|'input'`. CreationService writes those refs on create and
 * derefs via `fileRefService.cleanupBySourceTx` on delete. The frozen-receipt
 * shape avoids carrying mutable draft state (mode, size, duration, seed, …) on
 * the row — the live draft lives in renderer React state and is discarded on exit.
 */
export const creationTable = sqliteTable(
  'creation',
  {
    id: uuidPrimaryKey(),
    /** 'image' | 'video' — see CreationKind. Stored as text for forward-compat. */
    kind: text().notNull(),
    providerId: text('provider_id').notNull(),
    modelId: text('model_id'),
    prompt: text().notNull(),
    ...orderKeyColumns,
    ...createUpdateTimestamps
  },
  (t) => [orderKeyIndex('creation')(t)]
)

export type CreationRow = typeof creationTable.$inferSelect
export type InsertCreationRow = typeof creationTable.$inferInsert
