/**
 * Single-file entity-image ref reconciliation — DB-only.
 *
 * Shared by ProviderService / MiniAppService (logo slots). The single-file
 * association row (`provider_logo_file_ref`, `mini_app_logo_file_ref`) is the
 * **single source of truth** for an owner's uploaded logo — the owner row keeps
 * only `logo_key` (preset / URL refs), never a duplicate `logo_file_id`. Each
 * owner holds at most one file per slot, so a write clears the existing row
 * before inserting the new one; reads look the file id back up via
 * {@link getLogoFileId}.
 *
 * The file bytes are stored beforehand (the caller passes an opaque `fileId`);
 * this layer never touches the filesystem. Superseded files are preserved per
 * the file layer's policy (file-manager-architecture §7.1) — no `permanentDelete`
 * here, so the DataApi services stay 100% DB-only.
 */

import { application } from '@application'
import { miniAppLogoFileRefTable, providerLogoFileRefTable } from '@data/db/schemas/fileRelations'
import type { DbOrTx, DbType } from '@data/db/types'
import type { LogoBindInput } from '@shared/data/api/schemas/logo'
import type { FileEntryId } from '@shared/data/types/file'
import { miniAppLogoRef, providerLogoRef } from '@shared/data/types/file'
import { eq } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'

/** The persistent single-file (logo) ref source types. */
export type SingleFileRefSourceType = typeof providerLogoRef.sourceType | typeof miniAppLogoRef.sourceType

/** A single-file ref slot: the owning source type plus its owner id. */
export interface SingleFileRefSlot {
  sourceType: SingleFileRefSourceType
  sourceId: string
}

/** The owner-row column value a logo reconcile resolves to. */
export interface LogoColumns {
  logoKey: string | null
}

/**
 * The uploaded logo's file-entry id for `slot`, from its ref row — or null when
 * the slot holds a preset key / nothing. This is the read side of the single
 * source of truth: one indexed lookup on the unique `(sourceId)` index, cheap
 * at the low logo read frequency.
 */
export function getLogoFileId(slot: SingleFileRefSlot): FileEntryId | null {
  const db = application.get('DbService').getDb()
  switch (slot.sourceType) {
    case providerLogoRef.sourceType: {
      const [row] = db
        .select({ fileEntryId: providerLogoFileRefTable.fileEntryId })
        .from(providerLogoFileRefTable)
        .where(eq(providerLogoFileRefTable.sourceId, slot.sourceId))
        .limit(1)
        .all()
      return (row?.fileEntryId as FileEntryId | undefined) ?? null
    }
    case miniAppLogoRef.sourceType: {
      const [row] = db
        .select({ fileEntryId: miniAppLogoFileRefTable.fileEntryId })
        .from(miniAppLogoFileRefTable)
        .where(eq(miniAppLogoFileRefTable.sourceId, slot.sourceId))
        .limit(1)
        .all()
      return (row?.fileEntryId as FileEntryId | undefined) ?? null
    }
  }
}

/** Remove the single-file ref row owned by `slot`, inside `tx`. */
export function clearSingleFileRefTx(tx: DbOrTx, slot: SingleFileRefSlot): void {
  switch (slot.sourceType) {
    case providerLogoRef.sourceType:
      tx.delete(providerLogoFileRefTable).where(eq(providerLogoFileRefTable.sourceId, slot.sourceId)).run()
      return
    case miniAppLogoRef.sourceType:
      tx.delete(miniAppLogoFileRefTable).where(eq(miniAppLogoFileRefTable.sourceId, slot.sourceId)).run()
      return
  }
}

/**
 * Insert a single-file ref row for `slot` pointing at `fileId`, inside `tx`.
 * Does NOT clear an existing row — callers that replace a slot use
 * {@link setSingleFileRefTx}; the migrator inserts into an empty slot. These
 * slot tables are roleless (one implicit purpose per source type).
 */
export function insertSingleFileRefTx(tx: Pick<DbType, 'insert'>, slot: SingleFileRefSlot, fileId: FileEntryId): void {
  const now = Date.now()
  const row = { id: uuidv4(), fileEntryId: fileId, sourceId: slot.sourceId, createdAt: now, updatedAt: now }
  switch (slot.sourceType) {
    case providerLogoRef.sourceType:
      tx.insert(providerLogoFileRefTable).values(row).run()
      return
    case miniAppLogoRef.sourceType:
      tx.insert(miniAppLogoFileRefTable).values(row).run()
      return
  }
}

/**
 * Point `slot` at `fileId`, clearing any existing row first, inside `tx`.
 */
export function setSingleFileRefTx(tx: DbOrTx, slot: SingleFileRefSlot, fileId: FileEntryId): void {
  clearSingleFileRefTx(tx, slot)
  insertSingleFileRefTx(tx, slot, fileId)
}

/**
 * Reconcile the logo slot inside `tx`: replace the slot's ref (the single
 * source of truth for an uploaded file) and return the `logoKey` to persist on
 * the owner row. Returns `null` when `input` is `undefined` (update no-op —
 * leave the column untouched).
 *
 * - `{ kind: 'file', fileId }` → uploaded file: point the slot's ref at it,
 *   `logoKey = null` (the file id lives only in the ref row).
 * - `{ kind: 'key', key }` → preset/url ref: drop the slot's ref, `logoKey = key`.
 * - `{ kind: 'default' }` → drop the slot's ref, `logoKey = null`.
 */
export function reconcileLogoSlotTx(
  tx: DbOrTx,
  slot: SingleFileRefSlot,
  input: LogoBindInput | undefined
): LogoColumns | null {
  if (input === undefined) return null

  if (input.kind === 'file') {
    setSingleFileRefTx(tx, slot, input.fileId)
    return { logoKey: null }
  }

  clearSingleFileRefTx(tx, slot)
  return { logoKey: input.kind === 'key' ? input.key : null }
}
