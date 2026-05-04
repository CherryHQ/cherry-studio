import type { PaintingFiles, PaintingMediaType, PaintingMode, PaintingParams } from '@shared/data/types/painting'
import { sql } from 'drizzle-orm'
import { check, index, sqliteTable, text } from 'drizzle-orm/sqlite-core'

import { createUpdateTimestamps, orderKeyColumns, uuidPrimaryKey } from './_columnHelpers'

export const paintingTable = sqliteTable(
  'painting',
  {
    id: uuidPrimaryKey(),
    providerId: text('provider_id').notNull(),
    mode: text().$type<PaintingMode>().notNull(),
    mediaType: text('media_type').$type<PaintingMediaType>().notNull().default('image'),
    model: text(),
    prompt: text().notNull().default(''),
    params: text({ mode: 'json' }).$type<PaintingParams>().notNull().default({}),
    files: text({ mode: 'json' }).$type<PaintingFiles>().notNull().default({ output: [], input: [] }),
    ...orderKeyColumns,
    ...createUpdateTimestamps
  },
  (t) => [
    index('painting_provider_mode_order_key_idx').on(t.providerId, t.mode, t.orderKey),
    index('painting_provider_mode_created_idx').on(t.providerId, t.mode, t.createdAt),
    check('painting_mode_check', sql`${t.mode} IN ('generate', 'draw', 'edit', 'remix', 'merge', 'upscale')`),
    check('painting_media_type_check', sql`${t.mediaType} IN ('image', 'video')`)
  ]
)

export type Painting = typeof paintingTable.$inferSelect
export type NewPainting = typeof paintingTable.$inferInsert
