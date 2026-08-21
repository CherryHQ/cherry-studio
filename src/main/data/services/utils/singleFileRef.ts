/**
 * Single-file ref slot mechanics — DB-only, table-agnostic.
 *
 * A *single-file slot* is an association table where one owner row holds at
 * most one file. **"Single-file" is the category name**, opposed to the
 * collection ref tables (`chat_message_file_ref`, `painting_file_ref`) where one
 * owner may hold many rows discriminated by a `role` column. A slot table is
 * roleless and unique on `sourceId`. The term predates this module — see
 * `defineSingleFileRef` in `@shared/data/types/file`.
 *
 * "At most one" is a **correctness precondition, not just a description**: a
 * write clears the owner's existing row before inserting, so handing these
 * helpers a table that permits several rows per `sourceId` would delete rows the
 * caller never meant to touch. {@link SingleFileRefTable} states the required
 * shape; the unique index on `sourceId` is what actually enforces it.
 *
 * The ref row is the **single source of truth** for that owner's uploaded file —
 * the owner row keeps only a preset key (`logo_key`), never a duplicate file id.
 * Reads look the file id back up via {@link getSingleFileRefId}.
 *
 * The target table is a **parameter**, never a `switch` in here: each owner
 * service passes its own table, so a service has no way to reach another
 * owner's slot (services/README "Own your table"), and adding a slot type
 * requires no change to this file. Same rationale as `orderKey.ts`.
 *
 * The file bytes are stored beforehand (the caller passes an opaque `fileId`);
 * this layer never touches the filesystem. Superseded files are preserved per
 * the file layer's policy (file-manager-architecture §7.1) — no `permanentDelete`
 * here, so the DataApi services stay 100% DB-only.
 */

import { application } from '@application'
import type { FileEntryId } from '@shared/data/types/file'
import { type AnyColumn, eq } from 'drizzle-orm'
import type { SQLiteTable } from 'drizzle-orm/sqlite-core'
import { v4 as uuidv4 } from 'uuid'

/**
 * Broad transaction/database type. Matches both top-level `DbType` and the
 * transaction callback argument. Typed as `any` on purpose, mirroring
 * `orderKey.ts`: the helpers are schema-agnostic and must accept any
 * single-file ref table, and Drizzle's `BetterSQLite3Database<TSchema>` generic
 * would otherwise force call-site casts with no safety benefit.
 */
// biome-ignore lint: intentionally loose — see JSDoc above.
type TxLike = any

/**
 * A single-file ref table must expose `fileEntryId` and `sourceId` columns, and
 * enforce at most one row per `sourceId` (a unique index). Both current slot
 * tables share one row shape — `id` / `fileEntryId` / `sourceId` / audit
 * timestamps, no `role` column — so helpers make no other assumption.
 */
export interface SingleFileRefTable extends SQLiteTable {
  fileEntryId: AnyColumn
  sourceId: AnyColumn
}

/**
 * The uploaded file's `file_entry` id held by `sourceId`'s slot in `table` — or
 * null when the slot holds a preset key / nothing. This is the read side of the
 * single source of truth: one indexed lookup on the unique `(sourceId)` index,
 * cheap at the low logo read frequency.
 */
export function getSingleFileRef(table: SingleFileRefTable, sourceId: string): FileEntryId | null {
  const db: TxLike = application.get('DbService').getDb()
  const [row] = db
    .select({ fileEntryId: table.fileEntryId })
    .from(table)
    .where(eq(table.sourceId, sourceId))
    .limit(1)
    .all()
  return (row?.fileEntryId as FileEntryId | undefined) ?? null
}

/** Remove the single-file ref row owned by `sourceId` in `table`, inside `tx`. */
export function clearSingleFileRef(tx: TxLike, table: SingleFileRefTable, sourceId: string): void {
  tx.delete(table).where(eq(table.sourceId, sourceId)).run()
}

/**
 * Insert a single-file ref row in `table` pointing `sourceId` at `fileId`,
 * inside `tx`. Does NOT clear an existing row — callers that replace a slot use
 * {@link reconcileLogoSlotTx}; the migrator inserts into an empty slot. These
 * slot tables are roleless (one implicit purpose per table).
 */
export function insertSingleFileRef(
  tx: TxLike,
  table: SingleFileRefTable,
  sourceId: string,
  fileId: FileEntryId
): void {
  const now = Date.now()
  tx.insert(table).values({ id: uuidv4(), fileEntryId: fileId, sourceId, createdAt: now, updatedAt: now }).run()
}

/** Point `sourceId`'s slot at `fileId`, clearing any existing row first, inside `tx`. */
export function setSingleFileRef(tx: TxLike, table: SingleFileRefTable, sourceId: string, fileId: FileEntryId): void {
  clearSingleFileRef(tx, table, sourceId)
  insertSingleFileRef(tx, table, sourceId, fileId)
}
