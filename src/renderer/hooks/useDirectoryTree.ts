import { loggerService } from '@logger'
import {
  type CreateTreeIpcResult,
  type DirectoryTreeOptions,
  rootFromSerialized,
  TreeDir,
  type TreeDirRoot,
  TreeFile,
  type TreeMutationEvent,
  type TreeMutationPushPayload,
  type TreeNode
} from '@shared/utils/file'
import { useCallback, useEffect, useRef, useState } from 'react'

const logger = loggerService.withContext('useDirectoryTree')

export interface UseDirectoryTreeResult {
  readonly root: TreeDirRoot | null
  readonly isLoading: boolean
  readonly error: Error | null
  /** Monotonic counter that ticks whenever the mirror mutates. */
  readonly version: number
  /**
   * Identifier of the live tree on the main side. Consumers that subscribe to
   * the shared `File_TreeMutation` channel directly should filter incoming
   * payloads by this id. `null` until the first `File_TreeCreate` resolves.
   */
  readonly treeId: string | null
  /** O(1) lookup keyed by absolute path. Stable across mutations. */
  getNode(absPath: string): TreeNode | null
}

interface MirrorState {
  readonly root: TreeDirRoot
  readonly nodes: Map<string, TreeNode>
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

export function useDirectoryTree(rootPath: string | undefined, options?: DirectoryTreeOptions): UseDirectoryTreeResult {
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

  useEffect(() => {
    if (!rootPath) {
      setRoot(null)
      setError(null)
      setIsLoading(false)
      setTreeId(null)
      mirrorRef.current = null
      return
    }

    let cancelled = false
    let unsubscribeMutations: (() => void) | null = null
    let createdTreeId: string | null = null

    setIsLoading(true)
    setError(null)

    const disposeTree = (treeId: string): void => {
      // Wrap so mocked / synchronous dispose impls that return `undefined`
      // don't throw before our `.catch`. The IPC contract is async; we
      // treat the result defensively.
      Promise.resolve(window.api.tree.dispose(treeId)).catch((err) => {
        logger.error(`Failed to dispose tree ${treeId}`, err as Error)
      })
    }

    void (async () => {
      try {
        const result: CreateTreeIpcResult = await window.api.tree.create(rootPath, optionsRef.current)
        if (cancelled) {
          disposeTree(result.treeId)
          return
        }

        createdTreeId = result.treeId

        const snapshotRoot = rootFromSerialized(result.snapshot)
        const nodes = indexTree(snapshotRoot)
        mirrorRef.current = { root: snapshotRoot, nodes }
        setRoot(snapshotRoot)
        setTreeId(result.treeId)
        setIsLoading(false)

        unsubscribeMutations = window.api.tree.onMutation((payload: TreeMutationPushPayload) => {
          if (payload.treeId !== result.treeId) return
          const mirror = mirrorRef.current
          if (!mirror) return
          const changed = applyMutation(mirror, payload.event)
          if (changed) setVersion((v) => v + 1)
        })
      } catch (err) {
        if (cancelled) return
        const normalized = err instanceof Error ? err : new Error(String(err))
        // Distinguish "the main-side manager stopped while our create was
        // in flight" from a real failure. Electron preserves `error.name`
        // across IPC, so the main side's `DirectoryTreeStoppedError`
        // arrives here with `.name === 'DirectoryTreeStoppedError'`. That
        // case fires during app shutdown or service restart — no consumer
        // toast is useful, the UI is going away.
        if (normalized.name === 'DirectoryTreeStoppedError') {
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
      unsubscribeMutations?.()
      if (createdTreeId) disposeTree(createdTreeId)
      mirrorRef.current = null
      setTreeId(null)
    }
    // Re-create only on rootPath change. The `options` argument is sampled
    // exactly once per mount (via `optionsRef.current` inside the IIFE
    // above); subsequent renders update `optionsRef` but do NOT trigger a
    // rebuild. Pass a new `rootPath` if you need a different scan.
  }, [rootPath])

  const getNode = useCallback((absPath: string): TreeNode | null => {
    return mirrorRef.current?.nodes.get(absPath) ?? null
  }, [])

  return { root, isLoading, error, version, treeId, getNode }
}
