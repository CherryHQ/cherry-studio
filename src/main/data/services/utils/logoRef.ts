/** Logo-specific key/file/default reconciliation over a single FileRef slot. */

import type { DbOrTx } from '@data/db/types'
import type { FileEntryId } from '@shared/data/types/file'

import { clearSingleFileRef, setSingleFileRef, type SingleFileRefSlot } from './singleFileRef'

export type LogoBindInput = { kind: 'key'; key: string } | { kind: 'file'; fileId: FileEntryId } | { kind: 'default' }

export interface LogoColumns {
  logoKey: string | null
}

export function reconcileLogoSlotTx(
  tx: DbOrTx,
  slot: SingleFileRefSlot,
  input: LogoBindInput | undefined
): LogoColumns | null {
  if (input === undefined) return null

  if (input.kind === 'file') {
    setSingleFileRef(tx, slot, input.fileId)
    return { logoKey: null }
  }

  clearSingleFileRef(tx, slot)
  return { logoKey: input.kind === 'key' ? input.key : null }
}
