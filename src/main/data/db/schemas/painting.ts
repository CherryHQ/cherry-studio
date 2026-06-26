import { real, sqliteTable, text } from 'drizzle-orm/sqlite-core'

import { createUpdateTimestamps, orderKeyColumns, orderKeyIndex, uuidPrimaryKey } from './_columnHelpers'

/**
 * Painting row — a completed image generation plus the recipe behind it.
 *
 * Output and input files are NOT stored on the row. Each painting has zero or
 * more `file_ref` rows with `sourceType='painting'`, `sourceId=painting.id`,
 * `role='output'|'input'`. PaintingService writes those refs on create and
 * derefs via `fileRefService.cleanupBySourceTx` on delete.
 *
 * The row carries a **generation snapshot** so a reloaded history item — or a
 * card on the canvas board — can re-run, spawn variations, and show "made
 * with": `mode` is the authoring mode (`generate`/`edit`/…) and `params` is
 * the canonical param bag (pre-split: size/seed/quality/negativePrompt/…).
 * `canvasX/Y/W` are the board placement; NULL means unplaced (auto-grid).
 *
 * `status` is the persisted generation outcome so an empty `files.output` is no
 * longer ambiguous: NULL = an empty board (no generation attempted), vs an
 * actually `failed`/`canceled` run (offer retry) vs a still-`generating` one.
 * All these columns are nullable — legacy rows have none.
 */
export const paintingTable = sqliteTable(
  'painting',
  {
    id: uuidPrimaryKey(),
    providerId: text('provider_id').notNull(),
    modelId: text('model_id'),
    prompt: text().notNull(),
    mode: text(),
    params: text({ mode: 'json' }).$type<Record<string, unknown>>(),
    canvasX: real('canvas_x'),
    canvasY: real('canvas_y'),
    canvasW: real('canvas_w'),
    status: text().$type<'generating' | 'succeeded' | 'failed' | 'canceled'>(),
    // Soft grouping tag: the N images of one multi-image generation are N rows
    // sharing this id. NULL = ungrouped. Membership only — each row keeps its
    // own canvasX/Y/W.
    groupId: text('group_id'),
    ...orderKeyColumns,
    ...createUpdateTimestamps
  },
  (t) => [orderKeyIndex('painting')(t)]
)

export type PaintingRow = typeof paintingTable.$inferSelect
export type InsertPaintingRow = typeof paintingTable.$inferInsert
