/**
 * Single-file logo slot reconciliation — DB-only.
 *
 * Shared by ProviderService / MiniAppService. Keeps the owner row's
 * `(logo, logoFileId)` columns and the `provider_logo`/`mini_app_logo`
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
import type { FileEntryId, FileRefSourceType } from '@shared/data/types/file'

/** Resolved `(logo, logoFileId)` column values for a logo slot. */
export interface LogoColumns {
  logo: string | null
  logoFileId: FileEntryId | null
}

/** Logo intent from a create/update DTO. */
export interface LogoInput {
  /** Preset icon id / url — stored inline on `logo`. */
  logo?: string | null
  /** Opaque uploaded file-entry id (`null` clears) — stored on `logoFileId`. */
  logoFileId?: string | null
}

/**
 * Reconcile the logo slot inside `tx`: replace the slot's `file_ref` and return
 * the `(logo, logoFileId)` column values to persist on the owner row. Returns
 * `null` when neither field is provided (update no-op — leave columns untouched).
 *
 * - `logoFileId` is a string → uploaded file: point the slot's ref at it,
 *   `logoFileId = id`, `logo = null`.
 * - otherwise (preset/url string, or explicit clear) → drop the slot's ref,
 *   `logo = input.logo ?? null`, `logoFileId = null`.
 */
export async function reconcileLogoSlotTx(
  tx: Pick<DbType, 'delete' | 'insert'>,
  slot: { sourceType: FileRefSourceType; sourceId: string },
  input: LogoInput
): Promise<LogoColumns | null> {
  if (input.logo === undefined && input.logoFileId === undefined) return null

  // Single-file slot: clear any existing ref, then re-point if a file is set.
  await fileRefService.cleanupBySourceTx(tx, slot)

  if (typeof input.logoFileId === 'string') {
    await tx.insert(fileRefTable).values({
      fileEntryId: input.logoFileId,
      sourceType: slot.sourceType,
      sourceId: slot.sourceId,
      role: 'logo'
    })
    return { logo: null, logoFileId: input.logoFileId }
  }

  return { logo: input.logo ?? null, logoFileId: null }
}
