import type { tempSessionSourceType } from '@shared/data/types/file/ref'
import {
  chatMessageRoles,
  chatMessageSourceType,
  type FileRefSourceType,
  miniAppLogoRef,
  paintingRoles,
  paintingSourceType,
  providerLogoRef,
  userAvatarRef
} from '@shared/data/types/file/ref'
import { sql, type SQLWrapper } from 'drizzle-orm'
import { check, index, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

import { createUpdateTimestamps, uuidPrimaryKey } from './_columnHelpers'
import { fileEntryTable } from './file'
import { messageTable } from './message'
import { paintingTable } from './painting'

function sqlStringList(values: readonly string[]) {
  return sql.raw(values.map((value) => `'${value.replaceAll("'", "''")}'`).join(', '))
}

function roleCheck(column: SQLWrapper, roles: readonly string[]) {
  return sql`${column} IN (${sqlStringList(roles)})`
}

export type PersistentFileRefSourceType = Exclude<FileRefSourceType, typeof tempSessionSourceType>

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
    role: text().notNull().$type<(typeof chatMessageRoles)[number]>(),
    ...createUpdateTimestamps
  },
  (t) => [
    index('cmfr_entry_id_idx').on(t.fileEntryId),
    index('cmfr_source_id_idx').on(t.sourceId),
    uniqueIndex('cmfr_unique_idx').on(t.fileEntryId, t.sourceId, t.role),
    check('cmfr_role_check', roleCheck(t.role, chatMessageRoles))
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
    role: text().notNull().$type<(typeof paintingRoles)[number]>(),
    ...createUpdateTimestamps
  },
  (t) => [
    index('pfr_entry_id_idx').on(t.fileEntryId),
    index('pfr_source_id_idx').on(t.sourceId),
    uniqueIndex('pfr_unique_idx').on(t.fileEntryId, t.sourceId, t.role),
    check('pfr_role_check', roleCheck(t.role, paintingRoles))
  ]
)

/**
 * Single-file entity-image refs (provider logo, mini-app logo, user avatar).
 *
 * Unlike the collection refs (`chat_message`, `painting`) these model a
 * single-file slot whose file id also lives directly on the owning row's
 * `logo_file_id` / avatar preference. The slot is always kept in sync through
 * the `logoRef` helpers (`reconcileLogoSlotTx` / `clearSingleFileRefTx`), and
 * the owner's delete flow clears it explicitly — so `sourceId` carries **no FK**
 * (this also avoids ordering coupling: the owner row and its logo are created
 * together, and the avatar has no owning table at all). Only `fileEntryId`
 * cascades, so deleting the file drops the row and orphan-counting stays exact.
 * The unique `(sourceId, role)` index enforces at most one file per slot.
 */
export const providerLogoFileRefTable = sqliteTable(
  'provider_logo_file_ref',
  {
    id: uuidPrimaryKey(),
    fileEntryId: text()
      .notNull()
      .references(() => fileEntryTable.id, { onDelete: 'cascade' }),
    sourceId: text().notNull(),
    role: text().notNull().$type<(typeof providerLogoRef.roles)[number]>(),
    ...createUpdateTimestamps
  },
  (t) => [
    index('plfr_entry_id_idx').on(t.fileEntryId),
    uniqueIndex('plfr_source_id_role_idx').on(t.sourceId, t.role),
    check('plfr_role_check', roleCheck(t.role, providerLogoRef.roles))
  ]
)

export const miniAppLogoFileRefTable = sqliteTable(
  'mini_app_logo_file_ref',
  {
    id: uuidPrimaryKey(),
    fileEntryId: text()
      .notNull()
      .references(() => fileEntryTable.id, { onDelete: 'cascade' }),
    sourceId: text().notNull(),
    role: text().notNull().$type<(typeof miniAppLogoRef.roles)[number]>(),
    ...createUpdateTimestamps
  },
  (t) => [
    index('malfr_entry_id_idx').on(t.fileEntryId),
    uniqueIndex('malfr_source_id_role_idx').on(t.sourceId, t.role),
    check('malfr_role_check', roleCheck(t.role, miniAppLogoRef.roles))
  ]
)
export const userAvatarFileRefTable = sqliteTable(
  'user_avatar_file_ref',
  {
    id: uuidPrimaryKey(),
    fileEntryId: text()
      .notNull()
      .references(() => fileEntryTable.id, { onDelete: 'cascade' }),
    sourceId: text().notNull(),
    role: text().notNull().$type<(typeof userAvatarRef.roles)[number]>(),
    ...createUpdateTimestamps
  },
  (t) => [
    index('uafr_entry_id_idx').on(t.fileEntryId),
    uniqueIndex('uafr_source_id_role_idx').on(t.sourceId, t.role),
    check('uafr_role_check', roleCheck(t.role, userAvatarRef.roles))
  ]
)

export const persistentFileRefTablesBySourceType = {
  [chatMessageSourceType]: chatMessageFileRefTable,
  [paintingSourceType]: paintingFileRefTable,
  [providerLogoRef.sourceType]: providerLogoFileRefTable,
  [miniAppLogoRef.sourceType]: miniAppLogoFileRefTable,
  [userAvatarRef.sourceType]: userAvatarFileRefTable
} as const satisfies Record<
  PersistentFileRefSourceType,
  | typeof chatMessageFileRefTable
  | typeof paintingFileRefTable
  | typeof providerLogoFileRefTable
  | typeof miniAppLogoFileRefTable
  | typeof userAvatarFileRefTable
>

export type ChatMessageFileRefRow = typeof chatMessageFileRefTable.$inferSelect
export type InsertChatMessageFileRefRow = typeof chatMessageFileRefTable.$inferInsert
export type PaintingFileRefRow = typeof paintingFileRefTable.$inferSelect
export type InsertPaintingFileRefRow = typeof paintingFileRefTable.$inferInsert
export type ProviderLogoFileRefRow = typeof providerLogoFileRefTable.$inferSelect
export type InsertProviderLogoFileRefRow = typeof providerLogoFileRefTable.$inferInsert
export type MiniAppLogoFileRefRow = typeof miniAppLogoFileRefTable.$inferSelect
export type InsertMiniAppLogoFileRefRow = typeof miniAppLogoFileRefTable.$inferInsert
export type UserAvatarFileRefRow = typeof userAvatarFileRefTable.$inferSelect
export type InsertUserAvatarFileRefRow = typeof userAvatarFileRefTable.$inferInsert
