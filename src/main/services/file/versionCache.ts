/**
 * VersionCache — per-process LRU cache of `FileVersion` for managed entries.
 *
 * Phase status: Phase 1a exports the **interface only**. The concrete LRU
 * implementation (size bound, eviction policy, integration with
 * `writeIfUnchanged`, FileVersion precision fallback for second-precision
 * mtime + same size) lands in Phase 1b.2.
 *
 * ## Scope
 *
 * - **Per-process, in-memory**. Multiple renderer windows share the main
 *   instance through IPC; there is no cross-process cache coherence.
 * - **Best-effort**, not a source of truth. The authoritative FileVersion is
 *   always `statVersion(path)` from `@main/utils/file/fs`; the cache exists to avoid repeating that
 *   stat on hot paths (e.g. successive `read` → `writeIfUnchanged` on the
 *   same entry within a few hundred ms).
 * - Eviction may drop entries at any time; callers must tolerate `get`
 *   returning `undefined`.
 */

import type { FileEntryId } from '@shared/data/types/file'

import type { FileVersion } from './FileManager'

export interface VersionCache {
  /** Return the cached `FileVersion` for an entry, or `undefined` on miss. */
  get(id: FileEntryId): FileVersion | undefined

  /** Record the latest observed `FileVersion`. Overwrites on existing key. */
  set(id: FileEntryId, version: FileVersion): void

  /**
   * Drop the cached entry (e.g. after `permanentDelete`). Safe to call on a
   * missing key.
   */
  invalidate(id: FileEntryId): void

  /** Dev/test helper: drop all cached entries. */
  clear(): void
}
