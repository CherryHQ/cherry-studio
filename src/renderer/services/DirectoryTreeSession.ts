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
  /** O(1) lookup keyed by absolute path. Stable across mutations. */
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
  private release?: () => void
  private idleTimer?: ReturnType<typeof setTimeout>

  constructor(
    private readonly rootPath: string,
    private readonly options: DirectoryTreeOptions | undefined,
    private readonly onMutation: (event: TreeMutationEvent) => void
  ) {}

  getSnapshot = (): DirectoryTreeState => this.state
  getNode = (path: string): TreeNode | null => this.mirror?.nodes.get(path) ?? null

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
  }

  private start(): () => void {
    const rootPath = this.rootPath
    let cancelled = false
    let released = false
    let unsubscribeMutations: (() => void) | null = null
    let createdTreeId: string | null = null

    this.update({ root: null, treeId: null, isLoading: true, error: null })

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

    void (async () => {
      try {
        for (let attempt = 1; attempt <= MAX_ACTIVATION_ATTEMPTS; attempt += 1) {
          const result: CreateTreeIpcResult = await ipcApi.request('file.tree.create', {
            rootPath: AbsoluteFilePathSchema.parse(rootPath),
            options: this.options
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
            if (payload.treeId !== result.treeId) return
            const mirror = this.mirror
            if (!mirror) return
            if (payload.revision <= mirror.revision) return
            const expectedRevision = mirror.revision + 1
            if (payload.revision !== expectedRevision) {
              const revisionError = new Error(
                `Directory tree ${result.treeId} mutation gap: expected ${expectedRevision}, received ${payload.revision}`
              )
              logger.error(`Directory tree mutation stream became stale for ${rootPath}`, revisionError)
              released = true
              releaseTree()
              this.update({ root: null, treeId: null, error: revisionError, isLoading: false })
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
            this.update({ root: snapshotRoot, treeId: result.treeId, isLoading: false })
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
      releaseTree()
      this.update({ treeId: null })
    }
  }
}
