import { loggerService } from '@logger'
import { type FileTreeNode } from '@renderer/components/FileTree'
import { useDirectoryTree } from '@renderer/hooks/useDirectoryTree'
import { joinPath } from '@renderer/utils/path'
import type { FilePath } from '@shared/types/file/common'
import type { DirectoryTreeOptions, TreeDir, TreeDirRoot, TreeNode } from '@shared/utils/file/tree'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { getPathBasename, normalizeArtifactPaneFilePath, WORKSPACE_ROOT_ID } from './artifactPanePath'

const logger = loggerService.withContext('useArtifactFileTreeModel')

const ARTIFACT_TREE_INITIAL_MAX_DEPTH = 3
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
  const lazyChildrenByDirIdRef = useRef<Map<string, FileTreeNode[]>>(new Map())
  const lazyLoadingDirIdsRef = useRef<Set<string>>(new Set())
  const lazyLoadGenerationRef = useRef(0)
  const currentWorkspacePathRef = useRef(workspacePath)
  const [lazyChildrenVersion, setLazyChildrenVersion] = useState(0)
  currentWorkspacePathRef.current = workspacePath

  const resetLazyChildren = useCallback(() => {
    lazyLoadGenerationRef.current += 1
    lazyChildrenByDirIdRef.current.clear()
    lazyLoadingDirIdsRef.current.clear()
    setLazyChildrenVersion((version) => version + 1)
  }, [])

  const loadDirectoryChildren = useCallback(
    (dirId: string, options?: { force?: boolean }) => {
      if (!workspacePath || dirId === WORKSPACE_ROOT_ID) return
      if (!options?.force && (lazyChildrenByDirIdRef.current.has(dirId) || lazyLoadingDirIdsRef.current.has(dirId))) {
        return
      }

      lazyLoadingDirIdsRef.current.add(dirId)
      const generation = lazyLoadGenerationRef.current
      const requestWorkspacePath = workspacePath
      const dirPath = joinPath(workspacePath, dirId)

      void (async () => {
        try {
          const paths = await window.api.file.listDirectory(dirPath as FilePath, {
            recursive: false,
            includeHidden: false,
            includeFiles: true,
            includeDirectories: true
          })
          const children = await Promise.all(
            paths.map(async (path) => {
              const relativePath = normalizeArtifactPaneFilePath(requestWorkspacePath, path)
              if (!relativePath) return null
              try {
                const isDirectory = await window.api.file.isDirectory(path)
                return {
                  id: relativePath,
                  name: getPathBasename(relativePath),
                  kind: isDirectory ? 'folder' : 'file',
                  path: joinPath(WORKSPACE_ROOT_ID, relativePath),
                  children: isDirectory ? [] : undefined
                } satisfies FileTreeNode
              } catch {
                return null
              }
            })
          )
          if (
            generation !== lazyLoadGenerationRef.current ||
            requestWorkspacePath !== currentWorkspacePathRef.current
          ) {
            return
          }
          lazyChildrenByDirIdRef.current.set(dirId, sortFileTreeNodes(children.filter((child) => child !== null)))
          setLazyChildrenVersion((version) => version + 1)
        } catch (err) {
          const normalized = err instanceof Error ? err : new Error(String(err))
          logger.warn(`Failed to load directory children: ${dirPath}`, normalized)
        } finally {
          if (
            generation === lazyLoadGenerationRef.current &&
            requestWorkspacePath === currentWorkspacePathRef.current
          ) {
            lazyLoadingDirIdsRef.current.delete(dirId)
          }
        }
      })()
    },
    [workspacePath]
  )

  const reloadExpandedDirectories = useCallback(() => {
    const expandedToReload = Array.from(expandedIds).filter((id) => id !== WORKSPACE_ROOT_ID)
    resetLazyChildren()
    for (const id of expandedToReload) {
      loadDirectoryChildren(id, { force: true })
    }
  }, [expandedIds, loadDirectoryChildren, resetLazyChildren])

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
    if (!treeOpen) return
    for (const id of expandedIds) {
      loadDirectoryChildren(id)
    }
  }, [expandedIds, loadDirectoryChildren, treeOpen])

  return {
    displayTree,
    loadDirectoryChildren,
    reloadExpandedDirectories,
    resetLazyChildren
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
  resetLazyChildren: () => void
  refresh: () => void
}

/**
 * Owns the workspace directory tree: materialization (`useDirectoryTree`),
 * lazy directory loading, and the O(N) projections the file panel renders.
 *
 * Lifting this whole model above the `ArtifactPane` instance lets the agent
 * right-pane create it once (in a provider that survives the Host↔Overlay
 * maximize swap) instead of rebuilding it on every remount. The presentational
 * `ArtifactPaneView` just renders the returned model.
 */
export function useArtifactFileTreeModel({
  workspacePath,
  treeOpen,
  expandedIds,
  searchKeyword,
  enableFileSearch,
  onExpandedIdsChange
}: UseArtifactFileTreeModelParams): ArtifactFileTreeModel {
  const { tree, isLoading, hasLoaded, error, refresh } = useWorkspaceFileTree(treeOpen ? workspacePath : undefined)
  const { displayTree, loadDirectoryChildren, reloadExpandedDirectories, resetLazyChildren } = useLazyArtifactFileTree({
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

  const nodeById = useMemo(() => {
    const result = new Map<string, FileTreeNode>()
    const visit = (nodes: readonly FileTreeNode[]) => {
      for (const node of nodes) {
        result.set(node.id, node)
        if (node.children?.length) visit(node.children)
      }
    }
    visit(displayTree)
    return result
  }, [displayTree])

  const trimmedFileSearch = enableFileSearch ? searchKeyword.trim() : ''

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
    return filterNodes(displayTree)
  }, [displayTree, trimmedFileSearch])

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
    hasLoaded,
    error,
    setExpandedIds,
    reloadExpandedDirectories,
    resetLazyChildren,
    refresh
  }
}
