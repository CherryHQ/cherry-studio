import { loggerService } from '@logger'
import { ipcApi } from '@renderer/ipc'
import { fileErrorCodes } from '@shared/ipc/errors/file'
import { IpcError } from '@shared/ipc/errors/IpcError'
import { AbsoluteFilePathSchema } from '@shared/types/file'
import {
  type CreateTreeIpcResult,
  type DirectoryTreeOptions,
  rootFromSerialized,
  TreeDir,
  type TreeDirRoot,
  TreeFile,
  type TreeMutationEvent,
  type TreeNode
} from '@shared/utils/file'

const logger = loggerService.withContext('DirectoryTreeSession')

const MAX_ACTIVATION_ATTEMPTS = 3

export interface DirectoryTreeState {
  readonly root: TreeDirRoot | null
  readonly isLoading: boolean
  readonly error: Error | null
  /** Monotonic counter that ticks whenever the mirror mutates. */
  readonly version: number
  /**
   * Identifier of the live tree on the main side, for routes that address it
   * (`file.tree.rename`). `null` until the create/activate handoff completes —
   * which is why side consumers must observe mutations through `onMutation`
   * rather than subscribing on this id, see the parameter's docs.
   */
  readonly treeId: string | null
}

interface MirrorState {
  readonly root: TreeDirRoot
  readonly nodes: Map<string, TreeNode>
  revision: number
}

function indexTree(root: TreeDirRoot): Map<string, TreeNode> {
  const map = new Map<string, TreeNode>()
  root.walk((n) => {
    map.set(n.path, n)
  })
  return map
}

function applyMutation(state: MirrorState, event: TreeMutationEvent): boolean {
  if (event.type === 'added') {
    if (state.nodes.has(event.path)) return false
    const parent = state.nodes.get(event.parentPath)
    if (!parent || !(parent instanceof TreeDir)) return false
    const node =
      event.kind === 'directory'
        ? new TreeDir({ path: event.path, stats: event.stats })
        : new TreeFile({ path: event.path, stats: event.stats })
    parent.attachChild(node)
    state.nodes.set(event.path, node)
    return true
  }
  if (event.type === 'removed') {
    const node = state.nodes.get(event.path)
    if (!node) return false
    if (node instanceof TreeDir) {
      const drop: string[] = []
      node.walk((n) => {
        if (n !== node) drop.push(n.path)
      })
      for (const p of drop) state.nodes.delete(p)
    }
    state.nodes.delete(event.path)
    node.remove()
    return true
  }
  if (event.type === 'renamed') {
    // Renames preserve node identity; reindex descendants after their paths cascade.
    const node = state.nodes.get(event.oldPath)
    if (!node) return false
    const oldPaths: string[] = [node.path]
    if (node instanceof TreeDir) {
      node.walk((n) => {
        if (n !== node) oldPaths.push(n.path)
      })
    }
    node.path = event.newPath
    for (const p of oldPaths) state.nodes.delete(p)
    state.nodes.set(node.path, node)
    if (node instanceof TreeDir) {
      node.walk((n) => {
        if (n !== node) state.nodes.set(n.path, n)
      })
    }
    return true
  }
  if (event.type === 'status') return false
  // updated
  const node = state.nodes.get(event.path)
  if (!node) return false
  node.stats = event.stats
  return true
}

const IDLE_RELEASE_MS = 10_000

/** A directory mirror whose native subscription can outlive its React subscribers briefly. */
export class DirectoryTreeSession {
  private mirror: MirrorState | null = null
  private state: DirectoryTreeState = { root: null, isLoading: false, error: null, version: 0, treeId: null }
  private readonly listeners = new Set<() => void>()
  private readonly refreshWaiters = new Set<() => void>()
  private release?: () => void
  private idleTimer?: ReturnType<typeof setTimeout>
  private recoveryAttempts = 0
  private refreshing?: Promise<void>

  constructor(
    private readonly rootPath: string,
    private readonly options: DirectoryTreeOptions | undefined,
    private readonly onMutation: (event: TreeMutationEvent) => void
  ) {}

  getSnapshot = (): DirectoryTreeState => this.state
  getNode = (path: string): TreeNode | null => this.mirror?.nodes.get(path) ?? null

  refresh = (): Promise<void> => {
    if (this.refreshing) return this.refreshing
    const task = new Promise<void>((resolve, reject) => {
      const settled = () => {
        if (this.state.isLoading) return
        this.refreshWaiters.delete(settled)
        if (this.state.error) reject(this.state.error)
        else if (this.state.treeId) resolve()
        else reject(new Error('Directory refresh was interrupted'))
      }
      this.refreshWaiters.add(settled)
      if (!this.state.isLoading) {
        this.update({ isLoading: true, error: null })
        this.recoveryAttempts = 0
        this.release?.()
        this.release = this.start(true)
      }
      settled()
    })
    this.refreshing = task.finally(() => {
      this.refreshing = undefined
    })
    return this.refreshing
  }

  subscribe = (listener: () => void): (() => void) => {
    clearTimeout(this.idleTimer)
    this.idleTimer = undefined
    this.listeners.add(listener)
    this.release ??= this.start()
    return () => {
      this.listeners.delete(listener)
      if (this.listeners.size === 0) this.idleTimer = setTimeout(() => this.dispose(), IDLE_RELEASE_MS)
    }
  }

  dispose(): void {
    clearTimeout(this.idleTimer)
    this.idleTimer = undefined
    this.release?.()
    this.release = undefined
    this.update({ root: null, treeId: null, isLoading: false })
  }

  private update(patch: Partial<DirectoryTreeState>): void {
    this.state = { ...this.state, ...patch }
    for (const listener of this.listeners) listener()
    for (const waiter of this.refreshWaiters) waiter()
  }

  private recover(): void {
    if (!this.listeners.size || this.recoveryAttempts >= MAX_ACTIVATION_ATTEMPTS) return
    this.recoveryAttempts++
    this.release?.()
    this.release = this.start()
  }

  private start(forceRefresh = false): () => void {
    const rootPath = this.rootPath
    let cancelled = false
    let released = false
    let unsubscribeMutations: (() => void) | null = null
    let createdTreeId: string | null = null

    // A shared projection refresh can reconnect this session while its snapshot is still displayed.
    this.update({ treeId: null, isLoading: true, error: null })

    const disposeTree = (treeId: string): void => {
      ipcApi.request('file.tree.dispose', { treeId }).catch((err) => {
        logger.error(`Failed to dispose tree ${treeId}`, err as Error)
      })
    }

    /** Release the stream and the main-side tree. Idempotent — every path may call it. */
    const releaseTree = (): void => {
      unsubscribeMutations?.()
      unsubscribeMutations = null
      if (createdTreeId) {
        disposeTree(createdTreeId)
        createdTreeId = null
      }
      this.mirror = null
    }

    const resume = () => {
      this.recoveryAttempts = 0
      this.recover()
    }
    const visible = () => {
      if (document.visibilityState === 'visible') resume()
    }
    window.addEventListener('focus', resume)
    document.addEventListener('visibilitychange', visible)

    void (async () => {
      try {
        for (let attempt = 1; attempt <= MAX_ACTIVATION_ATTEMPTS; attempt += 1) {
          const result: CreateTreeIpcResult = await ipcApi.request('file.tree.create', {
            rootPath: AbsoluteFilePathSchema.parse(rootPath),
            options: this.options,
            ...(forceRefresh ? { refresh: true } : {})
          })
          if (cancelled) {
            disposeTree(result.treeId)
            return
          }

          createdTreeId = result.treeId

          const snapshotRoot = rootFromSerialized(result.snapshot)
          const nodes = indexTree(snapshotRoot)
          this.mirror = { root: snapshotRoot, nodes, revision: result.revision }

          unsubscribeMutations = ipcApi.on('file.tree.mutation', (payload) => {
            if (cancelled || released || payload.treeId !== result.treeId) return
            const mirror = this.mirror
            if (!mirror) return
            if (payload.revision <= mirror.revision) return
            if (payload.event.type === 'status') {
              released = true
              releaseTree()
              this.update({ treeId: null, error: new Error(`Directory observation ${payload.event.coverage}`) })
              queueMicrotask(() => this.recover())
              return
            }
            const expectedRevision = mirror.revision + 1
            if (payload.revision !== expectedRevision) {
              const revisionError = new Error(
                `Directory tree ${result.treeId} mutation gap: expected ${expectedRevision}, received ${payload.revision}`
              )
              logger.error(`Directory tree mutation stream became stale for ${rootPath}`, revisionError)
              released = true
              releaseTree()
              this.update({ root: null, treeId: null, error: revisionError, isLoading: false })
              queueMicrotask(() => this.recover())
              return
            }
            const changed = applyMutation(mirror, payload.event)
            mirror.revision = payload.revision
            this.onMutation(payload.event)
            if (changed) this.update({ version: this.state.version + 1 })
          })

          const activated = await ipcApi.request('file.tree.activate', {
            treeId: result.treeId,
            revision: result.revision
          })
          if (cancelled || released) return

          if (activated) {
            this.recoveryAttempts = 0
            this.update({ root: snapshotRoot, treeId: result.treeId, isLoading: false, error: null })
            return
          }

          logger.warn(`Directory tree ${result.treeId} refused activation, retaking the snapshot`, {
            rootPath,
            attempt
          })
          releaseTree()
        }
        throw new Error(`Directory tree for ${rootPath} was refused activation ${MAX_ACTIVATION_ATTEMPTS} times`)
      } catch (err) {
        if (cancelled) return
        releaseTree()
        const normalized = err instanceof Error ? err : new Error(String(err))
        if (normalized instanceof IpcError && normalized.code === fileErrorCodes.DIRECTORY_TREE_STOPPED) {
          this.update({ isLoading: false })
          return
        }
        logger.error(`Failed to create directory tree for ${rootPath}`, normalized)
        this.update({ error: normalized, isLoading: false })
      }
    })()

    return () => {
      cancelled = true
      window.removeEventListener('focus', resume)
      document.removeEventListener('visibilitychange', visible)
      releaseTree()
      this.update({ treeId: null })
    }
  }
}
