import { loggerService } from '@logger'
import { type FileTreeNode } from '@renderer/components/FileTree'
import { useDirectoryTree } from '@renderer/hooks/useDirectoryTree'
import { joinPath } from '@renderer/utils/path'
import type { FilePath } from '@shared/types/file'
import type {
  CreateTreeIpcResult,
  DirectoryTreeOptions,
  TreeDir,
  TreeDirRoot,
  TreeMutationPushPayload,
  TreeNode
} from '@shared/utils/file'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

import { getPathBasename, normalizeArtifactPaneFilePath, WORKSPACE_ROOT_ID } from './artifactPanePath'

const logger = loggerService.withContext('useArtifactFileTreeModel')

const ARTIFACT_TREE_INITIAL_MAX_DEPTH = 3
const ARTIFACT_FILE_SEARCH_DEBOUNCE_MS = 200
const ARTIFACT_FILE_SEARCH_MAX_ENTRIES = 200
const WORKSPACE_TREE_OPTIONS: DirectoryTreeOptions = {
  maxDepth: ARTIFACT_TREE_INITIAL_MAX_DEPTH
}

const stripWorkspaceRootId = (ids: ReadonlySet<string>): ReadonlySet<string> => {
  if (!ids.has(WORKSPACE_ROOT_ID)) return ids
  const next = new Set(ids)
  next.delete(WORKSPACE_ROOT_ID)
  return next
}

/**
 * Project the main-side `DirectoryTreeBuilder` snapshot into the legacy
 * `FileTreeNode[]` shape `@renderer/components/FileTree` consumes.
 *
 * Identity rule (kept stable so persisted `expandedIds` / `selectedId` survive):
 *   - synthetic root node uses `id === path === WORKSPACE_ROOT_ID`
 *   - every descendant's `id` is its workspace-relative path
 *     (forward-slash, no leading slash) and `path` is `WORKSPACE_ROOT_ID/<id>`
 *
 * Sort order: folders first, then files, each layer alphabetised by name.
 */
function projectArtifactTree(root: TreeDirRoot | null, workspacePath: string | undefined): FileTreeNode[] {
  if (!root || !workspacePath) return []

  const rootName = getPathBasename(workspacePath)
  const rootNode: FileTreeNode = {
    id: WORKSPACE_ROOT_ID,
    name: rootName || workspacePath,
    kind: 'folder',
    path: WORKSPACE_ROOT_ID,
    children: projectChildren(root, '')
  }
  return [rootNode]
}

function projectChildren(dir: TreeDir, parentRelPath: string): FileTreeNode[] {
  const out: FileTreeNode[] = []
  for (const child of Object.values(dir.children)) {
    out.push(projectTreeNode(child, parentRelPath))
  }
  out.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1
    return a.name.localeCompare(b.name)
  })
  return out
}

function projectTreeNode(node: TreeNode, parentRelPath: string): FileTreeNode {
  const relPath = parentRelPath ? `${parentRelPath}/${node.basename}` : node.basename
  const path = joinPath(WORKSPACE_ROOT_ID, relPath)
  if (node.isTreeDir()) {
    return {
      id: relPath,
      name: node.basename,
      kind: 'folder',
      path,
      children: projectChildren(node, relPath)
    }
  }
  return { id: relPath, name: node.basename, kind: 'file', path }
}

function sortFileTreeNodes(nodes: FileTreeNode[]): FileTreeNode[] {
  return nodes.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1
    return a.name.localeCompare(b.name)
  })
}

function mergeFileTreeNodeLists(
  baseNodes: readonly FileTreeNode[],
  extraNodes: readonly FileTreeNode[]
): FileTreeNode[] {
  const merged = new Map<string, FileTreeNode>()
  for (const node of baseNodes) {
    merged.set(node.id, node)
  }
  for (const node of extraNodes) {
    const existing = merged.get(node.id)
    if (!existing || existing.kind !== 'folder' || node.kind !== 'folder') {
      merged.set(node.id, node)
      continue
    }
    merged.set(node.id, {
      ...existing,
      children: mergeFileTreeNodeLists(existing.children ?? [], node.children ?? [])
    })
  }
  return sortFileTreeNodes(Array.from(merged.values()))
}

function mergeLazyChildren(
  nodes: readonly FileTreeNode[],
  lazyChildrenByDirId: ReadonlyMap<string, readonly FileTreeNode[]>
): FileTreeNode[] {
  return nodes.map((node) => {
    if (node.kind !== 'folder') return node

    const children = node.children ? mergeLazyChildren(node.children, lazyChildrenByDirId) : []
    const lazyChildren = lazyChildrenByDirId.get(node.id)
    if (!lazyChildren?.length) return { ...node, children }

    const merged = [...children]
    const existingIds = new Set(merged.map((child) => child.id))
    for (const child of lazyChildren) {
      if (existingIds.has(child.id)) continue
      existingIds.add(child.id)
      merged.push(child)
    }
    return { ...node, children: mergeLazyChildren(sortFileTreeNodes(merged), lazyChildrenByDirId) }
  })
}

function indexFileTreeNodes(nodes: readonly FileTreeNode[]): Map<string, FileTreeNode> {
  const result = new Map<string, FileTreeNode>()
  const visit = (currentNodes: readonly FileTreeNode[]) => {
    for (const node of currentNodes) {
      result.set(node.id, node)
      if (node.children?.length) visit(node.children)
    }
  }
  visit(nodes)
  return result
}

function projectDirectoryEntries(
  workspacePath: string,
  entries: Array<{ path: string; isDirectory: boolean }>
): FileTreeNode[] {
  const rootName = getPathBasename(workspacePath)
  const rootNode: FileTreeNode = {
    id: WORKSPACE_ROOT_ID,
    name: rootName || workspacePath,
    kind: 'folder',
    path: WORKSPACE_ROOT_ID,
    children: []
  }

  const nodesById = new Map<string, FileTreeNode>([[WORKSPACE_ROOT_ID, rootNode]])

  for (const entry of entries) {
    const relativePath = normalizeArtifactPaneFilePath(workspacePath, entry.path)
    if (!relativePath) continue

    let parent = rootNode
    const segments = relativePath.split('/').filter(Boolean)
    for (let index = 0; index < segments.length; index += 1) {
      const id = segments.slice(0, index + 1).join('/')
      const isLast = index === segments.length - 1
      const kind: FileTreeNode['kind'] = isLast && !entry.isDirectory ? 'file' : 'folder'
      const existing = nodesById.get(id)
      if (existing) {
        if (existing.kind === 'folder') parent = existing
        continue
      }

      const node: FileTreeNode = {
        id,
        name: segments[index],
        kind,
        path: joinPath(WORKSPACE_ROOT_ID, id),
        children: kind === 'folder' ? [] : undefined
      }
      parent.children = parent.children ? [...parent.children, node] : [node]
      nodesById.set(id, node)
      if (node.kind === 'folder') parent = node
    }
  }

  const sortChildren = (node: FileTreeNode): FileTreeNode => {
    if (node.kind !== 'folder') return node
    return {
      ...node,
      children: sortFileTreeNodes((node.children ?? []).map(sortChildren))
    }
  }

  return [sortChildren(rootNode)]
}

interface WorkspaceFileTreeResult {
  tree: FileTreeNode[]
  isLoading: boolean
  hasLoaded: boolean
  error?: Error
  refresh: () => void
}

const useWorkspaceFileTree = (path: string | undefined): WorkspaceFileTreeResult => {
  const { root, version, isLoading, error } = useDirectoryTree(path, WORKSPACE_TREE_OPTIONS)

  const tree = useMemo(() => {
    void version
    return projectArtifactTree(root, path)
  }, [root, version, path])

  const refresh = useCallback(() => {
    /* no-op — watcher-driven */
  }, [])

  return {
    tree,
    isLoading,
    hasLoaded: !isLoading && root !== null,
    error: error ?? undefined,
    refresh
  }
}

function useArtifactFileSearch(workspacePath: string | undefined, searchKeyword: string): FileTreeNode[] | null {
  const [searchTree, setSearchTree] = useState<FileTreeNode[] | null>(null)
  const searchGenerationRef = useRef(0)

  useEffect(() => {
    const trimmedSearch = searchKeyword.trim()
    if (!workspacePath || !trimmedSearch) {
      searchGenerationRef.current += 1
      setSearchTree(null)
      return
    }

    const generation = searchGenerationRef.current + 1
    searchGenerationRef.current = generation

    const timeout = setTimeout(() => {
      void (async () => {
        try {
          const entries = await window.api.file.listDirectoryEntries(workspacePath as FilePath, {
            recursive: true,
            maxDepth: 0,
            includeHidden: false,
            includeFiles: true,
            includeDirectories: true,
            maxEntries: ARTIFACT_FILE_SEARCH_MAX_ENTRIES,
            searchPattern: trimmedSearch
          })
          if (generation !== searchGenerationRef.current) return
          setSearchTree(projectDirectoryEntries(workspacePath, entries))
        } catch (err) {
          if (generation !== searchGenerationRef.current) return
          const normalized = err instanceof Error ? err : new Error(String(err))
          logger.warn(`Failed to search workspace files: ${workspacePath}`, normalized)
          setSearchTree(null)
        }
      })()
    }, ARTIFACT_FILE_SEARCH_DEBOUNCE_MS)

    return () => {
      clearTimeout(timeout)
    }
  }, [searchKeyword, workspacePath])

  return searchTree
}

interface LazyDirectoryWatcher {
  treeId?: string
  unsubscribe?: () => void
  disposed: boolean
}

function useLazyArtifactFileTree({
  workspacePath,
  treeOpen,
  tree,
  expandedIds
}: {
  workspacePath?: string
  treeOpen: boolean
  tree: FileTreeNode[]
  expandedIds: ReadonlySet<string>
}) {
  const previousTreeOpenRef = useRef(false)
  const previousWorkspacePathRef = useRef(workspacePath)
  const lazyChildrenByDirIdRef = useRef<Map<string, FileTreeNode[]>>(new Map())
  const lazyLoadingDirIdsRef = useRef<Set<string>>(new Set())
  const lazyRequestIdsByDirIdRef = useRef<Map<string, number>>(new Map())
  const lazyDirectoryWatchersRef = useRef<Map<string, LazyDirectoryWatcher>>(new Map())
  const lazyLoadGenerationRef = useRef(0)
  const currentWorkspacePathRef = useRef(workspacePath)
  const [lazyChildrenVersion, setLazyChildrenVersion] = useState(0)
  currentWorkspacePathRef.current = workspacePath

  const bumpLazyVersion = useCallback(() => {
    setLazyChildrenVersion((version) => version + 1)
  }, [])

  const disposeLazyDirectoryWatcher = useCallback((dirId: string) => {
    const watcher = lazyDirectoryWatchersRef.current.get(dirId)
    if (!watcher) return
    watcher.disposed = true
    watcher.unsubscribe?.()
    if (watcher.treeId) {
      Promise.resolve(window.api.tree.dispose(watcher.treeId)).catch((err) => {
        logger.warn(`Failed to dispose lazy directory watcher: ${dirId}`, err as Error)
      })
    }
    lazyDirectoryWatchersRef.current.delete(dirId)
  }, [])

  const disposeLazyDirectoryWatchers = useCallback(() => {
    for (const dirId of Array.from(lazyDirectoryWatchersRef.current.keys())) {
      disposeLazyDirectoryWatcher(dirId)
    }
  }, [disposeLazyDirectoryWatcher])

  const resetLazyChildren = useCallback(() => {
    lazyLoadGenerationRef.current += 1
    lazyChildrenByDirIdRef.current.clear()
    lazyLoadingDirIdsRef.current.clear()
    lazyRequestIdsByDirIdRef.current.clear()
    bumpLazyVersion()
  }, [bumpLazyVersion])

  // Directory ids are workspace-relative, so cached children cannot cross a workspace boundary.
  useLayoutEffect(() => {
    if (previousWorkspacePathRef.current === workspacePath) return
    previousWorkspacePathRef.current = workspacePath
    resetLazyChildren()
  }, [resetLazyChildren, workspacePath])

  const restartLazyLoads = useCallback(
    (options?: { clearChildren?: boolean }) => {
      lazyLoadGenerationRef.current += 1
      lazyLoadingDirIdsRef.current.clear()
      lazyRequestIdsByDirIdRef.current.clear()
      if (options?.clearChildren) {
        lazyChildrenByDirIdRef.current.clear()
      }
      bumpLazyVersion()
    },
    [bumpLazyVersion]
  )

  const loadDirectoryChildren = useCallback(
    (dirId: string, options?: { force?: boolean }) => {
      if (!workspacePath || dirId === WORKSPACE_ROOT_ID) return
      if (!options?.force && (lazyChildrenByDirIdRef.current.has(dirId) || lazyLoadingDirIdsRef.current.has(dirId))) {
        return
      }

      lazyLoadingDirIdsRef.current.add(dirId)
      bumpLazyVersion()
      const generation = lazyLoadGenerationRef.current
      const requestId = (lazyRequestIdsByDirIdRef.current.get(dirId) ?? 0) + 1
      lazyRequestIdsByDirIdRef.current.set(dirId, requestId)
      const requestWorkspacePath = workspacePath
      const dirPath = joinPath(workspacePath, dirId)

      void (async () => {
        try {
          // One round trip that classifies each entry — avoids an `isDirectory`
          // IPC call per entry (was N+1 round trips per expanded folder).
          const entries = await window.api.file.listDirectoryEntries(dirPath as FilePath, {
            recursive: false,
            includeHidden: false,
            includeFiles: true,
            includeDirectories: true
          })
          const children = entries
            .map((entry) => {
              const relativePath = normalizeArtifactPaneFilePath(requestWorkspacePath, entry.path)
              if (!relativePath) return null
              return {
                id: relativePath,
                name: getPathBasename(relativePath),
                kind: entry.isDirectory ? 'folder' : 'file',
                path: joinPath(WORKSPACE_ROOT_ID, relativePath),
                children: entry.isDirectory ? [] : undefined
              } satisfies FileTreeNode
            })
            .filter((child) => child !== null)
          if (
            generation !== lazyLoadGenerationRef.current ||
            requestId !== lazyRequestIdsByDirIdRef.current.get(dirId) ||
            requestWorkspacePath !== currentWorkspacePathRef.current
          ) {
            return
          }
          lazyChildrenByDirIdRef.current.set(dirId, sortFileTreeNodes(children))
          bumpLazyVersion()
        } catch (err) {
          const normalized = err instanceof Error ? err : new Error(String(err))
          logger.warn(`Failed to load directory children: ${dirPath}`, normalized)
        } finally {
          if (
            generation === lazyLoadGenerationRef.current &&
            requestId === lazyRequestIdsByDirIdRef.current.get(dirId) &&
            requestWorkspacePath === currentWorkspacePathRef.current
          ) {
            lazyLoadingDirIdsRef.current.delete(dirId)
            lazyRequestIdsByDirIdRef.current.delete(dirId)
            bumpLazyVersion()
          }
        }
      })()
    },
    [bumpLazyVersion, workspacePath]
  )

  const reloadExpandedDirectories = useCallback(() => {
    const expandedToReload = Array.from(expandedIds).filter((id) => id !== WORKSPACE_ROOT_ID)
    restartLazyLoads()
    for (const id of expandedToReload) {
      loadDirectoryChildren(id, { force: true })
    }
  }, [expandedIds, loadDirectoryChildren, restartLazyLoads])

  const createLazyDirectoryWatcher = useCallback(
    (dirId: string) => {
      if (!workspacePath || dirId === WORKSPACE_ROOT_ID || lazyDirectoryWatchersRef.current.has(dirId)) return

      const watcher: LazyDirectoryWatcher = { disposed: false }
      lazyDirectoryWatchersRef.current.set(dirId, watcher)

      const requestWorkspacePath = workspacePath
      const dirPath = joinPath(workspacePath, dirId)

      void (async () => {
        try {
          const result: CreateTreeIpcResult = await window.api.tree.create(dirPath, {
            maxDepth: 1,
            includeHidden: false
          })
          if (
            watcher.disposed ||
            requestWorkspacePath !== currentWorkspacePathRef.current ||
            lazyDirectoryWatchersRef.current.get(dirId) !== watcher
          ) {
            Promise.resolve(window.api.tree.dispose(result.treeId)).catch((err) => {
              logger.warn(`Failed to dispose stale lazy directory watcher: ${dirId}`, err as Error)
            })
            return
          }

          watcher.treeId = result.treeId
          watcher.unsubscribe = window.api.tree.onMutation((payload: TreeMutationPushPayload) => {
            if (payload.treeId !== result.treeId) return
            loadDirectoryChildren(dirId, { force: true })
          })
        } catch (err) {
          if (watcher.disposed || lazyDirectoryWatchersRef.current.get(dirId) !== watcher) return
          lazyDirectoryWatchersRef.current.delete(dirId)
          const normalized = err instanceof Error ? err : new Error(String(err))
          logger.warn(`Failed to watch lazy directory: ${dirPath}`, normalized)
        }
      })()
    },
    [loadDirectoryChildren, workspacePath]
  )

  const displayTree = useMemo(() => {
    void lazyChildrenVersion
    return mergeLazyChildren(tree, lazyChildrenByDirIdRef.current)
  }, [tree, lazyChildrenVersion])

  useEffect(() => {
    if (previousTreeOpenRef.current && !treeOpen) {
      resetLazyChildren()
    }
    previousTreeOpenRef.current = treeOpen
  }, [resetLazyChildren, treeOpen])

  useEffect(() => {
    return () => {
      disposeLazyDirectoryWatchers()
    }
  }, [disposeLazyDirectoryWatchers, treeOpen, workspacePath])

  useEffect(() => {
    if (!treeOpen) return
    for (const id of expandedIds) {
      loadDirectoryChildren(id)
    }
  }, [expandedIds, loadDirectoryChildren, treeOpen])

  useEffect(() => {
    if (!treeOpen || !workspacePath) {
      disposeLazyDirectoryWatchers()
      return
    }

    const nextWatchedIds = new Set(Array.from(expandedIds).filter((id) => id !== WORKSPACE_ROOT_ID))
    for (const dirId of Array.from(lazyDirectoryWatchersRef.current.keys())) {
      if (!nextWatchedIds.has(dirId)) disposeLazyDirectoryWatcher(dirId)
    }
    for (const dirId of nextWatchedIds) {
      createLazyDirectoryWatcher(dirId)
    }
  }, [
    createLazyDirectoryWatcher,
    disposeLazyDirectoryWatcher,
    disposeLazyDirectoryWatchers,
    expandedIds,
    treeOpen,
    workspacePath
  ])

  return {
    displayTree,
    isLoading:
      lazyLoadingDirIdsRef.current.size > 0 ||
      Array.from(expandedIds).some((id) => id !== WORKSPACE_ROOT_ID && !lazyChildrenByDirIdRef.current.has(id)),
    loadDirectoryChildren,
    reloadExpandedDirectories
  }
}

/** True when `selectedFile` resolves to a file node in the current tree. */
export function isSelectableFileNode(
  nodeById: ReadonlyMap<string, FileTreeNode>,
  selectedFile: string | null
): boolean {
  if (!selectedFile) return false
  return nodeById.get(selectedFile)?.kind === 'file'
}

export interface UseArtifactFileTreeModelParams {
  workspacePath?: string
  /** Gates "create only while visible" — the tree is built only when open. */
  treeOpen: boolean
  /** Caller-owned expanded folder ids (synthetic workspace root managed internally). */
  expandedIds: ReadonlySet<string>
  searchKeyword: string
  enableFileSearch: boolean
  selectedFile: string | null
  /** Called with the post-strip expanded set the caller should adopt. */
  onExpandedIdsChange: (next: ReadonlySet<string>) => void
}

export interface ArtifactFileTreeModel {
  filteredTree: FileTreeNode[]
  effectiveExpandedIds: ReadonlySet<string>
  nodeById: ReadonlyMap<string, FileTreeNode>
  isLoading: boolean
  hasLoaded: boolean
  error?: Error
  setExpandedIds: (ids: ReadonlySet<string>) => void
  reloadExpandedDirectories: () => void
  refresh: () => void
}

/**
 * Owns the workspace directory tree: materialization (`useDirectoryTree`),
 * lazy directory loading, and the O(N) projections the file panel renders.
 *
 * A right-panel capability creates this model on first presentation. The
 * capability controller then keeps that instance alive across close, tab, and
 * layout changes; `ArtifactPaneView` only renders the returned model.
 */
export function useArtifactFileTreeModel({
  workspacePath,
  treeOpen,
  expandedIds,
  searchKeyword,
  enableFileSearch,
  selectedFile,
  onExpandedIdsChange
}: UseArtifactFileTreeModelParams): ArtifactFileTreeModel {
  const { tree, isLoading, hasLoaded, error, refresh } = useWorkspaceFileTree(treeOpen ? workspacePath : undefined)
  const {
    displayTree,
    isLoading: isLazyLoading,
    loadDirectoryChildren,
    reloadExpandedDirectories
  } = useLazyArtifactFileTree({
    workspacePath,
    treeOpen,
    tree,
    expandedIds
  })

  const setExpandedIds = useCallback(
    (ids: ReadonlySet<string>) => {
      const nextIds = stripWorkspaceRootId(ids)
      for (const id of nextIds) {
        if (!expandedIds.has(id)) loadDirectoryChildren(id)
      }
      onExpandedIdsChange(nextIds)
    },
    [expandedIds, loadDirectoryChildren, onExpandedIdsChange]
  )

  const trimmedFileSearch = enableFileSearch ? searchKeyword.trim() : ''
  const searchTree = useArtifactFileSearch(treeOpen && enableFileSearch ? workspacePath : undefined, trimmedFileSearch)
  const searchableTree = useMemo(() => {
    if (!trimmedFileSearch || !searchTree) return displayTree
    return mergeFileTreeNodeLists(displayTree, searchTree)
  }, [displayTree, searchTree, trimmedFileSearch])

  const displayNodeById = useMemo(() => indexFileTreeNodes(displayTree), [displayTree])
  const searchableNodeById = useMemo(() => indexFileTreeNodes(searchableTree), [searchableTree])
  const preservedSelectedSearchNodeRef = useRef<FileTreeNode | null>(null)

  useEffect(() => {
    if (!selectedFile || !workspacePath) {
      preservedSelectedSearchNodeRef.current = null
      return
    }

    const displayNode = displayNodeById.get(selectedFile)
    if (displayNode?.kind === 'file') {
      preservedSelectedSearchNodeRef.current = null
      return
    }

    const searchNode = searchableNodeById.get(selectedFile)
    if (trimmedFileSearch && searchNode?.kind === 'file') {
      preservedSelectedSearchNodeRef.current = searchNode
      return
    }

    if (preservedSelectedSearchNodeRef.current?.id !== selectedFile) {
      preservedSelectedSearchNodeRef.current = null
    }
  }, [displayNodeById, searchableNodeById, selectedFile, trimmedFileSearch, workspacePath])

  const nodeById = useMemo(() => {
    const result = new Map(searchableNodeById)
    const preservedSelectedSearchNode = preservedSelectedSearchNodeRef.current
    if (preservedSelectedSearchNode && !result.has(preservedSelectedSearchNode.id)) {
      result.set(preservedSelectedSearchNode.id, preservedSelectedSearchNode)
    }
    return result
  }, [searchableNodeById])

  const expandedIdsWithWorkspaceRoot = useMemo<ReadonlySet<string>>(() => {
    if (!workspacePath) return expandedIds
    const next = new Set(expandedIds)
    next.add(WORKSPACE_ROOT_ID)
    return next
  }, [expandedIds, workspacePath])

  const filteredTree = useMemo<FileTreeNode[]>(() => {
    if (!trimmedFileSearch) return displayTree
    const needle = trimmedFileSearch.toLowerCase()
    const filterNodes = (nodes: readonly FileTreeNode[]): FileTreeNode[] => {
      const out: FileTreeNode[] = []
      for (const node of nodes) {
        if (node.kind === 'folder') {
          const filteredChildren = filterNodes(node.children ?? [])
          if (filteredChildren.length > 0 || node.name.toLowerCase().includes(needle)) {
            out.push({ ...node, children: filteredChildren })
          }
        } else if (node.name.toLowerCase().includes(needle)) {
          out.push(node)
        }
      }
      return out
    }
    return filterNodes(searchableTree)
  }, [displayTree, searchableTree, trimmedFileSearch])

  // While searching, expand every visible folder so matches stay reachable —
  // user-toggled `expandedIds` resumes after the keyword clears.
  const effectiveExpandedIds = useMemo<ReadonlySet<string>>(() => {
    if (!trimmedFileSearch) return expandedIdsWithWorkspaceRoot
    const expanded = new Set<string>()
    const visit = (nodes: readonly FileTreeNode[]) => {
      for (const node of nodes) {
        if (node.kind === 'folder') {
          expanded.add(node.id)
          if (node.children?.length) visit(node.children)
        }
      }
    }
    visit(filteredTree)
    return expanded
  }, [expandedIdsWithWorkspaceRoot, trimmedFileSearch, filteredTree])

  return {
    filteredTree,
    effectiveExpandedIds,
    nodeById,
    isLoading,
    hasLoaded: hasLoaded && !isLazyLoading,
    error,
    setExpandedIds,
    reloadExpandedDirectories,
    refresh
  }
}
