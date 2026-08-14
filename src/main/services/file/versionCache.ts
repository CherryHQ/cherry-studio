/**
 * VersionCache — per-FileManager LRU cache of `FileVersion` for managed entries.
 *
 * Construction: a fresh instance is created as a private field on each
 * `FileManager` (see file-manager-architecture.md §1.6.1 / §12 — picked over
 * a module singleton specifically so each `new FileManager()` in tests gets
 * an isolated cache).
 *
 * ## Scope
 *
 * - **Per-FileManager, in-memory**. Multiple renderer windows share the main
 *   instance through IPC; there is no cross-process cache coherence.
 * - **Best-effort**, not a source of truth. The authoritative FileVersion is
 *   always `statVersion(path)` from `@main/utils/file/fs`; the cache exists to
 *   avoid repeating that stat on hot paths (e.g. successive `read` →
 *   `writeIfUnchanged` on the same entry within a few hundred ms).
 * - Eviction may drop entries at any time; callers must tolerate `get`
 *   returning `undefined`.
 */

import type { FileEntryId } from '@shared/data/types/file'
import { LRUCache } from 'lru-cache'

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

/**
 * Construct a fresh VersionCache. Production callers go through `FileManager`.
 *
 * Backed by `lru-cache`'s default LRU behavior: `get()` promotes the entry
 * to most-recently-used; `set()` evicts the least-recently-used entry once
 * `capacity` is exceeded.
 */
export function createVersionCacheImpl(capacity: number): VersionCache {
  const store = new LRUCache<FileEntryId, FileVersion>({ max: capacity })
  return {
    get: (id) => store.get(id),
    set: (id, version) => {
      store.set(id, version)
    },
    invalidate: (id) => {
      store.delete(id)
    },
    clear: () => {
      store.clear()
    }
  }
}
