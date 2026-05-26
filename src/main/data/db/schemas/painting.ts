import type { FileMetadata } from '@shared/data/types/file/legacyFileMetadata'
import type { PaintingMode, PaintingParams, PaintingProvider } from '@shared/data/types/painting'
import { sql } from 'drizzle-orm'
import { check, index, sqliteTable, text } from 'drizzle-orm/sqlite-core'

import { createUpdateTimestamps, uuidPrimaryKey } from './_columnHelpers'

export const paintingTable = sqliteTable(
  'painting',
  {
    id: uuidPrimaryKey(),
    provider: text().$type<PaintingProvider>().notNull(),
    mode: text().$type<PaintingMode>().notNull(),
    model: text(),
    prompt: text(),
    negativePrompt: text(),
    status: text(),
    urls: text({ mode: 'json' }).$type<string[]>().notNull().default([]),
    files: text({ mode: 'json' }).$type<FileMetadata[]>().notNull().default([]),
    params: text({ mode: 'json' }).$type<PaintingParams>().notNull().default({}),
    orderKey: text('order_key').notNull(),
    ...createUpdateTimestamps
  },
  (t) => [
    index('painting_provider_mode_order_key_idx').on(t.provider, t.mode, t.orderKey),
    index('painting_provider_mode_idx').on(t.provider, t.mode),
    index('painting_status_idx').on(t.status),
    check('painting_provider_check', sql`length(${t.provider}) > 0`),
    check('painting_mode_check', sql`${t.mode} IN ('generate', 'edit', 'remix', 'upscale', 'draw')`)
  ]
)

export type PaintingSelect = typeof paintingTable.$inferSelect
export type PaintingInsert = typeof paintingTable.$inferInsert
