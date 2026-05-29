/**
 * `dispatchHandle` — uniform `FileHandle` → `entry-fn` / `path-fn` switch.
 *
 * FileManager IPC handlers accept `FileHandle` and dispatch to either the
 * entry-aware (FileManager.read, hash, …) or the path-only (`readByPath`,
 * `hashByPath`, …) branch based on `handle.kind`. Centralising the switch
 * keeps every handler symmetrical and makes adding a future `kind` (rare)
 * a single-file change.
 */

import type { FileEntryId } from '@shared/data/types/file'
import type { FileHandle, FilePath } from '@shared/file/types'

export async function dispatchHandle<T>(
  handle: FileHandle,
  byEntryFn: (entryId: FileEntryId) => Promise<T>,
  byPathFn: (target: FilePath) => Promise<T>
): Promise<T> {
  switch (handle.kind) {
    case 'entry':
      return byEntryFn(handle.entryId)
    case 'path':
      return byPathFn(handle.path)
    default: {
      const _exhaust: never = handle
      throw new Error(`dispatchHandle: unknown handle kind ${JSON.stringify(_exhaust)}`)
    }
  }
}
