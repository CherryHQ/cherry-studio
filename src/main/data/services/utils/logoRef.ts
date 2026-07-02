/**
 * Single-file entity-image ref reconciliation — DB-only.
 *
 * Shared by ProviderService / MiniAppService (logo slots) and the avatar IPC
 * handler. Keeps a single-file association row (`provider_logo_file_ref`,
 * `mini_app_logo_file_ref`, `user_avatar_file_ref`) in sync with its owner,
 * entirely within the caller's write tx. Each owner holds at most one file per
 * slot, so a write clears the existing row before inserting the new one.
 *
 * The file bytes are stored beforehand (the caller passes an opaque `fileId`);
 * this layer never touches the filesystem. Superseded files are preserved per
 * the file layer's policy (file-manager-architecture §7.1) — no `permanentDelete`
 * here, so the DataApi services stay 100% DB-only.
 */

import {
  miniAppLogoFileRefTable,
  providerLogoFileRefTable,
  userAvatarFileRefTable
} from '@data/db/schemas/fileRelations'
import type { DbOrTx, DbType } from '@data/db/types'
import type { LogoBindInput } from '@shared/data/api/schemas/logo'
import type { FileEntryId } from '@shared/data/types/file'
import { miniAppLogoRef, providerLogoRef, userAvatarRef } from '@shared/data/types/file/ref'
import { eq } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'

/** The persistent single-file (logo / avatar) ref source types. */
export type SingleFileRefSourceType =
  | typeof providerLogoRef.sourceType
  | typeof miniAppLogoRef.sourceType
  | typeof userAvatarRef.sourceType

/** A single-file ref slot: the owning source type plus its owner id. */
export interface SingleFileRefSlot {
  sourceType: SingleFileRefSourceType
  sourceId: string
}

/** Resolved `(logoKey, logoFileId)` column values for a logo slot. */
export interface LogoColumns {
  logoKey: string | null
  logoFileId: FileEntryId | null
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
    case userAvatarRef.sourceType:
      tx.delete(userAvatarFileRefTable).where(eq(userAvatarFileRefTable.sourceId, slot.sourceId)).run()
      return
  }
}

/**
 * Insert a single-file ref row for `slot` pointing at `fileId`, inside `tx`.
 * Does NOT clear an existing row — callers that replace a slot use
 * {@link setSingleFileRefTx}; the migrator inserts into an empty slot. The ref
 * role is fixed per source type (`logo` for provider / mini-app, `avatar` for
 * the user avatar), so it is not a parameter.
 */
export function insertSingleFileRefTx(tx: Pick<DbType, 'insert'>, slot: SingleFileRefSlot, fileId: FileEntryId): void {
  const now = Date.now()
  const base = { id: uuidv4(), fileEntryId: fileId, sourceId: slot.sourceId, createdAt: now, updatedAt: now }
  switch (slot.sourceType) {
    case providerLogoRef.sourceType:
      tx.insert(providerLogoFileRefTable)
        .values({ ...base, role: 'logo' })
        .run()
      return
    case miniAppLogoRef.sourceType:
      tx.insert(miniAppLogoFileRefTable)
        .values({ ...base, role: 'logo' })
        .run()
      return
    case userAvatarRef.sourceType:
      tx.insert(userAvatarFileRefTable)
        .values({ ...base, role: 'avatar' })
        .run()
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
 * Reconcile the logo slot inside `tx`: replace the slot's ref and return the
 * `(logoKey, logoFileId)` column values to persist on the owner row. Returns
 * `null` when `input` is `undefined` (update no-op — leave columns untouched).
 *
 * - `{ kind: 'file', fileId }` → uploaded file: point the slot's ref at it,
 *   `logoFileId = fileId`, `logoKey = null`.
 * - `{ kind: 'key', key }` → preset/url ref: drop the slot's ref,
 *   `logoKey = key`, `logoFileId = null`.
 * - `{ kind: 'clear' }` → drop the slot's ref, both columns null.
 */
export function reconcileLogoSlotTx(
  tx: DbOrTx,
  slot: SingleFileRefSlot,
  input: LogoBindInput | undefined
): LogoColumns | null {
  if (input === undefined) return null

  if (input.kind === 'file') {
    setSingleFileRefTx(tx, slot, input.fileId)
    return { logoKey: null, logoFileId: input.fileId }
  }

  clearSingleFileRefTx(tx, slot)
  return { logoKey: input.kind === 'key' ? input.key : null, logoFileId: null }
}
