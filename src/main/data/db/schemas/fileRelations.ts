import type { tempSessionSourceType } from '@shared/data/types/file'
import {
  chatMessageRoles,
  chatMessageSourceType,
  creationRoles,
  creationSourceType,
  type FileRefSourceType,
  miniAppLogoRef,
  providerLogoRef
} from '@shared/data/types/file'
import { sql, type SQLWrapper } from 'drizzle-orm'
import { check, index, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

import { createUpdateTimestamps, uuidPrimaryKey } from './_columnHelpers'
import { creationTable } from './creation'
import { fileEntryTable } from './file'
import { messageTable } from './message'
import { miniAppTable } from './miniApp'
import { userProviderTable } from './userProvider'

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
 * Creation file references.
 *
 * Replaces the old polymorphic `file_ref` rows with `sourceType='creation'`
 * (covering both image and video generations via `creation.kind`). Deleting a
 * creation or file entry cascades its association rows.
 */
export const creationFileRefTable = sqliteTable(
  'creation_file_ref',
  {
    id: uuidPrimaryKey(),
    fileEntryId: text()
      .notNull()
      .references(() => fileEntryTable.id, { onDelete: 'cascade' }),
    sourceId: text()
      .notNull()
      .references(() => creationTable.id, { onDelete: 'cascade' }),
    role: text().notNull().$type<(typeof creationRoles)[number]>(),
    ...createUpdateTimestamps
  },
  (t) => [
    index('crfr_entry_id_idx').on(t.fileEntryId),
    index('crfr_source_id_idx').on(t.sourceId),
    uniqueIndex('crfr_unique_idx').on(t.fileEntryId, t.sourceId, t.role),
    check('crfr_role_check', roleCheck(t.role, creationRoles))
  ]
)

/**
 * Single-file entity-image refs (provider logo, mini-app logo).
 *
 * These model a single-file slot and are the **single source of truth** for an
 * owner's uploaded logo — the owner row keeps only `logo_key` (preset / URL
 * refs), never a duplicate `logo_file_id`. Writes go through the `logoRef`
 * helpers (`reconcileLogoSlotTx` / `clearSingleFileRefTx`); reads look the file
 * id back up via `getLogoFileId` (one indexed lookup on the unique `(sourceId)`
 * index). `sourceId` carries a **FK to the owner** (`onDelete: 'cascade'`) and
 * `fileEntryId` a FK to the file (`onDelete: 'cascade'`), matching the
 * collection ref tables (`chat_message`, `creation`): dropping a provider /
 * mini-app or its file drops the ref row, so orphan-counting stays exact.
 * Because both FKs are enforced, a write must order its inserts
 * `file_entry → owner row → ref row` (the ref's `fileEntryId` FK needs the file,
 * its `sourceId` FK needs the owner): the live `set_logo` path always updates an
 * existing owner, and the migrators sequence the inserts explicitly. There is
 * **no `role` column**: the slot's role is a constant ('logo') read by nothing,
 * so the unique `(sourceId)` index alone enforces at most one file per slot.
 * (The user avatar deliberately has no slot table — it is persisted only in the
 * `app.user.avatar` preference.)
 */
export const providerLogoFileRefTable = sqliteTable(
  'provider_logo_file_ref',
  {
    id: uuidPrimaryKey(),
    fileEntryId: text()
      .notNull()
      .references(() => fileEntryTable.id, { onDelete: 'cascade' }),
    sourceId: text()
      .notNull()
      .references(() => userProviderTable.providerId, { onDelete: 'cascade' }),
    ...createUpdateTimestamps
  },
  (t) => [index('plfr_entry_id_idx').on(t.fileEntryId), uniqueIndex('plfr_source_id_idx').on(t.sourceId)]
)

export const miniAppLogoFileRefTable = sqliteTable(
  'mini_app_logo_file_ref',
  {
    id: uuidPrimaryKey(),
    fileEntryId: text()
      .notNull()
      .references(() => fileEntryTable.id, { onDelete: 'cascade' }),
    sourceId: text()
      .notNull()
      .references(() => miniAppTable.appId, { onDelete: 'cascade' }),
    ...createUpdateTimestamps
  },
  (t) => [index('malfr_entry_id_idx').on(t.fileEntryId), uniqueIndex('malfr_source_id_idx').on(t.sourceId)]
)
export const persistentFileRefTablesBySourceType = {
  [chatMessageSourceType]: chatMessageFileRefTable,
  [creationSourceType]: creationFileRefTable,
  [providerLogoRef.sourceType]: providerLogoFileRefTable,
  [miniAppLogoRef.sourceType]: miniAppLogoFileRefTable
} as const satisfies Record<
  PersistentFileRefSourceType,
  | typeof chatMessageFileRefTable
  | typeof creationFileRefTable
  | typeof providerLogoFileRefTable
  | typeof miniAppLogoFileRefTable
>

export type ChatMessageFileRefRow = typeof chatMessageFileRefTable.$inferSelect
export type InsertChatMessageFileRefRow = typeof chatMessageFileRefTable.$inferInsert
export type CreationFileRefRow = typeof creationFileRefTable.$inferSelect
export type InsertCreationFileRefRow = typeof creationFileRefTable.$inferInsert
export type ProviderLogoFileRefRow = typeof providerLogoFileRefTable.$inferSelect
export type InsertProviderLogoFileRefRow = typeof providerLogoFileRefTable.$inferInsert
export type MiniAppLogoFileRefRow = typeof miniAppLogoFileRefTable.$inferSelect
export type InsertMiniAppLogoFileRefRow = typeof miniAppLogoFileRefTable.$inferInsert
