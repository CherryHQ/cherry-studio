/**
 * `DirectoryTreeManager` — main-process bookkeeping for active `DirectoryTreeBuilder`
 * instances behind the `file.tree.*` IpcApi routes.
 *
 * Every `file.tree.create` call gets a unique `treeId` (the renderer needs
 * one to route mutation pushes), but identical `(rootPath, options)` pairs
 * **share one underlying `DirectoryTreeBuilder`** — one ripgrep scan, one
 * chokidar watcher, one set of FDs. This is the right place to dedupe
 * because the expensive resource lives on the main side; renderer-side
 * sharing would always pay an extra IPC round-trip per remount.
 *
 * A new consumer starts pending: its snapshot is returned with a baseline
 * revision while later mutations queue main-side. `file.tree.activate` flushes
 * that queue only after the renderer has installed its listener, closing the
 * snapshot-to-stream delivery gap without another filesystem scan.
 *
 * When a `treeId` is disposed and that builder's last consumer leaves, the
 * tear-down is deferred by `DISPOSE_GRACE_MS`. React commits effects in
 * order "deletions before insertions" within a single commit — when a keyed
 * consumer is replaced or a tab unmounts and immediately remounts, the unmount fires
 * `file.tree.dispose` for the old id and the mount fires `file.tree.create` for the
 * new id back-to-back. The grace window lets the new call grab the still-
 * warm builder instead of waiting on a fresh scan + watcher install.
 *
 * Renderer→main IPC sequence on a same-commit consumer replacement:
 *   T0     unmount   file.tree.dispose(old)  → refcount=0, grace timer queued
 *   T0+ε   mount     file.tree.create(...)   → cancels timer, attaches as new consumer
 */

import { randomUUID } from 'node:crypto'

import type { WebContents } from 'electron'

import { application } from '@application'
import { loggerService } from '@logger'
import { BaseService, DependsOn, type Disposable, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import type { WindowId } from '@shared/ipc/types'
import { IpcChannel } from '@shared/IpcChannel'
import type { CreateTreeIpcResult, DirectoryTreeOptions, TreeMutationPushPayload } from '@shared/utils/file'
import { DirectoryTreeOptionsSchema } from '@shared/utils/file'

import { createDirectoryTree, type DirectoryTreeBuilder } from './builder'

/**
 * Thrown by `acquireBuilder` when the manager has already torn down by the
 * time an in-flight `createDirectoryTree` resolves. The `file.tree.create`
 * handler maps it to the `DIRECTORY_TREE_STOPPED` domain code so the renderer
 * hook can distinguish it from a real failure (which deserves a user-facing toast).
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
 * Ceiling on mutations buffered for one un-activated consumer.
 *
 * A conforming renderer activates within a single round-trip and buffers a handful;
 * a hung or non-conforming one can create a tree and then never activate, while a
 * high-churn workspace keeps appending full payloads. Window teardown does not help
 * while the window is alive, so the queue is the only bound. Overflow disposes the
 * consumer, so a late `activate` returns false; consumers treat that as recoverable
 * and retake the handshake with a fresh snapshot (see `MAX_ACTIVATION_ATTEMPTS` in
 * `useDirectoryTree`). Strictly better than growing main-process memory to hold
 * events for a mirror that may never exist.
 */
const MAX_PENDING_MUTATIONS = 1000

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

/**
 * The managed window that owns a tree. Both fields must describe the same window:
 * `windowId` keys teardown on `WindowManager.onWindowDestroyed`, `webContents` receives
 * the mutation stream and anchors ownership checks.
 */
export interface TreeOwner {
  readonly windowId: WindowId
  readonly webContents: WebContents
}

interface Consumer {
  readonly treeId: string
  /** Owning managed window; key into `byWindow`. */
  readonly windowId: WindowId
  readonly webContentsId: number
  readonly sender: WebContents
  /** Subscription returned by `builder.onMutation()` — disposed when this consumer leaves. */
  forwardSubscription: Disposable | null
  /** Stable builder reference for forwarding pushes / rename. */
  readonly builder: DirectoryTreeBuilder
  /** Key into `sharedBuilders`; survives state transitions on that record. */
  readonly sharedBuilderKey: string
  /** Snapshot-to-stream handoff state; mutations queue until renderer readiness is acknowledged. */
  phase: 'pending' | 'active'
  /** Revision captured in the create result and required by activate. */
  readonly snapshotRevision: number
  /** Last revision assigned to a mutation for this treeId. */
  revision: number
  readonly pendingMutations: TreeMutationPushPayload[]
}

// Delimiter that cannot appear unescaped in any JSON.stringify output —
// the NUL control character is always emitted as an escape sequence by
// JSON, keeping the (path, options) boundary in builderKey unambiguous.
const BUILDER_KEY_DELIMITER = String.fromCharCode(0)

/**
 * Directed send of the `file.tree.mutation` event on the single IpcApi event
 * channel — the class-B topic-stream transport. Keyed by the consumer's own
 * `WebContents` rather than a WindowId (wire-identical to `IpcApiService.send`),
 * so a tree only reaches the window that created it.
 */
function sendMutation(sender: WebContents, payload: TreeMutationPushPayload): void {
  sender.send(IpcChannel.IpcApi_Event, 'file.tree.mutation', payload)
}

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
@DependsOn(['WindowManager'])
export class DirectoryTreeManager extends BaseService {
  /** treeId → consumer. One row per `file.tree.create` call still alive. */
  private readonly consumers = new Map<string, Consumer>()
  /** Shared builder by `builderKey`. One row per *underlying* watcher. */
  private readonly sharedBuilders = new Map<string, SharedBuilder>()
  /** `(rootPath, options)` → in-flight create promise, so concurrent
   *  `file.tree.create` calls dedupe at builder-creation time. */
  private readonly inflight = new Map<string, Promise<SharedBuilder>>()
  /** windowId → set of treeIds, so we can drop them when the owning window is destroyed. */
  private readonly byWindow = new Map<WindowId, Set<string>>()
  /**
   * Set by `onStop()` (and the `disposeAll()` test seam) to short-circuit
   * any builder that finishes its asynchronous `createDirectoryTree` call
   * after teardown.
   *
   * We keep this hand-rolled bit rather than gating on `this.state` because
   * tests tear down through the `disposeAll()` seam without `_doStop()`, so
   * `state` would still read `Ready` after teardown.
   */
  private disposed = false

  protected override onInit(): void {
    this.registerDisposable(
      application.get('WindowManager').onWindowDestroyed(({ id }) => this.disposeAllForWindow(id))
    )
  }

  protected override async onStop(): Promise<void> {
    await this.disposeAll()
  }

  /**
   * Apply an explicit in-place rename to the shared builder backing `treeId`.
   * The caller is expected to have already performed the FS-level rename — this
   * call only updates the in-memory tree and synthesises the `renamed`
   * mutation that consumers receive. See `directory-tree.md §4.4`.
   *
   * Takes a `newName`, not a destination path: the target is always resolved
   * against `oldPath`'s parent, so a cross-parent move — which `TreeNode.path`
   * cannot express, it only repoints a basename within the existing parent —
   * cannot be requested.
   *
   * Returns `false` when:
   *   - the treeId is unknown (already disposed, or never existed); or
   *   - the node at `oldPath` is missing in the shared builder (chokidar's
   *     `unlink` already removed it — identity is lost but state is
   *     consistent).
   */
  rename(treeId: string, oldPath: string, newName: string, ownerWebContentsId: number): boolean {
    const consumer = this.ownedConsumer(treeId, ownerWebContentsId)
    if (!consumer) return false
    // Same normalization the builder applies, so a Windows-spelled oldPath
    // resolves against the same parent the builder indexed it under.
    const parent = oldPath.replace(/\\/g, '/').replace(/\/[^/]*$/, '')
    return consumer.builder.rename(oldPath, `${parent}/${newName}`)
  }

  /**
   * Complete the snapshot-to-stream handoff for a renderer mirror. Mutations
   * observed after the snapshot stay in the consumer queue until this call,
   * so installing the renderer listener never races live forwarding.
   */
  activateTree(treeId: string, revision: number, ownerWebContentsId: number): boolean {
    const consumer = this.ownedConsumer(treeId, ownerWebContentsId)
    if (!consumer || revision !== consumer.snapshotRevision) return false
    if (consumer.phase === 'active') return true
    if (consumer.sender.isDestroyed()) return false

    consumer.phase = 'active'
    for (const payload of consumer.pendingMutations) {
      sendMutation(consumer.sender, payload)
    }
    consumer.pendingMutations.length = 0
    return true
  }

  /**
   * Create a tree owned by the managed window `owner`; its WebContents receives
   * the mutation stream. Reuses an existing shared builder when `(rootPath, options)`
   * matches another live consumer (or one inside the dispose grace window). The
   * returned consumer remains pending until `activate` acknowledges the snapshot revision.
   */
  async create(
    owner: TreeOwner,
    rootPath: string,
    options: DirectoryTreeOptions | undefined
  ): Promise<CreateTreeIpcResult> {
    const { windowId, webContents: sender } = owner
    const key = builderKey(rootPath, options)
    await this.acquireBuilder(key, rootPath, options)
    // Re-read the canonical record rather than trusting the awaited one. Every create
    // waiting on the same in-flight acquisition receives the record as it was, and
    // another waiter's continuation may already have replaced it — e.g. a waiter whose
    // owner died attaches, disposes, and flips the entry to `draining`. Acting on the
    // stale `active` copy would skip `transitionToActive`, so the armed timer finds a
    // live consumer and returns while the entry stays `draining`; the last dispose then
    // sees a non-`active` state, arms nothing, and the watcher survives until shutdown.
    const canonical = this.sharedBuilders.get(key)
    // Only `disposeAll()` removes an entry without a grace timer, and a timer cannot
    // interleave between the microtasks resuming these waiters — so a missing entry
    // means the manager shut down underneath us.
    if (!canonical) throw new DirectoryTreeStoppedError()
    const shared = canonical.state === 'draining' ? this.transitionToActive(canonical) : canonical

    const treeId = randomUUID()
    const snapshotRevision = 0
    const consumer: Consumer = {
      treeId,
      windowId,
      webContentsId: sender.id,
      sender,
      forwardSubscription: null,
      builder: shared.builder,
      sharedBuilderKey: shared.key,
      phase: 'pending',
      snapshotRevision,
      revision: snapshotRevision,
      pendingMutations: []
    }
    consumer.forwardSubscription = shared.builder.onMutation((event) => {
      if (sender.isDestroyed()) return
      const payload: TreeMutationPushPayload = { treeId, revision: ++consumer.revision, event }
      if (consumer.phase === 'pending') {
        if (consumer.pendingMutations.length >= MAX_PENDING_MUTATIONS) {
          logger.warn(
            `Tree ${treeId} buffered ${MAX_PENDING_MUTATIONS} mutations without activating — disposing the consumer`
          )
          this.dispose(treeId)
          return
        }
        consumer.pendingMutations.push(payload)
        return
      }
      sendMutation(sender, payload)
    })
    shared.consumers.set(treeId, consumer)
    this.consumers.set(treeId, consumer)

    // `acquireBuilder` awaits a ripgrep scan + watcher install. If the owner window
    // closed during it, `onWindowDestroyed` has already fired with nothing of ours to
    // drop — the consumer (and an otherwise-idle builder) would survive until app
    // shutdown. Reconcile against the current state instead. Registering first and
    // disposing lets the normal refcount + grace-window path release the builder
    // rather than stranding a freshly-created one with zero consumers.
    if (sender.isDestroyed()) {
      this.dispose(treeId)
      throw new Error(`Directory tree owner (webContents ${consumer.webContentsId}) was destroyed during creation`)
    }

    let bucket = this.byWindow.get(windowId)
    if (!bucket) {
      bucket = new Set()
      this.byWindow.set(windowId, bucket)
    }
    bucket.add(treeId)

    return { treeId, revision: snapshotRevision, snapshot: shared.builder.snapshot() }
  }

  /**
   * @param ownerWebContentsId When given, the call is refused unless it matches the
   *   consumer's owner. IPC handlers MUST pass it — a `treeId` is an identifier, not
   *   a capability, and every renderer shares one request channel. Internal callers
   *   (window teardown, overflow, `onStop`) are already authorized and omit it.
   */
  dispose(treeId: string, ownerWebContentsId?: number): boolean {
    const consumer =
      ownerWebContentsId === undefined ? this.consumers.get(treeId) : this.ownedConsumer(treeId, ownerWebContentsId)
    if (!consumer) return false
    consumer.forwardSubscription?.dispose()
    this.consumers.delete(treeId)
    const shared = this.sharedBuilders.get(consumer.sharedBuilderKey)
    if (!shared) return true
    shared.consumers.delete(treeId)

    const bucket = this.byWindow.get(consumer.windowId)
    bucket?.delete(treeId)
    if (bucket && bucket.size === 0) this.byWindow.delete(consumer.windowId)

    if (shared.consumers.size === 0 && shared.state === 'active') {
      this.transitionToDraining(shared)
    }
    return true
  }

  disposeAllForWindow(windowId: WindowId): void {
    const bucket = this.byWindow.get(windowId)
    if (!bucket) return
    const ids = Array.from(bucket)
    for (const id of ids) {
      try {
        this.dispose(id)
      } catch (err) {
        logger.error(`Failed to dispose tree ${id} during window teardown`, err as Error)
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

  /**
   * Consumer lookup gated on ownership. Every window shares the one IpcApi request
   * channel, so a `treeId` reaching the manager proves nothing about who holds it —
   * without this a renderer that learned another window's id could flush its buffer
   * before it listens, dispose it, or mutate its mirror.
   */
  private ownedConsumer(treeId: string, ownerWebContentsId: number): Consumer | undefined {
    const consumer = this.consumers.get(treeId)
    if (!consumer || consumer.webContentsId !== ownerWebContentsId) return undefined
    return consumer
  }

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
    // `.unref()` so a pending grace timer doesn't keep the process alive
    // past app exit — the watcher cleanup is best-effort at shutdown.
    const handle = setTimeout(() => this.tearDownIfIdle(shared.key), DISPOSE_GRACE_MS)
    handle.unref()
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
