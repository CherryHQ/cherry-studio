/**
 * DirectoryWatcher — generic FS-monitoring primitive.
 *
 * Phase status: Phase 1a exports the **factory signature + event union only**.
 * The concrete watcher (chokidar-backed, debounce + dedupe, DanglingCache
 * auto-wire) lands in Phase 1b.3.
 *
 * ## Positioning
 *
 * - **Not a lifecycle service.** Business modules (e.g. a future NoteService)
 *   instantiate their own watcher via `createDirectoryWatcher(path)` and
 *   dispose it themselves; the factory transparently forwards events into
 *   the file-module's `DanglingCache` so external-entry presence tracking
 *   stays coherent across all watchers.
 * - **Open to the entire main process.** Like the `@main/utils/file/*`
 *   primitives, the watcher has no entry-system awareness; it is a thin
 *   wrapper over `chokidar` with house conventions (ignore rules, debounce
 *   window, event normalization).
 *
 * See [file-manager-architecture.md §8](../../../../docs/references/file/file-manager-architecture.md)
 * and RFC §9.5 for the full design.
 */

import type { FilePath } from '@shared/file/types'

/**
 * Normalized FS event. Rename is represented as `unlink` + `add` — consumers
 * that need "rename" semantics correlate the pair themselves (see
 * §8.3 "Rename Detection Semantics" in file-manager-architecture.md).
 */
export type WatcherEvent =
  | { readonly kind: 'add'; readonly path: FilePath }
  | { readonly kind: 'unlink'; readonly path: FilePath }
  | { readonly kind: 'change'; readonly path: FilePath }
  | { readonly kind: 'ready' }
  | { readonly kind: 'error'; readonly error: Error }

export type WatcherListener = (event: WatcherEvent) => void

export interface DirectoryWatcher {
  /**
   * Subscribe to normalized FS events. Returns an unsubscribe function.
   * Multiple subscribers are supported; delivery order across subscribers is
   * unspecified.
   */
  onEvent(listener: WatcherListener): () => void

  /**
   * Stop watching and release all OS-level resources. Idempotent.
   */
  close(): Promise<void>
}

export interface CreateDirectoryWatcherOptions {
  /** Recurse into subdirectories. Default: `true`. */
  readonly recursive?: boolean
  /** Custom ignore predicate. Built-in ignores (node_modules, .DS_Store, etc.) always apply. */
  readonly ignore?: (path: FilePath) => boolean
  /** Coalesce burst events within this window (ms). Default: 100. */
  readonly debounceMs?: number
}

/**
 * Create a watcher rooted at `root`. The returned instance is ready to
 * subscribe immediately; a `'ready'` event fires once the initial scan
 * completes. Factory auto-wires events into `danglingCache.onFsEvent`.
 */
// oxlint-disable-next-line no-unused-vars -- TODO(phase-1b): drop once implementation lands in Phase 1b.3.
export function createDirectoryWatcher(_root: FilePath, _opts?: CreateDirectoryWatcherOptions): DirectoryWatcher {
  throw new Error('createDirectoryWatcher: not implemented (Phase 1a skeleton, lands in Phase 1b.3)')
}
