import type { tempSessionSourceType } from '@shared/data/types/file'
import {
  chatMessageRoles,
  chatMessageSourceType,
  type FileRefSourceType,
  jobRoles,
  jobSourceType,
  miniAppLogoRef,
  paintingRoles,
  paintingSourceType,
  providerLogoRef
} from '@shared/data/types/file'
import { type SQL, sql, type SQLWrapper } from 'drizzle-orm'
import { check, index, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

import { createUpdateTimestamps, uuidPrimaryKey } from './_columnHelpers'
import { fileEntryTable } from './file'
import { jobTable } from './job'
import { messageTable } from './message'
import { miniAppTable } from './miniApp'
import { paintingTable } from './painting'
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
 * Job file references.
 *
 * Links a FileEntry to a `job` row so the generic job system's persisted
 * inputs are visible to the cleanup anti-join (file-entry-cleanup.md §5.1).
 * Today only the async image-generation job holds refs here (its input images
 * / mask). Deleting the job row (terminal-row pruning) cascades the ref, so
 * the inputs become reclaimable exactly when the job record is gone; deleting
 * the file entry cascades too.
 */
export const jobFileRefTable = sqliteTable(
  'job_file_ref',
  {
    id: uuidPrimaryKey(),
    fileEntryId: text()
      .notNull()
      .references(() => fileEntryTable.id, { onDelete: 'cascade' }),
    sourceId: text()
      .notNull()
      .references(() => jobTable.id, { onDelete: 'cascade' }),
    role: text().notNull().$type<(typeof jobRoles)[number]>(),
    ...createUpdateTimestamps
  },
  (t) => [
    index('jfr_entry_id_idx').on(t.fileEntryId),
    index('jfr_source_id_idx').on(t.sourceId),
    uniqueIndex('jfr_unique_idx').on(t.fileEntryId, t.sourceId, t.role),
    check('jfr_role_check', roleCheck(t.role, jobRoles))
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
 * collection ref tables (`chat_message`, `painting`): dropping a provider /
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
  [paintingSourceType]: paintingFileRefTable,
  [jobSourceType]: jobFileRefTable,
  [providerLogoRef.sourceType]: providerLogoFileRefTable,
  [miniAppLogoRef.sourceType]: miniAppLogoFileRefTable
} as const satisfies Record<
  PersistentFileRefSourceType,
  | typeof chatMessageFileRefTable
  | typeof paintingFileRefTable
  | typeof jobFileRefTable
  | typeof providerLogoFileRefTable
  | typeof miniAppLogoFileRefTable
>

/**
 * NOT EXISTS conditions for "no persistent ref points at this file_entry",
 * generated from the registry so a new ref table cannot be silently omitted
 * from unreferenced/cleanup discovery (file-entry-cleanup.md §5.1).
 */
export function persistentRefAbsenceConditions(): SQL[] {
  return Object.values(persistentFileRefTablesBySourceType).map(
    (table) => sql`NOT EXISTS (SELECT 1 FROM ${table} WHERE ${table.fileEntryId} = ${fileEntryTable.id})`
  )
}

export type ChatMessageFileRefRow = typeof chatMessageFileRefTable.$inferSelect
export type InsertChatMessageFileRefRow = typeof chatMessageFileRefTable.$inferInsert
export type PaintingFileRefRow = typeof paintingFileRefTable.$inferSelect
export type InsertPaintingFileRefRow = typeof paintingFileRefTable.$inferInsert
export type JobFileRefRow = typeof jobFileRefTable.$inferSelect
export type InsertJobFileRefRow = typeof jobFileRefTable.$inferInsert
export type ProviderLogoFileRefRow = typeof providerLogoFileRefTable.$inferSelect
export type InsertProviderLogoFileRefRow = typeof providerLogoFileRefTable.$inferInsert
export type MiniAppLogoFileRefRow = typeof miniAppLogoFileRefTable.$inferSelect
export type InsertMiniAppLogoFileRefRow = typeof miniAppLogoFileRefTable.$inferInsert
