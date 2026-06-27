/**
 * Single-file logo slot reconciliation — DB-only.
 *
 * Shared by ProviderService / MiniAppService. Keeps the owner row's
 * `(logoKey, logoFileId)` columns and the `provider_logo`/`mini_app_logo`
 * single-file `file_ref` slot in sync, entirely within the caller's write tx.
 *
 * The file bytes are stored by the renderer beforehand (it passes an opaque
 * `logoFileId`); this layer never touches the filesystem. Superseded files are
 * preserved per the file layer's policy (file-manager-architecture §7.1) — no
 * `permanentDelete` here, so the DataApi services stay 100% DB-only.
 */

import { fileRefTable } from '@data/db/schemas/file'
import type { DbType } from '@data/db/types'
import { fileRefService } from '@data/services/FileRefService'
import type { CreateLogoInput, UpdateLogoInput } from '@shared/data/api/schemas/logo'
import type { FileEntryId, FileRefSourceType } from '@shared/data/types/file'

/** Resolved `(logoKey, logoFileId)` column values for a logo slot. */
export interface LogoColumns {
  logoKey: string | null
  logoFileId: FileEntryId | null
}

/**
 * Reconcile the logo slot inside `tx`: replace the slot's `file_ref` and return
 * the `(logoKey, logoFileId)` column values to persist on the owner row. Returns
 * `null` when `input` is `undefined` (update no-op — leave columns untouched).
 *
 * - `{ kind: 'file', fileId }` → uploaded file: point the slot's ref at it,
 *   `logoFileId = fileId`, `logoKey = null`.
 * - `{ kind: 'key', key }` → preset/url ref: drop the slot's ref,
 *   `logoKey = key`, `logoFileId = null`.
 * - `{ kind: 'clear' }` → drop the slot's ref, both columns null.
 */
export async function reconcileLogoSlotTx(
  tx: Pick<DbType, 'delete' | 'insert'>,
  slot: { sourceType: FileRefSourceType; sourceId: string },
  input: CreateLogoInput | UpdateLogoInput | undefined
): Promise<LogoColumns | null> {
  if (input === undefined) return null

  // Single-file slot: clear any existing ref, then re-point if a file is set.
  await fileRefService.cleanupBySourceTx(tx, slot)

  if (input.kind === 'file') {
    await tx.insert(fileRefTable).values({
      fileEntryId: input.fileId,
      sourceType: slot.sourceType,
      sourceId: slot.sourceId,
      role: 'logo'
    })
    return { logoKey: null, logoFileId: input.fileId }
  }

  return { logoKey: input.kind === 'key' ? input.key : null, logoFileId: null }
}
