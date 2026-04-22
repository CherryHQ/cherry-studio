/**
 * DanglingCache — external-entry presence tracker.
 *
 * Phase status: Phase 1a exports the **interface only**. The concrete
 * singleton (reverse-index Map<path, Set<entryId>>, cold-path `fs.stat`
 * fallback, watcher-event ingestion) lands in Phase 1b.3.
 *
 * Responsibilities (target):
 * - Maintain a best-effort "present / missing / unknown" state per external
 *   FileEntry, populated lazily from `fs.stat` and updated eagerly by
 *   DirectoryWatcher events.
 * - Serve DataApi `includeDangling` queries without blocking on FS IO in the
 *   hot path (cache hit returns synchronously).
 * - Emit subscription events so the UI can react to external file
 *   disappearance without polling.
 *
 * Internal entries are always `'present'` — the cache is external-only.
 *
 * See [file-manager-architecture.md §11](../../../docs/references/file/file-manager-architecture.md)
 * for the full design; see RFC §9.5 for Phase 1b.3 deliverables.
 */

import type { DanglingState, FileEntry, FileEntryId } from '@shared/data/types/file'
import type { FilePath } from '@shared/file/types'

/**
 * Observed presence of an external file, as reported by the watcher or a
 * cold-path stat. Distinct from `DanglingState` because `'unknown'` is an
 * absence-of-observation signal produced by the *cache*, not the FS.
 */
export type ObservedPresence = 'present' | 'missing'

/** Listener fired when an entry's `DanglingState` transitions. */
export type DanglingListener = (entryId: FileEntryId, next: DanglingState) => void

export interface DanglingCache {
  /**
   * Resolve the current `DanglingState` for an entry. Hot path: returns
   * synchronously on cache hit; falls back to a single `fs.stat` on miss.
   * Internal entries always resolve to `'present'` without touching FS.
   */
  check(entry: FileEntry): Promise<DanglingState>

  /**
   * Ingest an FS-event observation. Typically wired from `createDirectoryWatcher`;
   * tests may call directly.
   */
  onFsEvent(path: FilePath, state: ObservedPresence): void

  /**
   * Subscribe to state transitions for a specific entry. Returns an unsubscribe
   * function. Subscribers are called asynchronously — do not rely on ordering
   * across different entries.
   */
  subscribe(entryId: FileEntryId, listener: DanglingListener): () => void

  /**
   * Dev/test helper: drop all cached state. Production code should never need
   * this — restart the file module instead.
   */
  clear(): void
}

const notImplemented = (op: string): never => {
  throw new Error(`danglingCache.${op}: not implemented (Phase 1a skeleton, lands in Phase 1b.3)`)
}

export const danglingCache: DanglingCache = {
  check: () => notImplemented('check'),
  onFsEvent: () => notImplemented('onFsEvent'),
  subscribe: () => notImplemented('subscribe'),
  clear: () => notImplemented('clear')
}
