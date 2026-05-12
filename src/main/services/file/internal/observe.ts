/**
 * `observeExternalAccess(deps, entry, physicalPath, op)` — single chokepoint
 * that converts an "FS access reported the external file gone" signal into
 * a `DanglingCache` 'missing' transition.
 *
 * Every code path that touches an external entry's physical file (read,
 * hash, getMetadata, getVersion) is expected to wrap its IO through here.
 * Centralising the ENOENT-detection logic keeps the dangling-state UX
 * consistent: UI surfaces driven by `DanglingCache` flip to 'missing' on
 * the same operations regardless of which method the caller used to access
 * the file.
 *
 * Semantics:
 * - `op()` succeeds → returned as-is; cache is NOT touched (a successful
 *   access does not force 'present' — the cache learns 'present' from the
 *   watcher or from explicit ops-side updates, not from passive reads).
 * - `op()` throws ENOENT or ENOTDIR and `entry.origin === 'external'` →
 *   cache commits 'missing' for the path with `source: 'ops'`, then the
 *   original error re-throws so callers still observe the failure.
 *   ENOTDIR is the "ancestor directory was replaced by a non-directory"
 *   signal — same "path proven non-existent" semantics as ENOENT, and
 *   `defaultStatProbe` already treats them identically.
 * - Any other throw → re-throws unchanged (no cache mutation, no swallow).
 */

import type { FileEntry } from '@shared/data/types/file'
import type { FilePath } from '@shared/file/types'

import type { FileManagerDeps } from './deps'

export async function observeExternalAccess<T>(
  deps: FileManagerDeps,
  entry: FileEntry,
  physicalPath: FilePath,
  op: () => Promise<T>
): Promise<T> {
  try {
    return await op()
  } catch (err) {
    if (entry.origin === 'external') {
      const code = (err as NodeJS.ErrnoException).code
      if (code === 'ENOENT' || code === 'ENOTDIR') {
        deps.danglingCache.onFsEvent(physicalPath, 'missing', 'ops')
      }
    }
    throw err
  }
}
