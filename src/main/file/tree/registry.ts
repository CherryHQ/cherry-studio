/**
 * `TreeRegistry` — main-process bookkeeping for active `DirectoryTreeBuilder`
 * instances behind the `Tree_*` IPC bridge.
 *
 * Every `Tree_Create` IPC call gets a unique `treeId` (the renderer needs
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
 * `Tree_Dispose` for the old id and the mount fires `Tree_Create` for the
 * new id back-to-back. The grace window lets the new call grab the still-
 * warm builder instead of waiting on a fresh scan + watcher install.
 *
 * Renderer→main IPC sequence on a tab/maximize remount:
 *   T0     unmount   Tree_Dispose(old)  → refcount=0, grace timer queued
 *   T0+ε   mount     Tree_Create(...)   → cancels timer, attaches as new consumer
 */

import { randomUUID } from 'node:crypto'

import { loggerService } from '@logger'
import { BaseService, type Disposable, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import type { CreateTreeIpcResult, DirectoryTreeOptions, TreeMutationPushPayload } from '@shared/file/types'
import { IpcChannel } from '@shared/IpcChannel'
import type { WebContents } from 'electron'

import { createDirectoryTree, type DirectoryTreeBuilder } from './builder'

const logger = loggerService.withContext('file/tree/registry')

/**
 * Grace window before tearing down a builder whose consumer count just
 * hit zero. Long enough to span a single React commit's
 * "deletion-effects → insertion-effects" gap (typically sub-millisecond),
 * short enough that a genuine workspace close doesn't keep the watcher
 * alive for noticeable time.
 */
const DISPOSE_GRACE_MS = 500

interface SharedBuilder {
  readonly key: string
  readonly builder: DirectoryTreeBuilder
  /** treeId → consumer entry. `size` is the effective refcount. */
  readonly consumers: Map<string, Consumer>
  /** Set when `consumers.size` is 0; cleared when a new consumer attaches. */
  disposeTimer: ReturnType<typeof setTimeout> | null
}

interface Consumer {
  readonly treeId: string
  readonly webContentsId: number
  readonly sender: WebContents
  /** Subscription returned by `builder.onMutation()` — disposed when this consumer leaves. */
  readonly forwardSubscription: Disposable
  readonly sharedBuilder: SharedBuilder
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
  return `${normalized}${BUILDER_KEY_DELIMITER}${JSON.stringify(options ?? {})}`
}

@Injectable('TreeRegistry')
@ServicePhase(Phase.WhenReady)
export class TreeRegistry extends BaseService {
  /** treeId → consumer. One row per `Tree_Create` call still alive. */
  private readonly consumers = new Map<string, Consumer>()
  /** Shared builder by `builderKey`. One row per *underlying* watcher. */
  private readonly sharedBuilders = new Map<string, SharedBuilder>()
  /** `(rootPath, options)` → in-flight create promise, so concurrent
   *  `Tree_Create` calls dedupe at builder-creation time. */
  private readonly inflight = new Map<string, Promise<SharedBuilder>>()
  /** webContentsId → set of treeIds, so we can drop them on contents-destroyed. */
  private readonly byWebContents = new Map<number, Set<string>>()

  protected override async onInit(): Promise<void> {
    // IPC handlers go here (auto-cleaned on stop) rather than in
    // FileManager, so the registry owns its complete contract: state,
    // teardown, and the channels that feed it.
    this.ipcHandle(
      IpcChannel.Tree_Create,
      async (event, params: { rootPath: string; options?: DirectoryTreeOptions }) =>
        this.create(event.sender, params.rootPath, params.options)
    )
    this.ipcHandle(IpcChannel.Tree_Dispose, (_event, params: { treeId: string }) => {
      this.dispose(params.treeId)
    })
  }

  protected override async onStop(): Promise<void> {
    this.disposeAll()
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
    const shared = await this.acquireBuilder(key, rootPath, options)
    if (shared.disposeTimer) {
      clearTimeout(shared.disposeTimer)
      shared.disposeTimer = null
    }

    const treeId = randomUUID()
    const forwardSubscription = shared.builder.onMutation((event) => {
      if (sender.isDestroyed()) return
      const payload: TreeMutationPushPayload = { treeId, event }
      sender.send(IpcChannel.Tree_Mutation, payload)
    })

    const consumer: Consumer = {
      treeId,
      webContentsId: sender.id,
      sender,
      forwardSubscription,
      sharedBuilder: shared
    }
    shared.consumers.set(treeId, consumer)
    this.consumers.set(treeId, consumer)

    let bucket = this.byWebContents.get(sender.id)
    if (!bucket) {
      bucket = new Set()
      this.byWebContents.set(sender.id, bucket)
      sender.once('destroyed', () => this.disposeAllForWebContents(sender.id))
    }
    bucket.add(treeId)

    return { treeId, snapshot: shared.builder.snapshot() }
  }

  dispose(treeId: string): boolean {
    const consumer = this.consumers.get(treeId)
    if (!consumer) return false
    consumer.forwardSubscription.dispose()
    this.consumers.delete(treeId)
    const shared = consumer.sharedBuilder
    shared.consumers.delete(treeId)

    const bucket = this.byWebContents.get(consumer.webContentsId)
    bucket?.delete(treeId)
    if (bucket && bucket.size === 0) this.byWebContents.delete(consumer.webContentsId)

    if (shared.consumers.size === 0 && !shared.disposeTimer) {
      shared.disposeTimer = setTimeout(() => this.tearDownIfIdle(shared), DISPOSE_GRACE_MS)
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

  /** Test seam — drop every shared builder and consumer immediately. */
  disposeAll(): void {
    for (const treeId of Array.from(this.consumers.keys())) {
      this.dispose(treeId)
    }
    // After all consumers are gone, also force-tear shared builders so
    // tests don't wait for the grace timer.
    for (const shared of Array.from(this.sharedBuilders.values())) {
      if (shared.disposeTimer) {
        clearTimeout(shared.disposeTimer)
        shared.disposeTimer = null
      }
      shared.builder.dispose()
      this.sharedBuilders.delete(shared.key)
    }
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
          disposeTimer: null
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

  private tearDownIfIdle(shared: SharedBuilder): void {
    shared.disposeTimer = null
    if (shared.consumers.size > 0) return
    shared.builder.dispose()
    this.sharedBuilders.delete(shared.key)
  }
}
