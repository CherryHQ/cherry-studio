import type { PaintingMode, PaintingParams } from '@shared/data/types/painting'
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

import { createUpdateTimestamps, uuidPrimaryKey } from './_columnHelpers'

export const paintingTable = sqliteTable(
  'painting',
  {
    id: uuidPrimaryKey(),
    providerId: text('provider_id').notNull(),
    mode: text().$type<PaintingMode>().notNull(),
    model: text(),
    prompt: text().notNull().default(''),
    params: text({ mode: 'json' }).$type<PaintingParams>().notNull().default({}),
    fileIds: text('file_ids', { mode: 'json' }).$type<string[]>().notNull().default([]),
    inputFileIds: text('input_file_ids', { mode: 'json' }).$type<string[]>().notNull().default([]),
    parentId: text('parent_id'),
    sortOrder: integer().notNull().default(0),
    ...createUpdateTimestamps
  },
  (t) => [
    index('painting_provider_mode_sort_idx').on(t.providerId, t.mode, t.sortOrder),
    index('painting_provider_mode_created_idx').on(t.providerId, t.mode, t.createdAt),
    index('painting_parent_id_idx').on(t.parentId)
  ]
)

export type PaintingRow = typeof paintingTable.$inferSelect
export type NewPaintingRow = typeof paintingTable.$inferInsert
