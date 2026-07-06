/**
 * `dispatchHandle` — uniform `FileHandle` → `entry-fn` / `path-fn` switch.
 *
 * File IPC handlers accept `FileHandle` and dispatch to either the entry-aware
 * (FileManager.read, hash, …) or the path-only (`readByPath`, `hashByPath`, …)
 * branch based on `handle.kind`. Centralising the switch keeps every handler
 * symmetrical and makes adding a future `kind` (rare) a single-file change.
 *
 * TODO(file-ipc): Temporary location. This helper currently lives under
 * `services/file/internal` because legacy FileManager-owned IPC handlers still
 * use it. Once FileManager no longer registers any IPC handlers, move this
 * helper to the IPC adapter layer (for example under `src/main/ipc/handlers/`
 * or a nearby IPC utility) so FileHandle dispatch ownership matches the
 * renderer-transport boundary.
 */

import type { FileEntryId, FileHandle } from '@shared/data/types/file'
import type { FilePath } from '@shared/types/file'

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
