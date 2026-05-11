/**
 * DirectoryWatcher — generic FS-monitoring primitive.
 *
 * Wraps `chokidar@4` with a minimal event surface (`add` / `unlink` /
 * `change` / `ready` / `error`) and auto-wires `add` / `unlink` events into
 * the file-module's `DanglingCache` singleton so external-entry presence
 * tracking stays coherent across all watchers.
 *
 * ## Positioning
 *
 * - **Not a lifecycle service.** Business modules (e.g. a future NoteService)
 *   instantiate their own watcher via `createDirectoryWatcher(path)` and
 *   dispose it themselves; the factory transparently forwards events into
 *   `DanglingCache`.
 * - **Open to the entire main process.** Like `@main/utils/file/*` primitives,
 *   the watcher has no entry-system awareness; it is a thin wrapper over
 *   `chokidar` with house conventions (built-in OS-junk ignores, optional
 *   debounce window).
 *
 * ## Deviation from `file-manager-architecture.md §8.2`
 *
 * The architecture doc specifies a richer API (separate `onAdd` / `onAddDir`
 * / `onUnlink` / `onUnlinkDir` / `onRename` / `onError` / `onReady` events
 * with rename-detection options). This module currently ships only the
 * events that have a consumer in the current scope:
 * - directory add/remove not surfaced (no consumer needs it)
 * - rename detection deferred (paired with `onRename` deliverable)
 *
 * Future expansions can additively grow the `WatcherEvent` union without
 * breaking existing subscribers.
 *
 * See [file-manager-architecture.md §8](../../../../docs/references/file/file-manager-architecture.md)
 * for the full design.
 */

import path from 'node:path'

import { loggerService } from '@logger'
import { Emitter } from '@main/core/lifecycle'
import type { FilePath } from '@shared/file/types'
import { type FSWatcher, watch as chokidarWatch } from 'chokidar'

import { danglingCache } from '../danglingCache'

const logger = loggerService.withContext('file/watcher')

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
  /** Custom ignore predicate. Built-in ignores (`.DS_Store`, `Thumbs.db`, etc.) always apply. */
  readonly ignore?: (path: FilePath) => boolean
  /** Stability window for `awaitWriteFinish` (ms). Default: 200. Set to 0 to disable. */
  readonly stabilityThresholdMs?: number
}

/** OS-junk basenames suppressed regardless of caller's `ignore` predicate. */
const BUILTIN_IGNORE_BASENAMES = new Set(['.DS_Store', '.localized', 'Thumbs.db', 'desktop.ini'])

class DirectoryWatcherImpl implements DirectoryWatcher {
  private readonly fsw: FSWatcher
  private readonly emitter = new Emitter<WatcherEvent>()
  private closed = false

  constructor(root: FilePath, opts: CreateDirectoryWatcherOptions = {}) {
    const builtinIgnore = (p: string) => BUILTIN_IGNORE_BASENAMES.has(path.basename(p))
    const userIgnore = opts.ignore
    const recursive = opts.recursive !== false
    const stability = opts.stabilityThresholdMs ?? 200

    this.fsw = chokidarWatch(root, {
      ignored: userIgnore ? [builtinIgnore, (p) => userIgnore(p as FilePath)] : [builtinIgnore],
      ignoreInitial: true,
      depth: recursive ? undefined : 0,
      awaitWriteFinish: stability > 0 ? { stabilityThreshold: stability, pollInterval: 100 } : false
    })

    this.fsw.on('add', (p) => this.handle({ kind: 'add', path: p as FilePath }))
    this.fsw.on('change', (p) => this.handle({ kind: 'change', path: p as FilePath }))
    this.fsw.on('unlink', (p) => this.handle({ kind: 'unlink', path: p as FilePath }))
    this.fsw.on('ready', () => this.emitter.fire({ kind: 'ready' }))
    this.fsw.on('error', (err) => {
      // Log proactively: chokidar errors (EMFILE, lost permissions on a
      // parent dir, etc.) silently stop event delivery; without this log a
      // dead watcher leaves the cache stale with no diagnostic trace.
      logger.error('chokidar error', err as Error)
      this.emitter.fire({ kind: 'error', error: err as Error })
    })
  }

  /**
   * Forward chokidar's `add` / `unlink` / `change` events to subscribers AND
   * mirror presence transitions into DanglingCache. `change` is intentionally
   * not mirrored — the file is still present; only mtime drift, which the
   * cache doesn't track.
   */
  private handle(ev: Extract<WatcherEvent, { path: FilePath }>): void {
    if (this.closed) return
    if (ev.kind === 'add') danglingCache.onFsEvent(ev.path, 'present', 'watcher')
    else if (ev.kind === 'unlink') danglingCache.onFsEvent(ev.path, 'missing', 'watcher')
    this.emitter.fire(ev)
  }

  onEvent(listener: WatcherListener): () => void {
    const subscription = this.emitter.event(listener)
    return () => subscription.dispose()
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    await this.fsw.close()
    this.emitter.dispose()
  }
}

/**
 * Create a watcher rooted at `root`. The returned instance is ready to
 * subscribe immediately; a `'ready'` event fires once the initial scan
 * completes. The factory auto-wires `add` / `unlink` events into
 * `danglingCache.onFsEvent` so external-entry presence tracking is updated
 * regardless of whether the watcher's own subscriber consumes those events.
 */
export function createDirectoryWatcher(root: FilePath, opts?: CreateDirectoryWatcherOptions): DirectoryWatcher {
  return new DirectoryWatcherImpl(root, opts)
}
