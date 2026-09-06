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
import { useCallback, useEffect, useRef, useState } from 'react'

const logger = loggerService.withContext('useDirectoryTree')

/**
 * How many `create → subscribe → activate` rounds to try before giving up.
 *
 * Main refuses activation when it has already dropped the consumer — today only
 * when the pending buffer overflowed, which needs this renderer to stall between
 * the two calls while the workspace churns. Retrying takes a fresh snapshot, so
 * it is correct rather than hopeful; the bound is what keeps a persistently
 * stalled renderer from looping.
 */
const MAX_ACTIVATION_ATTEMPTS = 3

/**
 * How long a released tree stays live before it is really disposed.
 *
 * `<Activity mode="hidden">` runs this effect's cleanup and re-runs it on show,
 * so every right-pane close and tab switch used to pay a fresh main-side scan
 * plus a full O(N) mirror rebuild — and made the previous mirror garbage on the
 * way out. On a large workspace under memory pressure that churn is all page
 * faults and major GC, which reads as the app freezing on each toggle.
 *
 * Matches `LAZY_WATCHER_DISPOSE_GRACE_MS` in `useArtifactFileTreeModel`, which
 * absorbs the same hide/show cycle for the lazily watched subdirectories.
 */
const RELEASE_GRACE_MS = 10_000

interface PendingRelease {
  readonly rootPath: string
  readonly treeId: string
  readonly release: () => void
  readonly timer: ReturnType<typeof setTimeout>
}

export interface UseDirectoryTreeResult {
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
  getNode(absPath: string): TreeNode | null
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
    // Identity-preserving: the same `TreeNode` instance gets its path
    // mutated via the setter, which cascades through `adjustChildrenPaths`
    // and repoints the parent's `_children` map. The reverse-lookup index
    // (state.nodes) is rekeyed for the node and every descendant whose
    // path also changed.
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

/**
 * @param onMutation Side consumers that need *every* mutation must go through this
 *   callback rather than their own `ipcApi.on`: `activate` flushes the buffered
 *   mutations before it resolves, so a subscriber keyed on the published `treeId`
 *   misses that replay. Invoked after the mirror is updated, already filtered to
 *   this tree. Read from a ref, so its identity may change freely between renders.
 */
export function useDirectoryTree(
  rootPath: string | undefined,
  options?: DirectoryTreeOptions,
  onMutation?: (event: TreeMutationEvent) => void
): UseDirectoryTreeResult {
  const normalizedRootPath = rootPath?.replace(/\\/g, '/')
  const [root, setRoot] = useState<TreeDirRoot | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const [version, setVersion] = useState(0)
  const [treeId, setTreeId] = useState<string | null>(null)
  const mirrorRef = useRef<MirrorState | null>(null)
  // Hold options in a ref. The ref is refreshed every render so that the
  // *next* mount (i.e. after a rootPath change) uses the caller's latest
  // option object — but it is read **only once** per mount, inside the
  // effect's IIFE below. Stale options between rootPath-equal renders are
  // therefore intentional, not a bug.
  const optionsRef = useRef<DirectoryTreeOptions | undefined>(options)
  optionsRef.current = options
  const onMutationRef = useRef(onMutation)
  onMutationRef.current = onMutation
  const pendingReleaseRef = useRef<PendingRelease | null>(null)

  const scheduleRelease = useCallback((rootPath: string, treeId: string, release: () => void) => {
    pendingReleaseRef.current = {
      rootPath,
      treeId,
      release,
      timer: setTimeout(() => {
        pendingReleaseRef.current = null
        release()
      }, RELEASE_GRACE_MS)
    }
  }, [])

  useEffect(() => {
    // A previous cleanup may have parked a still-live tree in its grace window.
    const pending = pendingReleaseRef.current
    const mirror = mirrorRef.current
    const adopted = pending && rootPath && pending.rootPath === rootPath && mirror ? pending : null
    if (pending) {
      clearTimeout(pending.timer)
      pendingReleaseRef.current = null
      if (!adopted) pending.release()
    }

    if (!rootPath) {
      setRoot(null)
      setError(null)
      setIsLoading(false)
      setTreeId(null)
      mirrorRef.current = null
      return
    }

    if (adopted && mirror) {
      // The parked mirror kept applying mutations while hidden, so re-adopting it
      // is a same-value resync — no create round trip, no snapshot, no rebuild.
      setRoot(mirror.root)
      setTreeId(adopted.treeId)
      setIsLoading(false)
      setError(null)
      return () => scheduleRelease(rootPath, adopted.treeId, adopted.release)
    }

    let cancelled = false
    let released = false
    /** Set once the create/activate handshake completes — only then is parking safe. */
    let established = false
    let unsubscribeMutations: (() => void) | null = null
    let createdTreeId: string | null = null

    setRoot(null)
    setIsLoading(true)
    setError(null)

    const disposeTree = (treeId: string): void => {
      // Wrap so mocked / synchronous dispose impls that return `undefined`
      // don't throw before our `.catch`. The IPC contract is async; we
      // treat the result defensively.
      Promise.resolve(ipcApi.request('file.tree.dispose', { treeId })).catch((err) => {
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
      mirrorRef.current = null
    }

    void (async () => {
      try {
        for (let attempt = 1; attempt <= MAX_ACTIVATION_ATTEMPTS; attempt += 1) {
          const result: CreateTreeIpcResult = await ipcApi.request('file.tree.create', {
            rootPath: AbsoluteFilePathSchema.parse(rootPath),
            options: optionsRef.current
          })
          if (cancelled) {
            disposeTree(result.treeId)
            return
          }

          createdTreeId = result.treeId

          const snapshotRoot = rootFromSerialized(result.snapshot)
          const nodes = indexTree(snapshotRoot)
          mirrorRef.current = { root: snapshotRoot, nodes, revision: result.revision }

          unsubscribeMutations = ipcApi.on('file.tree.mutation', (payload) => {
            if (payload.treeId !== result.treeId) return
            const mirror = mirrorRef.current
            if (!mirror) return
            if (payload.revision <= mirror.revision) return
            const expectedRevision = mirror.revision + 1
            if (payload.revision !== expectedRevision) {
              const revisionError = new Error(
                `Directory tree ${result.treeId} mutation gap: expected ${expectedRevision}, received ${payload.revision}`
              )
              logger.error(`Directory tree mutation stream became stale for ${rootPath}`, revisionError)
              // A gap is unrecoverable without a replay or a fresh snapshot, so this is
              // terminal: tear the stream down and report once. Staying subscribed would
              // re-gap on every later push — a new Error each time, which consumers that
              // toast on `error` (Notes) turn into an endless stream of toasts, while the
              // dead mirror keeps a watcher and its IPC traffic alive. Terminal here also
              // means no retry: unlike a refused activation, a fresh snapshot would not
              // tell us what the mirror missed.
              released = true
              releaseTree()
              setRoot(null)
              setTreeId(null)
              setError(revisionError)
              setIsLoading(false)
              return
            }
            const changed = applyMutation(mirror, payload.event)
            mirror.revision = payload.revision
            onMutationRef.current?.(payload.event)
            if (changed) setVersion((v) => v + 1)
          })

          const activated = await ipcApi.request('file.tree.activate', {
            treeId: result.treeId,
            revision: result.revision
          })
          // `activate` flushes the buffered mutations before it resolves, so the listener
          // may have hit a revision gap and torn everything down while this await was
          // pending. Publishing now would resurrect a snapshot with no mirror behind it —
          // a tree whose `getNode()` returns null for every path it displays.
          if (cancelled || released) return

          if (activated) {
            established = true
            setRoot(snapshotRoot)
            setTreeId(result.treeId)
            setIsLoading(false)
            return
          }

          // Main refused the handshake — it dropped this consumer, today because the
          // pending buffer overflowed while we were between `create` and `activate`.
          // The snapshot we hold can never be completed, but the condition is transient,
          // so take a fresh one instead of leaving the caller with a dead tree.
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
        // Distinguish "the main-side manager stopped while our create was
        // in flight" from a real failure — it fires during app shutdown or
        // service restart, where no consumer toast is useful.
        if (normalized instanceof IpcError && normalized.code === fileErrorCodes.DIRECTORY_TREE_STOPPED) {
          setIsLoading(false)
          return
        }
        logger.error(`Failed to create directory tree for ${rootPath}`, normalized)
        setError(normalized)
        setIsLoading(false)
      }
    })()

    return () => {
      cancelled = true
      // An <Activity> hide is indistinguishable from an unmount here, so an
      // established tree is parked rather than torn down; the timer covers both.
      // Parking before the handshake completes would strand a pending consumer
      // main-side, buffering mutations until MAX_PENDING_MUTATIONS overflows.
      if (established && createdTreeId) {
        scheduleRelease(rootPath, createdTreeId, releaseTree)
        return
      }
      releaseTree()
      setTreeId(null)
    }
    // Re-create only on rootPath change. The `options` argument is sampled
    // exactly once per mount (via `optionsRef.current` inside the IIFE
    // above); subsequent renders update `optionsRef` but do NOT trigger a
    // rebuild. Pass a new `rootPath` if you need a different scan.
  }, [rootPath, scheduleRelease])

  const currentRoot = root?.path === normalizedRootPath ? root : null
  const getNode = useCallback(
    (absPath: string): TreeNode | null => {
      const mirror = mirrorRef.current
      if (!mirror || mirror.root.path !== normalizedRootPath) return null
      return mirror.nodes.get(absPath) ?? null
    },
    [normalizedRootPath]
  )

  return { root: currentRoot, isLoading, error, version, treeId: currentRoot ? treeId : null, getNode }
}
