import { sql } from 'drizzle-orm'
import { check, index, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

import { createUpdateTimestamps, uuidPrimaryKey } from './_columnHelpers'
import { fileEntryTable } from './file'
import { messageTable } from './message'
import { paintingTable } from './painting'

/**
 * Chat message file references.
 *
 * Replaces the old polymorphic `file_ref` rows with `sourceType='chat_message'`.
 * Both sides are FK-constrained so deleting either the message or file entry
 * cascades the association row.
 */
export const chatMessageFileRefTable = sqliteTable(
  'chat_message_file_ref',
  {
    id: uuidPrimaryKey(),
    fileEntryId: text()
      .notNull()
      .references(() => fileEntryTable.id, { onDelete: 'cascade' }),
    sourceId: text()
      .notNull()
      .references(() => messageTable.id, { onDelete: 'cascade' }),
    role: text().notNull(),
    ...createUpdateTimestamps
  },
  (t) => [
    index('cmfr_entry_id_idx').on(t.fileEntryId),
    index('cmfr_source_id_idx').on(t.sourceId),
    uniqueIndex('cmfr_unique_idx').on(t.fileEntryId, t.sourceId, t.role),
    check('cmfr_role_check', sql`${t.role} IN ('attachment')`)
  ]
)

/**
 * Painting file references.
 *
 * Replaces the old polymorphic `file_ref` rows with `sourceType='painting'`.
 * Deleting a painting or file entry cascades its association rows.
 */
export const paintingFileRefTable = sqliteTable(
  'painting_file_ref',
  {
    id: uuidPrimaryKey(),
    fileEntryId: text()
      .notNull()
      .references(() => fileEntryTable.id, { onDelete: 'cascade' }),
    sourceId: text()
      .notNull()
      .references(() => paintingTable.id, { onDelete: 'cascade' }),
    role: text().notNull(),
    ...createUpdateTimestamps
  },
  (t) => [
    index('pfr_entry_id_idx').on(t.fileEntryId),
    index('pfr_source_id_idx').on(t.sourceId),
    uniqueIndex('pfr_unique_idx').on(t.fileEntryId, t.sourceId, t.role),
    check('pfr_role_check', sql`${t.role} IN ('output', 'input')`)
  ]
)

export type ChatMessageFileRefRow = typeof chatMessageFileRefTable.$inferSelect
export type InsertChatMessageFileRefRow = typeof chatMessageFileRefTable.$inferInsert
export type PaintingFileRefRow = typeof paintingFileRefTable.$inferSelect
export type InsertPaintingFileRefRow = typeof paintingFileRefTable.$inferInsert
