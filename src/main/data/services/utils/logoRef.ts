/** Logo-specific key/file/default reconciliation over a single FileRef slot. */

import type { FileEntryId } from '@shared/data/types/file'

import { clearSingleFileRef, setSingleFileRef, type SingleFileRefTable } from './singleFileRef'

export type LogoBindInput = { kind: 'key'; key: string } | { kind: 'file'; fileId: FileEntryId } | { kind: 'default' }

export interface LogoColumns {
  logoKey: string | null
}

export function reconcileLogoSlotTx(
  // biome-ignore lint: Drizzle database and transaction share the required methods.
  tx: any,
  table: SingleFileRefTable,
  sourceId: string,
  input: LogoBindInput | undefined
): LogoColumns | null {
  if (input === undefined) return null

  if (input.kind === 'file') {
    setSingleFileRef(tx, table, sourceId, input.fileId)
    return { logoKey: null }
  }

  clearSingleFileRef(tx, table, sourceId)
  return { logoKey: input.kind === 'key' ? input.key : null }
}
