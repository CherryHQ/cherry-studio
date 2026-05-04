import type { PaintingFiles, PaintingMode, PaintingParams } from '@shared/data/types/painting'
import { index, sqliteTable, text } from 'drizzle-orm/sqlite-core'

import { createUpdateTimestamps, orderKeyColumns, uuidPrimaryKey } from './_columnHelpers'

export const paintingTable = sqliteTable(
  'painting',
  {
    id: uuidPrimaryKey(),
    providerId: text('provider_id').notNull(),
    mode: text().$type<PaintingMode>().notNull(),
    model: text(),
    prompt: text().notNull().default(''),
    params: text({ mode: 'json' }).$type<PaintingParams>().notNull().default({}),
    files: text({ mode: 'json' }).$type<PaintingFiles>().notNull().default({ output: [], input: [] }),
    parentId: text('parent_id'),
    ...orderKeyColumns,
    ...createUpdateTimestamps
  },
  (t) => [
    index('painting_provider_mode_order_key_idx').on(t.providerId, t.mode, t.orderKey),
    index('painting_provider_mode_created_idx').on(t.providerId, t.mode, t.createdAt),
    index('painting_parent_id_idx').on(t.parentId)
  ]
)

export type Painting = typeof paintingTable.$inferSelect
export type NewPainting = typeof paintingTable.$inferInsert
