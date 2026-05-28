/**
 * DirectoryTreeBuilder — implementation. SoT:
 * `docs/references/file/directory-tree.md`.
 *
 * Owns:
 *   - one `TreeDirRoot` mirror of the filesystem subtree rooted at `rootPath`
 *   - a `Map<absPath, TreeNode>` reverse index (O(1) lookup for watcher
 *     events, which arrive keyed by path)
 *   - a `DirectoryWatcher` subscription that translates raw FS events into
 *     `TreeMutationEvent`s and keeps the tree coherent
 *
 * Strict scope (directory-tree.md §2.2):
 *   - No `@main/data/**` imports — the tree is a runtime / render-layer
 *     primitive, not a persistence concern. Enforcement is the import-graph
 *     regex test in `__tests__/builder.test.ts`.
 *   - No `noteTable` / `fileEntry` knowledge — Notes joins this primitive
 *     to its sparse state table renderer-side.
 *
 * Backpressure: `initialScanPromise` serializes early watcher events behind
 * the initial scan so a watcher event for a path the scan is about to
 * insert never lands first.
 */

import { stat as nodeStat } from 'node:fs/promises'
import path from 'node:path'

import { loggerService } from '@logger'
import { type Disposable, Emitter } from '@main/core/lifecycle'
import { createDirectoryWatcher, type DirectoryWatcher, type WatcherEvent } from '@main/services/file/watcher'
import {
  type DirectoryTreeOptions,
  type FilePath,
  type SerializedTreeNode,
  TreeDir,
  TreeDirRoot,
  TreeFile,
  type TreeMutationEvent,
  type TreeNode,
  type TreeNodeStats
} from '@shared/file/types'

import { type GitignorePredicate, loadGitignorePredicate } from './gitignore'
import { listDirectory as searchListDirectory } from './search'

const logger = loggerService.withContext('file/tree/builder')

interface ResolvedTreeOptions {
  readonly extensions: ReadonlySet<string> | null // null = allow all
  readonly respectGitignore: boolean
  readonly includeHidden: boolean
  readonly withStats: boolean
  readonly maxDepth: number
}

function resolveOptions(options: DirectoryTreeOptions | undefined): ResolvedTreeOptions {
  const exts = options?.extensions?.map((e) => (e.startsWith('.') ? e.toLowerCase() : `.${e.toLowerCase()}`)) ?? []
  return {
    extensions: exts.length > 0 ? new Set(exts) : null,
    respectGitignore: options?.respectGitignore ?? true,
    includeHidden: options?.includeHidden ?? false,
    withStats: options?.withStats ?? false,
    maxDepth: options?.maxDepth ?? Number.MAX_SAFE_INTEGER
  }
}

function normalizePath(p: string): string {
  return p.replace(/\\/g, '/')
}

function extOf(filename: string): string {
  const dot = filename.lastIndexOf('.')
  return dot < 0 ? '' : filename.slice(dot).toLowerCase()
}

/** True if the file basename's extension is permitted by `options.extensions`. */
function passesExtensionFilter(filePath: string, options: ResolvedTreeOptions): boolean {
  if (!options.extensions) return true
  const base = path.basename(filePath)
  return options.extensions.has(extOf(base))
}

function statsToFields(s: { mtimeMs: number; birthtimeMs: number }): TreeNodeStats {
  // Some filesystems (ext4 < kernel 4.11, FAT, certain NFS) don't track birthtime;
  // mtimeMs is a safe fallback so consumers can sort consistently.
  const birth = s.birthtimeMs > 0 ? s.birthtimeMs : s.mtimeMs
  return { mtime: s.mtimeMs, birthtime: birth }
}

async function statQuiet(absPath: string): Promise<TreeNodeStats | undefined> {
  try {
    const s = await nodeStat(absPath)
    return statsToFields(s)
  } catch {
    return undefined
  }
}

export interface DirectoryTreeBuilder extends Disposable {
  readonly root: TreeDirRoot
  readonly onMutation: (listener: (e: TreeMutationEvent) => void) => Disposable
  /** O(1) lookup of any node by its absolute path. */
  getNode(absPath: string): TreeNode | null
  /** Snapshot the entire tree as a serializable DTO. */
  snapshot(): SerializedTreeNode
  /**
   * Apply a rename explicitly (caller already performed the FS rename).
   * Mutates the existing node in place via the `TreeNode.path` setter so
   * identity-based consumer caches (React keys, lookup maps) survive the
   * rename, then emits a `renamed` mutation. The chokidar `unlink` + `add`
   * events that arrive shortly after are suppressed by a short dedup window.
   *
   * Returns `false` when the node at `oldPath` is missing — typically a race
   * where chokidar's `unlink` fired before the explicit rename arrived. In
   * that case the renderer already saw `removed` + `added`; identity is lost
   * but state stays consistent.
   */
  rename(oldPath: string, newPath: string): boolean
  /**
   * Synchronous dispose — fires the watcher's `close()` as a dangling
   * promise. Suitable for grace-timer fires and other paths where the
   * caller doesn't need to wait for OS-level FD release. The watcher's
   * `close()` rejection is logged but otherwise swallowed.
   */
  dispose(): void
  /**
   * Async dispose — same teardown sequence as `dispose()` but awaits
   * `watcher.close()` so the caller can be sure FDs are released before
   * proceeding. Use this from `onStop()` and other shutdown paths that
   * may race with process exit; sync `dispose()`'s dangling promise can
   * lose its error log if the process exits first.
   */
  disposeAsync(): Promise<void>
}

class DirectoryTreeBuilderImpl implements DirectoryTreeBuilder {
  public root: TreeDirRoot
  private readonly map = new Map<string, TreeNode>()
  private readonly emitter = new Emitter<TreeMutationEvent>()
  public readonly onMutation = this.emitter.event
  private watcher: DirectoryWatcher | null = null
  private watcherSubscription: Disposable | null = null
  private readonly options: ResolvedTreeOptions
  private readonly rootPath: string
  // Loaded once during `init()`; what the user's `.gitignore` (plus the
  // always-on `.git` exclusion) says to skip. `null` when the caller
  // opted out via `respectGitignore: false` or the file isn't readable.
  // Defaults to a permissive predicate (matches nothing) so any code path
  // that consults it before `init()` resolves is safe.
  private ignorePredicate: GitignorePredicate | null = null
  private disposed = false
  private initialScanPromise: Promise<void> | null = null
  // Paths recently affected by an explicit `rename()` — used to suppress the
  // chokidar `unlink(oldPath)` + `add(newPath)` events that follow shortly
  // after, so the renderer doesn't apply `removed` + `added` on top of the
  // identity-preserving `renamed` it already received. Map value is the
  // expiry timestamp (ms epoch); entries are purged lazily on lookup.
  private readonly recentlyRenamed = new Map<string, number>()
  private static readonly RENAME_DEDUP_MS = 1000

  constructor(rootPath: string, options: ResolvedTreeOptions) {
    this.rootPath = normalizePath(rootPath)
    this.options = options
    this.root = new TreeDirRoot(this.rootPath)
    this.map.set(this.rootPath, this.root)
  }

  async init(): Promise<void> {
    // Load `.gitignore` off the event loop before the scan starts — slow
    // FS reads (network shares, fuse) must not block other main-process
    // work during construction.
    if (this.options.respectGitignore) {
      this.ignorePredicate = await loadGitignorePredicate(this.rootPath)
    }
    // Start the watcher *before* the initial scan completes so we don't
    // miss events for paths created during the scan window. The events are
    // queued behind the scan promise and applied after it resolves.
    this.initialScanPromise = this.runInitialScan()
    this.attachWatcher()
    await this.initialScanPromise
    // Clear once the scan is done so subsequent watcher events take the
    // synchronous fast path in the dispatcher instead of attaching another
    // `.then()` continuation to a settled promise per event.
    this.initialScanPromise = null
  }

  private async runInitialScan(): Promise<void> {
    // Let scan failures propagate. Swallowing them resolves File_TreeCreate
    // with an empty tree — indistinguishable from "the directory is genuinely
    // empty" to the renderer, which produces a silent regression (the user
    // sees zero notes when ripgrep is missing or the root is unreadable).
    const paths = await searchListDirectory(this.rootPath as FilePath, {
      recursive: true,
      maxDepth: this.options.maxDepth,
      includeHidden: this.options.includeHidden,
      includeFiles: true,
      includeDirectories: true,
      maxEntries: Number.MAX_SAFE_INTEGER
    })

    // Sort by depth ascending so parents always exist before children are
    // attached. Within a depth, sort alphabetically for stable display.
    // The gitignore predicate applies pre-stat — `search.listDirectory`
    // already prunes the obvious junk via ripgrep, but the predicate
    // catches anything the user listed in their own `.gitignore` plus
    // the always-on `.git` exclusion.
    const normalized = paths
      .map(normalizePath)
      .filter((p) => p !== this.rootPath)
      .filter((p) => !(this.ignorePredicate && this.ignorePredicate(p)))
    normalized.sort((a, b) => {
      const da = a.split('/').length
      const db = b.split('/').length
      if (da !== db) return da - db
      return a.localeCompare(b)
    })

    // Stat in parallel — gives us kind classification + optional stats.
    const classified = await Promise.all(
      normalized.map(async (p) => {
        try {
          const s = await nodeStat(p)
          return { path: p, isDir: s.isDirectory(), stats: statsToFields(s) }
        } catch {
          return null
        }
      })
    )

    for (const item of classified) {
      if (!item) continue
      if (this.disposed) return
      if (!item.isDir && !passesExtensionFilter(item.path, this.options)) continue
      this.insertNode(item.path, item.isDir ? 'directory' : 'file', item.stats, /* emit */ false)
    }

    // After scan, sort children for stable display order (folders-first).
    this.root.walk((node) => {
      if (node.isTreeDir()) node.sortChildren()
    })
  }

  private attachWatcher(): void {
    // Let attach failures propagate too. A silently-failed watcher install
    // produces a zombie builder: the initial snapshot looks fine but no
    // mutation will ever fire — worse than failing init() outright because
    // the renderer has no signal to retry.
    //
    // Pass the gitignore predicate to chokidar. Without it, chokidar
    // installs an FSEvents (macOS) or inotify (linux) handle per
    // directory and hits `ulimit -n` (EMFILE) the moment the workspace
    // is a real code repo with a `node_modules` blob. The predicate
    // fires before chokidar recurses into the dir, so the cost stays
    // at "one Ignore.ignores() call per entry".
    const predicate = this.ignorePredicate
    const watcherIgnore = predicate
      ? (((p: FilePath) => predicate(normalizePath(p))) as (path: FilePath) => boolean)
      : undefined

    this.watcher = createDirectoryWatcher(this.rootPath as FilePath, {
      recursive: true,
      stabilityThresholdMs: 200,
      ignore: watcherIgnore
    })
    this.watcherSubscription = {
      dispose: this.watcher.onEvent((ev) => {
        // Defer watcher events until the initial scan completes so we
        // don't apply a mutation for a path the scan is about to insert.
        if (this.initialScanPromise) {
          void this.initialScanPromise.then(() => this.handleWatcherEvent(ev))
        } else {
          void this.handleWatcherEvent(ev)
        }
      })
    }
  }

  private async handleWatcherEvent(ev: WatcherEvent): Promise<void> {
    if (this.disposed) return
    if (ev.kind === 'ready') return
    if (ev.kind === 'error') {
      // Watcher-fatal: chokidar surfaces EMFILE / ENOSPC / remote-share
      // disconnect here. The mirror after this point is stale by
      // definition — drop the watcher so we stop pretending mutations are
      // still tracked. The renderer keeps its last-known snapshot until it
      // remounts; a future change can synthesise a terminal mutation event
      // so consumers surface a stale-data banner.
      logger.error(`Watcher reported fatal error on ${this.rootPath} — disposing builder`, ev.error)
      this.dispose()
      return
    }

    const evPath = normalizePath(ev.path)
    // Belt-and-suspenders: chokidar's ignore predicate runs before
    // recursion, but in case of races (a `node_modules` event arrives
    // before chokidar processes the ignore for it), drop it here too.
    if (this.ignorePredicate && this.ignorePredicate(evPath)) return

    // Suppress the chokidar `unlink(oldPath)` + `add(newPath)` pair that
    // follows an explicit `rename()`. Without this the renderer would see
    // `renamed` → `removed` → `added` and lose the identity preservation
    // the explicit call existed to provide.
    if (this.isRenameSuppressed(evPath)) return

    if (ev.kind === 'add' || ev.kind === 'addDir') {
      const isDir = ev.kind === 'addDir'
      if (!isDir && !passesExtensionFilter(evPath, this.options)) return
      const stats = this.options.withStats ? await statQuiet(evPath) : undefined
      this.insertNode(evPath, isDir ? 'directory' : 'file', stats, /* emit */ true)
      return
    }

    if (ev.kind === 'unlink' || ev.kind === 'unlinkDir') {
      this.removeNode(evPath, /* emit */ true)
      return
    }

    if (ev.kind === 'change') {
      const existing = this.map.get(evPath)
      if (!existing) return
      if (this.options.withStats) {
        const stats = await statQuiet(evPath)
        if (stats) {
          existing.stats = stats
          this.emitter.fire({ type: 'updated', path: evPath, stats })
        }
      }
    }
  }

  /**
   * Attach a node at `absPath`. Walks up to ensure every intermediate parent
   * exists (creating it implicitly when the watcher delivers a deep file
   * before its enclosing directory event).
   */
  private insertNode(
    absPath: string,
    kind: 'file' | 'directory',
    stats: TreeNodeStats | undefined,
    emit: boolean
  ): TreeNode | null {
    if (absPath === this.rootPath) return this.root
    if (!absPath.startsWith(`${this.rootPath}/`)) return null

    const existing = this.map.get(absPath)
    if (existing) {
      if (stats && this.options.withStats) {
        existing.stats = stats
      }
      return existing
    }

    const parentPath = normalizePath(path.posix.dirname(absPath))
    const parent = this.ensureDirectory(parentPath)
    if (!parent) return null

    const basename = path.posix.basename(absPath)
    const node =
      kind === 'directory'
        ? new TreeDir({ path: absPath, stats: this.options.withStats ? stats : undefined })
        : new TreeFile({ path: absPath, stats: this.options.withStats ? stats : undefined })

    parent.attachChild(node)
    this.map.set(absPath, node)

    if (emit) {
      this.emitter.fire({
        type: 'added',
        path: absPath,
        kind,
        basename,
        parentPath,
        stats: this.options.withStats ? stats : undefined
      })
    }
    return node
  }

  /**
   * Resolve / create a `TreeDir` chain up to `absPath`. Used both during
   * initial scan and during deep-add watcher events.
   */
  private ensureDirectory(absPath: string): TreeDir | null {
    const existing = this.map.get(absPath)
    if (existing && existing.isTreeDir()) return existing
    if (existing && !existing.isTreeDir()) {
      // A node already exists at this path but is the wrong kind — this can
      // happen on Windows when an "add" arrives before the prior "unlink".
      // Replace it.
      this.removeNode(absPath, /* emit */ false)
    }
    if (absPath === this.rootPath) return this.root
    if (!absPath.startsWith(`${this.rootPath}/`)) return null

    const parentPath = normalizePath(path.posix.dirname(absPath))
    const parent = this.ensureDirectory(parentPath)
    if (!parent) return null

    const dir = new TreeDir({ path: absPath })
    parent.attachChild(dir)
    this.map.set(absPath, dir)
    this.emitter.fire({
      type: 'added',
      path: absPath,
      kind: 'directory',
      basename: path.posix.basename(absPath),
      parentPath
    })
    return dir
  }

  private removeNode(absPath: string, emit: boolean): void {
    const node = this.map.get(absPath)
    if (!node) return

    // Recursively prune descendants from the map for directory removals.
    if (node.isTreeDir()) {
      const toDrop: string[] = []
      node.walk((n) => {
        if (n !== node) toDrop.push(n.path)
      })
      for (const p of toDrop) this.map.delete(p)
    }

    this.map.delete(absPath)
    node.remove()

    if (emit) this.emitter.fire({ type: 'removed', path: absPath })
  }

  getNode(absPath: string): TreeNode | null {
    return this.map.get(normalizePath(absPath)) ?? null
  }

  rename(oldPath: string, newPath: string): boolean {
    if (this.disposed) return false
    const oldNorm = normalizePath(oldPath)
    const newNorm = normalizePath(newPath)
    if (oldNorm === newNorm) return false
    const node = this.map.get(oldNorm)
    if (!node) {
      // Race: chokidar's unlink already fired and removed the node. The
      // renderer has applied `removed`; the matching `added` for newNorm is
      // either pending or already applied. Identity is lost but we keep
      // the dedup window armed so the still-pending events don't
      // double-apply over what the renderer is about to receive.
      this.markRenamed(oldNorm, newNorm)
      return false
    }

    // Capture descendant paths before mutation so we can re-key the map.
    const oldPaths: string[] = [node.path]
    if (node.isTreeDir()) {
      node.walk((n) => {
        if (n !== node) oldPaths.push(n.path)
      })
    }

    // Mutate via the setter — adjustChildrenPaths cascades to descendants
    // and the parent's _children map gets repointed to the new basename.
    node.path = newNorm

    // Re-key the lookup map: drop every old descendant path, re-insert with
    // the cascaded new paths.
    for (const p of oldPaths) this.map.delete(p)
    this.map.set(node.path, node)
    if (node.isTreeDir()) {
      node.walk((n) => {
        if (n !== node) this.map.set(n.path, n)
      })
    }

    this.markRenamed(oldNorm, newNorm)
    this.emitter.fire({
      type: 'renamed',
      oldPath: oldNorm,
      newPath: newNorm,
      basename: node.basename
    })
    return true
  }

  /** Mark `(oldPath, newPath)` so the immediately-following chokidar
   *  `unlink(oldPath)` / `add(newPath)` events get dropped. */
  private markRenamed(oldPath: string, newPath: string): void {
    const expireAt = Date.now() + DirectoryTreeBuilderImpl.RENAME_DEDUP_MS
    this.recentlyRenamed.set(oldPath, expireAt)
    this.recentlyRenamed.set(newPath, expireAt)
  }

  /** True if `path` is inside the rename dedup window. Purges stale entries. */
  private isRenameSuppressed(path: string): boolean {
    const expireAt = this.recentlyRenamed.get(path)
    if (expireAt === undefined) return false
    if (Date.now() >= expireAt) {
      this.recentlyRenamed.delete(path)
      return false
    }
    return true
  }

  snapshot(): SerializedTreeNode {
    return this.root.toJSON()
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.watcherSubscription?.dispose()
    this.watcherSubscription = null
    void this.watcher?.close().catch((err) => logger.error('Watcher close failed', err as Error))
    this.watcher = null
    this.emitter.dispose()
    this.map.clear()
  }

  async disposeAsync(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    this.watcherSubscription?.dispose()
    this.watcherSubscription = null
    // Capture the watcher before nulling so we can await its close. The
    // close() promise may take real time on slow / unmounted FS — that's
    // exactly the case sync `dispose()` punts on by leaving a dangling
    // promise. onStop / disposeAll callers prefer to wait.
    const watcher = this.watcher
    this.watcher = null
    this.emitter.dispose()
    this.map.clear()
    if (watcher) {
      try {
        await watcher.close()
      } catch (err) {
        logger.error('Watcher close failed', err as Error)
      }
    }
  }
}

/**
 * Public factory. Awaits the initial scan so callers can synchronously read
 * `builder.root` / `builder.snapshot()` after the promise resolves.
 */
export async function createDirectoryTree(
  rootPath: string,
  options?: DirectoryTreeOptions
): Promise<DirectoryTreeBuilder> {
  const resolved = resolveOptions(options)
  const builder = new DirectoryTreeBuilderImpl(rootPath, resolved)
  await builder.init()
  return builder
}
