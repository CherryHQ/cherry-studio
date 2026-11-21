import type { CherryMessagePart } from '@shared/data/types/message'
import { readCherryMeta } from '@shared/data/types/uiParts'

/** A main-owned projection: native input parts remain immutable in storage. */
export function withoutDetachedFileParts(parts: CherryMessagePart[] | undefined, detachedIds: readonly string[]) {
  const detached = new Set(detachedIds)
  return (parts ?? []).filter((part) => {
    if (part.type !== 'file') return true
    const meta = readCherryMeta(part)
    return !detached.has(meta?.fileEntryId ?? '') && !detached.has(meta?.workingFileEntryId ?? '')
  })
}
