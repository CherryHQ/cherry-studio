/**
 * `DirectoryTreeManager` — main-process bookkeeping for active `DirectoryTreeBuilder`
 * instances behind the `Tree_*` IPC bridge.
 *
 * Every `File_TreeCreate` IPC call gets a unique `treeId` (the renderer needs
 * one to route mutation pushes), but identical `(rootPath, options)` pairs
 * **share one underlying `DirectoryTreeBuilder`** — one ripgrep scan, one
 * chokidar watcher, one set of FDs. This is the right place to dedupe
 * because the expensive resource lives on the main side; renderer-side
 * sharing would always pay an extra IPC round-trip per remount.
 *
 * When a `treeId` is disposed and that builder's last consumer leaves, the
 * tear-down is deferred by `DISPOSE_GRACE_MS`. React commits effects in
 * order "deletions before insertions" within a single commit — when
 * `ArtifactPane` swaps between `Shell.Host` and `Shell.MaximizedOverlay`
 * (or a tab unmounts and immediately remounts) the unmount fires
 * `File_TreeDispose` for the old id and the mount fires `File_TreeCreate` for the
 * new id back-to-back. The grace window lets the new call grab the still-
 * warm builder instead of waiting on a fresh scan + watcher install.
 *
 * Renderer→main IPC sequence on a tab/maximize remount:
 *   T0     unmount   File_TreeDispose(old)  → refcount=0, grace timer queued
 *   T0+ε   mount     File_TreeCreate(...)   → cancels timer, attaches as new consumer
 */

import { randomUUID } from 'node:crypto'

import { loggerService } from '@logger'
import { BaseService, type Disposable, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { AbsolutePathSchema } from '@shared/data/types/file'
import { IpcChannel } from '@shared/IpcChannel'
import {
  type CreateTreeIpcResult,
  type DirectoryTreeOptions,
  DirectoryTreeOptionsSchema,
  type TreeMutationPushPayload
} from '@shared/utils/file'
import type { WebContents } from 'electron'
import * as z from 'zod'

import { createDirectoryTree, type DirectoryTreeBuilder } from './builder'

// IPC param schemas. `DirectoryTreeOptionsSchema` is the shared source of
// truth (see `@shared/utils/file/tree`); the IPC-level wrappers stay here
// next to the handlers, matching the FileManager / DataApi convention where
// leaf schemas live in shared and per-channel param schemas live in main.
const TreeCreateParamsSchema = z.strictObject({
  rootPath: AbsolutePathSchema,
  options: DirectoryTreeOptionsSchema.optional()
})

const TreeDisposeParamsSchema = z.strictObject({ treeId: z.string().min(1) })

const TreeRenameParamsSchema = z.strictObject({
  treeId: z.string().min(1),
  oldPath: AbsolutePathSchema,
  newPath: AbsolutePathSchema
})

/**
 * Thrown by `acquireBuilder` when the manager has already torn down by the
 * time an in-flight `createDirectoryTree` resolves. Electron preserves
 * `error.name` across IPC, so the renderer hook can distinguish this from a
 * real failure (which deserves a user-facing toast) by matching the name.
 */
export class DirectoryTreeStoppedError extends Error {
  override readonly name = 'DirectoryTreeStoppedError' as const
  constructor() {
    super('DirectoryTreeManager stopped during in-flight builder creation')
  }
}

const logger = loggerService.withContext('file/tree/registry')

/**
 * Grace window before tearing down a builder whose consumer count just
 * hit zero. Long enough to span a single React commit's
 * "deletion-effects → insertion-effects" gap (typically sub-millisecond),
 * short enough that a genuine workspace close doesn't keep the watcher
 * alive for noticeable time.
 */
const DISPOSE_GRACE_MS = 500

/**
 * Per-builder bookkeeping, modeled as a discriminated union on `state`:
 *
 *  - `active`:   at least one consumer is attached; no grace timer armed.
 *  - `draining`: the last consumer detached, the dispose timer is counting
 *                down. A new `create` for the same key transitions back to
 *                active and clears the timer; the timer firing transitions
 *                to disposed (the entry is removed from `sharedBuilders`).
 *
 * State transitions allocate a new record and `Map.set` it under the same
 * key — fields outside the union (`key`, `builder`, `consumers`) are
 * preserved by reference so consumer references to the consumers Map stay
 * live across transitions.
 */
type SharedBuilderBase = {
  readonly key: string
  readonly builder: DirectoryTreeBuilder
  /** treeId → consumer entry. `size` is the effective refcount. */
  readonly consumers: Map<string, Consumer>
}

type SharedBuilder =
  | (SharedBuilderBase & { readonly state: 'active' })
  | (SharedBuilderBase & { readonly state: 'draining'; readonly disposeTimer: ReturnType<typeof setTimeout> })

interface Consumer {
  readonly treeId: string
  readonly webContentsId: number
  readonly sender: WebContents
  /** Subscription returned by `builder.onMutation()` — disposed when this consumer leaves. */
  readonly forwardSubscription: Disposable
  /** Stable builder reference for forwarding pushes / rename. */
  readonly builder: DirectoryTreeBuilder
  /** Key into `sharedBuilders`; survives state transitions on that record. */
  readonly sharedBuilderKey: string
}

// Delimiter that cannot appear unescaped in any JSON.stringify output —
// the NUL control character is always emitted as an escape sequence by
// JSON, keeping the (path, options) boundary in builderKey unambiguous.
const BUILDER_KEY_DELIMITER = String.fromCharCode(0)

function builderKey(rootPath: string, options: DirectoryTreeOptions | undefined): string {
  // Match the normalization the builder applies to rootPath (backslash to
  // forward slash) so identical Windows paths spelled with different
  // separators dedupe to the same shared builder.
  const normalized = rootPath.replace(/\\/g, '/')
  return `${normalized}${BUILDER_KEY_DELIMITER}${canonicalizeOptions(options)}`
}

/**
 * Stable serialization of `DirectoryTreeOptions` for use as a dedupe key.
 * `JSON.stringify` is sensitive to key insertion order, so two callers that
 * pass `{ withStats: true, includeHidden: true }` vs.
 * `{ includeHidden: true, withStats: true }` would otherwise produce
 * different keys and spawn redundant builders. Schema-derived field order
 * gives us a deterministic shape regardless of the caller's literal.
 */
function canonicalizeOptions(options: DirectoryTreeOptions | undefined): string {
  if (!options) return '{}'
  const keys = Object.keys(DirectoryTreeOptionsSchema.shape).sort()
  const ordered: Record<string, unknown> = {}
  for (const k of keys) {
    const v = (options as Record<string, unknown>)[k]
    if (v === undefined) continue
    // For array-valued options (`extensions`), normalize order too so
    // `['md', 'txt']` and `['txt', 'md']` dedupe.
    ordered[k] = Array.isArray(v) ? [...v].sort() : v
  }
  return JSON.stringify(ordered)
}

@Injectable('DirectoryTreeManager')
@ServicePhase(Phase.WhenReady)
export class DirectoryTreeManager extends BaseService {
  /** treeId → consumer. One row per `File_TreeCreate` call still alive. */
  private readonly consumers = new Map<string, Consumer>()
  /** Shared builder by `builderKey`. One row per *underlying* watcher. */
  private readonly sharedBuilders = new Map<string, SharedBuilder>()
  /** `(rootPath, options)` → in-flight create promise, so concurrent
   *  `File_TreeCreate` calls dedupe at builder-creation time. */
  private readonly inflight = new Map<string, Promise<SharedBuilder>>()
  /** webContentsId → set of treeIds, so we can drop them on contents-destroyed. */
  private readonly byWebContents = new Map<number, Set<string>>()
  /**
   * Set by `onStop()` (and the `disposeAll()` test seam) to short-circuit
   * any builder that finishes its asynchronous `createDirectoryTree` call
   * after teardown.
   *
   * We keep this hand-rolled bit rather than gating on `this.state` because
   * tests instantiate the manager directly without going through the
   * lifecycle (`state` stays at `Created`), so an `isReady`-based check
   * would treat the service as "shut down" before its first use.
   */
  private disposed = false

  protected override async onInit(): Promise<void> {
    this.registerIpcHandlers()
  }

  protected override async onStop(): Promise<void> {
    await this.disposeAll()
  }

  /**
   * Registers the `File_Tree*` IPC contract. Kept as a dedicated helper so
   * `onInit` stays a one-liner and the channel surface lives in one
   * named place — same shape as `FileManager.registerIpcHandlers` and
   * `WindowManager.registerIpcHandlers`.
   *
   * Each handler validates its payload through Zod at the boundary; a
   * malformed renderer call rejects there instead of silently mis-typing
   * downstream state. Async wrappers ensure a synchronous `parse` throw
   * surfaces as a Promise rejection (matching `ipcMain.handle`'s contract).
   */
  private registerIpcHandlers(): void {
    this.ipcHandle(IpcChannel.File_TreeCreate, async (event, params: unknown) => {
      const { rootPath, options } = TreeCreateParamsSchema.parse(params)
      return this.create(event.sender, rootPath, options)
    })
    this.ipcHandle(IpcChannel.File_TreeDispose, async (_event, params: unknown) => {
      const { treeId } = TreeDisposeParamsSchema.parse(params)
      this.dispose(treeId)
    })
    this.ipcHandle(IpcChannel.File_TreeRename, async (_event, params: unknown) => {
      const { treeId, oldPath, newPath } = TreeRenameParamsSchema.parse(params)
      return this.rename(treeId, oldPath, newPath)
    })
  }

  /**
   * Apply an explicit rename to the shared builder backing `treeId`. The
   * caller is expected to have already performed the FS-level rename — this
   * call only updates the in-memory tree and synthesises the `renamed`
   * mutation that consumers receive. See `directory-tree.md §4.4`.
   *
   * Returns `false` when:
   *   - the treeId is unknown (already disposed, or never existed); or
   *   - the node at `oldPath` is missing in the shared builder (chokidar's
   *     `unlink` already removed it — identity is lost but state is
   *     consistent).
   */
  rename(treeId: string, oldPath: string, newPath: string): boolean {
    const consumer = this.consumers.get(treeId)
    if (!consumer) return false
    return consumer.builder.rename(oldPath, newPath)
  }

  /**
   * Create a tree for the given `sender` WebContents. Reuses an existing
   * shared builder when `(rootPath, options)` matches another live consumer
   * (or one inside the dispose grace window).
   */
  async create(
    sender: WebContents,
    rootPath: string,
    options: DirectoryTreeOptions | undefined
  ): Promise<CreateTreeIpcResult> {
    const key = builderKey(rootPath, options)
    let shared = await this.acquireBuilder(key, rootPath, options)
    if (shared.state === 'draining') {
      shared = this.transitionToActive(shared)
    }

    const treeId = randomUUID()
    const forwardSubscription = shared.builder.onMutation((event) => {
      if (sender.isDestroyed()) return
      const payload: TreeMutationPushPayload = { treeId, event }
      sender.send(IpcChannel.File_TreeMutation, payload)
    })

    const consumer: Consumer = {
      treeId,
      webContentsId: sender.id,
      sender,
      forwardSubscription,
      builder: shared.builder,
      sharedBuilderKey: shared.key
    }
    shared.consumers.set(treeId, consumer)
    this.consumers.set(treeId, consumer)

    let bucket = this.byWebContents.get(sender.id)
    if (!bucket) {
      bucket = new Set()
      this.byWebContents.set(sender.id, bucket)
      // Track the listener so onStop's _cleanupDisposables can `.off` it
      // even when the renderer never gets destroyed. Without this the
      // closure holds `this` alive through the EventEmitter slot for the
      // lifetime of the webContents, which can outlast the manager.
      const handler = (): void => this.disposeAllForWebContents(sender.id)
      sender.once('destroyed', handler)
      this.registerDisposable(() => {
        if (sender.isDestroyed()) return
        sender.off('destroyed', handler)
      })
    }
    bucket.add(treeId)

    return { treeId, snapshot: shared.builder.snapshot() }
  }

  dispose(treeId: string): boolean {
    const consumer = this.consumers.get(treeId)
    if (!consumer) return false
    consumer.forwardSubscription.dispose()
    this.consumers.delete(treeId)
    const shared = this.sharedBuilders.get(consumer.sharedBuilderKey)
    if (!shared) return true
    shared.consumers.delete(treeId)

    const bucket = this.byWebContents.get(consumer.webContentsId)
    bucket?.delete(treeId)
    if (bucket && bucket.size === 0) this.byWebContents.delete(consumer.webContentsId)

    if (shared.consumers.size === 0 && shared.state === 'active') {
      this.transitionToDraining(shared)
    }
    return true
  }

  disposeAllForWebContents(webContentsId: number): void {
    const bucket = this.byWebContents.get(webContentsId)
    if (!bucket) return
    const ids = Array.from(bucket)
    for (const id of ids) {
      try {
        this.dispose(id)
      } catch (err) {
        logger.error(`Failed to dispose tree ${id} during webContents teardown`, err as Error)
      }
    }
  }

  /**
   * Test seam + `onStop()` body. Drops every shared builder and consumer,
   * awaiting each watcher's `close()` so the caller can be sure no FDs are
   * left hanging — important on `onStop` paths that race process exit.
   */
  async disposeAll(): Promise<void> {
    this.disposed = true
    for (const treeId of Array.from(this.consumers.keys())) {
      this.dispose(treeId)
    }
    // After all consumers are gone, also force-tear shared builders so
    // tests don't wait for the grace timer.
    const drains: Array<Promise<void>> = []
    for (const shared of Array.from(this.sharedBuilders.values())) {
      if (shared.state === 'draining') {
        clearTimeout(shared.disposeTimer)
      }
      drains.push(shared.builder.disposeAsync())
      this.sharedBuilders.delete(shared.key)
    }
    // Drop pending creates too — any builder that resolves after this
    // point will see `this.disposed` and tear itself down in
    // `acquireBuilder`. Clearing here keeps the map from holding the
    // dangling promises.
    this.inflight.clear()
    await Promise.all(drains)
  }

  // ─── Internals ────────────────────────────────────────────────────────

  private async acquireBuilder(
    key: string,
    rootPath: string,
    options: DirectoryTreeOptions | undefined
  ): Promise<SharedBuilder> {
    const existing = this.sharedBuilders.get(key)
    if (existing) return existing
    const pending = this.inflight.get(key)
    if (pending) return pending

    const promise = (async () => {
      try {
        const builder = await createDirectoryTree(rootPath, options)
        // If the registry was torn down while we were awaiting the build,
        // dispose the freshly-created builder so its watcher / FDs don't
        // outlive `onStop` and surface as an orphan.
        if (this.disposed) {
          await Promise.resolve(builder.dispose()).catch((err) =>
            logger.warn('builder.dispose after onStop failed', err as Error)
          )
          throw new DirectoryTreeStoppedError()
        }
        // Window during which a concurrent `create` could have inserted
        // ahead of us — fold into theirs and discard the duplicate
        // builder so we don't leak a watcher.
        const winner = this.sharedBuilders.get(key)
        if (winner) {
          builder.dispose()
          return winner
        }
        const shared: SharedBuilder = {
          key,
          builder,
          consumers: new Map(),
          state: 'active'
        }
        this.sharedBuilders.set(key, shared)
        return shared
      } finally {
        this.inflight.delete(key)
      }
    })()

    this.inflight.set(key, promise)
    return promise
  }

  /**
   * Arm the grace-window timer and transition `shared` from `active` to
   * `draining`. Replaces the map record so the union type narrows correctly
   * at every other call site.
   */
  private transitionToDraining(shared: SharedBuilder & { state: 'active' }): void {
    // Hand the timer to BaseService so onStop's _cleanupDisposables clears
    // it even if we never reach `tearDownIfIdle` naturally. clearTimeout is
    // idempotent so the disposable surviving past natural fire is fine.
    // `.unref()` so a pending grace timer doesn't keep the process alive
    // past app exit — the watcher cleanup is best-effort at shutdown.
    const handle = setTimeout(() => this.tearDownIfIdle(shared.key), DISPOSE_GRACE_MS)
    handle.unref()
    this.registerDisposable(() => clearTimeout(handle))
    const next: SharedBuilder = {
      key: shared.key,
      builder: shared.builder,
      consumers: shared.consumers,
      state: 'draining',
      disposeTimer: handle
    }
    this.sharedBuilders.set(shared.key, next)
  }

  /**
   * Cancel the grace-window timer and transition back to `active`. Called
   * when a new consumer attaches to a builder that was already draining
   * (the React-commit-ordering case described in directory-tree.md §3.2).
   */
  private transitionToActive(shared: SharedBuilder & { state: 'draining' }): SharedBuilder & { state: 'active' } {
    clearTimeout(shared.disposeTimer)
    const next: SharedBuilder & { state: 'active' } = {
      key: shared.key,
      builder: shared.builder,
      consumers: shared.consumers,
      state: 'active'
    }
    this.sharedBuilders.set(shared.key, next)
    return next
  }

  private tearDownIfIdle(key: string): void {
    const shared = this.sharedBuilders.get(key)
    if (!shared || shared.state !== 'draining') return
    if (shared.consumers.size > 0) return
    shared.builder.dispose()
    this.sharedBuilders.delete(key)
  }
}
