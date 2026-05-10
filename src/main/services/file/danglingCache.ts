/**
 * DanglingCache — external-entry presence tracker.
 *
 * Phase status: Phase 1b.3 implementation. Wraps a `Map<entryId, CachedState>`
 * cache + `Map<canonicalPath, Set<entryId>>` reverse index, with TTL-based
 * lazy expiration (default 30 min, see [file-manager-architecture.md §11.2]).
 *
 * Responsibilities:
 * - Maintain a best-effort "present / missing / unknown" state per external
 *   FileEntry, populated lazily from `fs.stat` and updated eagerly by
 *   DirectoryWatcher events (auto-wired through `createDirectoryWatcher`).
 * - Serve File IPC `getDanglingState` / `batchGetDanglingStates` queries
 *   without blocking on FS IO in the hot path (cache hit returns synchronously).
 *   DataApi never reads this cache — DataApi is strict SQL-only.
 * - Emit subscription events so the UI can react to external file
 *   disappearance without polling. Renderer fan-out via `webContents.send`
 *   is deferred to Phase 2 — this module exposes only an in-process `Event<T>`.
 *
 * Internal entries are always `'present'` — the cache is external-only.
 *
 * See [file-manager-architecture.md §11](../../../docs/references/file/file-manager-architecture.md)
 * for the full design; see RFC §9.5 for Phase 1b.3 deliverables.
 */

import type { Event } from '@main/core/lifecycle'
import { Emitter } from '@main/core/lifecycle'
import { exists as fsExists } from '@main/utils/file/fs'
import type { DanglingState, FileEntry, FileEntryId } from '@shared/data/types/file'
import type { FilePath } from '@shared/file/types'

/**
 * Observed presence of an external file. Distinct from `DanglingState`
 * because `'unknown'` is an absence-of-observation signal produced by the
 * *cache*, not the FS.
 */
export type ObservedPresence = 'present' | 'missing'

/** Listener fired when an entry's `DanglingState` transitions. */
export type DanglingListener = (entryId: FileEntryId, next: DanglingState) => void

/**
 * Fired on every genuine state transition — same-state observations are
 * silent. Internal-origin entries never fire (they are always `'present'`
 * by construction).
 */
export interface DanglingStateChangedEvent {
  readonly id: FileEntryId
  readonly state: ObservedPresence
}

interface CachedState {
  readonly state: ObservedPresence
  readonly observedAt: number
  readonly source: 'watcher' | 'ops' | 'stat' | 'forceRecheck'
}

export interface DanglingCache {
  /**
   * Resolve the current `DanglingState` for an entry. Hot path: returns
   * synchronously on cache hit; falls back to a single `fs.stat` on miss
   * or TTL-expired cache. Internal entries always resolve to `'present'`
   * without touching FS.
   */
  check(entry: FileEntry): Promise<DanglingState>

  /**
   * Always re-stat regardless of cache freshness. Used by callers with
   * stricter freshness requirements than a plain query (e.g. the Phase 1b.4
   * orphan scanner's pre-delete verification step).
   */
  forceRecheck(entry: FileEntry): Promise<DanglingState>

  /**
   * Ingest an FS-event observation. Auto-wired by `createDirectoryWatcher`
   * for `add` (`'present'`) and `unlink` (`'missing'`); FileManager ops
   * may also call directly to record opportunistic observations.
   */
  onFsEvent(path: FilePath, state: ObservedPresence, source?: CachedState['source']): void

  /** Add an entry to the reverse index. Idempotent. */
  addEntry(entryId: FileEntryId, externalPath: FilePath): void

  /** Remove an entry from the reverse index. Idempotent. */
  removeEntry(entryId: FileEntryId, externalPath: FilePath): void

  /**
   * Populate the reverse index from non-trashed external entries in the DB.
   * Stat is NOT performed during init — state stays `'unknown'` until the
   * first `check()` or watcher event refreshes it.
   */
  initFromDb(): Promise<void>

  /**
   * Subscribe to state transitions for a specific entry. Returns an
   * unsubscribe function. The listener is called synchronously inside
   * `Emitter.fire` — do not throw from it.
   */
  subscribe(entryId: FileEntryId, listener: DanglingListener): () => void

  /**
   * Public event surface for cross-cutting consumers (e.g. FileManager
   * fanning out to renderer windows in Phase 2). Fires only on genuine
   * state transitions.
   */
  readonly onDanglingStateChanged: Event<DanglingStateChangedEvent>

  /** Dev/test helper: drop all cached state. */
  clear(): void
}

/** Minimal external-entries source the cache needs at startup. */
interface FileEntrySource {
  findMany(query: { origin: 'external' }): Promise<FileEntry[]>
}

export interface DanglingCacheOptions {
  /** ms epoch source — overridable for tests. Default: `Date.now`. */
  readonly now?: () => number
  /**
   * Stat probe: returns `'present'` if the path resolves to an existing
   * file/dir, `'missing'` on ENOENT. Other FS errors propagate.
   * Default: `@main/utils/file/exists` wrapper.
   */
  readonly statProbe?: (path: FilePath) => Promise<ObservedPresence>
  /** TTL window in ms (default 30 min, per architecture §11.2). */
  readonly ttlMs?: number
  /**
   * External-entry source for `initFromDb`. Default: lazy-import
   * `@data/services/FileEntryService` at first call (avoids a circular
   * load between the cache singleton and the service singleton).
   */
  readonly fileEntryService?: FileEntrySource
}

const DEFAULT_TTL_MS = 30 * 60 * 1000

const defaultStatProbe = async (path: FilePath): Promise<ObservedPresence> => {
  return (await fsExists(path)) ? 'present' : 'missing'
}

class DanglingCacheImpl implements DanglingCache {
  private readonly byEntryId = new Map<FileEntryId, CachedState>()
  private readonly pathToEntryIds = new Map<FilePath, Set<FileEntryId>>()
  private readonly _emitter = new Emitter<DanglingStateChangedEvent>()
  public readonly onDanglingStateChanged: Event<DanglingStateChangedEvent> = this._emitter.event

  private readonly now: () => number
  private readonly statProbe: (path: FilePath) => Promise<ObservedPresence>
  private readonly ttlMs: number
  private fileEntryService: FileEntrySource | undefined

  constructor(opts: DanglingCacheOptions = {}) {
    this.now = opts.now ?? Date.now
    this.statProbe = opts.statProbe ?? defaultStatProbe
    this.ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS
    this.fileEntryService = opts.fileEntryService
  }

  async check(entry: FileEntry): Promise<DanglingState> {
    if (entry.origin === 'internal') return 'present'
    const cached = this.byEntryId.get(entry.id)
    if (cached && this.now() - cached.observedAt < this.ttlMs) return cached.state
    return this.doStatAndUpdate(entry, 'stat')
  }

  private async doStatAndUpdate(entry: FileEntry, source: CachedState['source']): Promise<ObservedPresence> {
    const path = entry.externalPath as FilePath
    const state = await this.statProbe(path)
    this.commit(entry.id, state, source)
    return state
  }

  /**
   * Update byEntryId for `id` with the new observation and fire
   * onDanglingStateChanged ONLY when the cached state changes (or transitions
   * from "no observation" to a concrete state). Same-state observations are
   * silent — see architecture §11.7 emission rules.
   */
  private commit(id: FileEntryId, next: ObservedPresence, source: CachedState['source']): void {
    const prev = this.byEntryId.get(id)?.state
    this.byEntryId.set(id, { state: next, observedAt: this.now(), source })
    if (prev !== next) this._emitter.fire({ id, state: next })
  }

  async forceRecheck(entry: FileEntry): Promise<DanglingState> {
    if (entry.origin === 'internal') return 'present'
    return this.doStatAndUpdate(entry, 'forceRecheck')
  }

  onFsEvent(path: FilePath, state: ObservedPresence, source: CachedState['source'] = 'watcher'): void {
    const ids = this.pathToEntryIds.get(path)
    if (!ids || ids.size === 0) return
    for (const id of ids) {
      this.commit(id, state, source)
    }
  }

  addEntry(entryId: FileEntryId, externalPath: FilePath): void {
    let set = this.pathToEntryIds.get(externalPath)
    if (!set) {
      set = new Set()
      this.pathToEntryIds.set(externalPath, set)
    }
    set.add(entryId)
  }

  removeEntry(entryId: FileEntryId, externalPath: FilePath): void {
    const set = this.pathToEntryIds.get(externalPath)
    if (!set) return
    set.delete(entryId)
    if (set.size === 0) this.pathToEntryIds.delete(externalPath)
    this.byEntryId.delete(entryId)
  }

  async initFromDb(): Promise<void> {
    throw new Error('DanglingCache.initFromDb: not implemented yet (Phase 1b.3 in progress)')
  }

  subscribe(entryId: FileEntryId, listener: DanglingListener): () => void {
    const subscription = this._emitter.event((e) => {
      if (e.id === entryId) listener(e.id, e.state)
    })
    return () => subscription.dispose()
  }

  clear(): void {
    this.byEntryId.clear()
    this.pathToEntryIds.clear()
  }
}

/**
 * Construct a fresh DanglingCache instance. Tests use this for isolation
 * with injected clock / stat / DB seams. Production code uses the
 * `danglingCache` singleton below.
 */
export function createDanglingCacheImpl(opts?: DanglingCacheOptions): DanglingCache {
  return new DanglingCacheImpl(opts)
}

export const danglingCache: DanglingCache = new DanglingCacheImpl()
