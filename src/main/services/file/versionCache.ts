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

/**
 * LRU implementation backed by JavaScript's insertion-ordered Map.
 *
 * Recency is updated on every successful `get` (the entry is removed and
 * re-inserted to move it to the tail) and every `set` (already-present keys
 * are deleted before re-insert). When the store size exceeds `capacity`, the
 * head of the map (the least-recently used entry) is evicted.
 *
 * The default singleton uses capacity 2000 per architecture.md §4.4.
 */
class VersionCacheImpl implements VersionCache {
  private readonly store = new Map<FileEntryId, FileVersion>()
  constructor(private readonly capacity: number) {}

  get(id: FileEntryId): FileVersion | undefined {
    const v = this.store.get(id)
    if (v === undefined) return undefined
    this.store.delete(id)
    this.store.set(id, v)
    return v
  }

  set(id: FileEntryId, version: FileVersion): void {
    if (this.store.has(id)) this.store.delete(id)
    this.store.set(id, version)
    if (this.store.size > this.capacity) {
      const oldest = this.store.keys().next().value as FileEntryId | undefined
      if (oldest !== undefined) this.store.delete(oldest)
    }
  }

  invalidate(id: FileEntryId): void {
    this.store.delete(id)
  }

  clear(): void {
    this.store.clear()
  }
}

/** Test/dev helper — production code should use the `versionCache` singleton. */
export function createVersionCacheImpl(capacity: number): VersionCache {
  return new VersionCacheImpl(capacity)
}

export const versionCache: VersionCache = new VersionCacheImpl(2000)
