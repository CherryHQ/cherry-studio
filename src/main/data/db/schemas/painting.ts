import type { PaintingFiles, PaintingMediaType, PaintingMode, PaintingParams } from '@shared/data/types/painting'
import { sql } from 'drizzle-orm'
import { check, index, sqliteTable, text } from 'drizzle-orm/sqlite-core'

import { createUpdateTimestamps, orderKeyColumns, orderKeyIndex, uuidPrimaryKey } from './_columnHelpers'

export const paintingTable = sqliteTable(
  'painting',
  {
    id: uuidPrimaryKey(),
    providerId: text('provider_id').notNull(),
    modelId: text('model_id'),
    // Provider workflow key: keep queryable at the top level, but do not CHECK
    // it so future providers can add modes without a schema migration.
    mode: text().$type<PaintingMode>().notNull(),
    mediaType: text('media_type').$type<PaintingMediaType>().notNull(),
    prompt: text().notNull(),
    params: text({ mode: 'json' }).$type<PaintingParams>().notNull(),
    // Stores current app file ids. When file metadata moves into SQLite, migrate
    // these arrays to reference the file table primary key instead.
    files: text({ mode: 'json' }).$type<PaintingFiles>().notNull(),
    ...orderKeyColumns,
    ...createUpdateTimestamps
  },
  (t) => [
    orderKeyIndex('painting')(t),
    index('painting_provider_mode_created_idx').on(t.providerId, t.mode, t.createdAt),
    check('painting_media_type_check', sql`${t.mediaType} IN ('image', 'video')`)
  ]
)

export type Painting = typeof paintingTable.$inferSelect
export type NewPainting = typeof paintingTable.$inferInsert
