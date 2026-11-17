import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { loggerService } from '@logger'
import { type FileTreeNode } from '@renderer/components/FileTree'
import { useDirectoryTree } from '@renderer/hooks/useDirectoryTree'
import { DirectoryTreeSession } from '@renderer/services/DirectoryTreeSession'
import { joinPath } from '@renderer/utils/path'
import { AbsoluteFilePathSchema } from '@shared/types/file'
import type { DirectoryTreeOptions, TreeDir, TreeDirRoot, TreeNode } from '@shared/utils/file'

import { getPathBasename, normalizeArtifactPaneFilePath, WORKSPACE_ROOT_ID } from './artifactPanePath'

const logger = loggerService.withContext('useArtifactFileTreeModel')

// Level 1 is all a collapsed tree renders, so a deeper initial scan only buys prefetch; a deep
// watcher over a real workspace exhausts file descriptors (EMFILE) and stalls the main thread.
const ARTIFACT_TREE_INITIAL_MAX_DEPTH = 1
const ARTIFACT_FILE_SEARCH_DEBOUNCE_MS = 200
const ARTIFACT_FILE_SEARCH_MAX_ENTRIES = 200
const WORKSPACE_TREE_OPTIONS: DirectoryTreeOptions = {
  maxDepth: ARTIFACT_TREE_INITIAL_MAX_DEPTH
}
export const ARTIFACT_MISSING_WORKSPACE_TREE_OPTIONS: DirectoryTreeOptions = {
  maxDepth: ARTIFACT_TREE_INITIAL_MAX_DEPTH,
  watchMissingRoot: true
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

    const children = lazyChildrenByDirId.get(node.id) ?? node.children ?? []
    return { ...node, children: mergeLazyChildren(children, lazyChildrenByDirId) }
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
}

const useWorkspaceFileTree = (path: string | undefined, watchMissingRoot: boolean): WorkspaceFileTreeResult => {
  const { root, version, isLoading, error } = useDirectoryTree(
    path,
    watchMissingRoot ? ARTIFACT_MISSING_WORKSPACE_TREE_OPTIONS : WORKSPACE_TREE_OPTIONS
  )

  const tree = useMemo(() => {
    void version
    return projectArtifactTree(root, path)
  }, [root, version, path])

  return {
    tree,
    isLoading,
    hasLoaded: !isLoading && root !== null,
    error: error ?? undefined
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
          const entries = await window.api.file.listDirectoryEntries(AbsoluteFilePathSchema.parse(workspacePath), {
            recursive: true,
            maxDepth: 0,
            includeHidden: false,
            includeFiles: true,
            includeDirectories: false,
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
  const { path: scopePath, sessions } = useMemo(
    () => ({
      path: workspacePath,
      sessions: new Map<string, { session: DirectoryTreeSession; release: () => void }>()
    }),
    [workspacePath]
  )
  const requested = useRef(new Set<string>())
  const [version, setVersion] = useState(0)
  const acquire = useCallback(
    (dirId: string) => {
      if (!scopePath || dirId === WORKSPACE_ROOT_ID || sessions.has(dirId)) return
      const session = new DirectoryTreeSession(
        joinPath(scopePath, dirId),
        { maxDepth: 1, includeHidden: false },
        () => {}
      )
      const record = { session, release: () => {} }
      sessions.set(dirId, record)
      record.release = session.subscribe(() => setVersion((value) => value + 1))
    },
    [sessions, scopePath]
  )
  useEffect(() => {
    requested.current.clear()
    return () => {
      for (const { release } of sessions.values()) release()
      sessions.clear()
    }
  }, [sessions])
  useEffect(() => {
    const needed = treeOpen ? new Set([...expandedIds, ...requested.current]) : new Set<string>()
    let removed = false
    for (const [id, { release }] of sessions) {
      if (!needed.has(id)) {
        removed = true
        release()
        sessions.delete(id)
      }
    }
    for (const id of needed) acquire(id)
    if (removed) setVersion((value) => value + 1)
  }, [acquire, expandedIds, sessions, treeOpen])
  const loadDirectoryChildren = useCallback(
    (dirId: string) => {
      requested.current.add(dirId)
      acquire(dirId)
    },
    [acquire]
  )
  const { displayTree, isLoading } = useMemo(() => {
    void version
    const children = new Map<string, FileTreeNode[]>()
    let loading = false
    for (const [id, { session }] of sessions) {
      const state = session.getSnapshot()
      loading ||= state.isLoading
      if (state.root) children.set(id, projectChildren(state.root, id))
    }
    return { displayTree: mergeLazyChildren(tree, children), isLoading: loading }
  }, [sessions, tree, version])
  return { displayTree, isLoading, loadDirectoryChildren }
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
  /** Keep an empty watched tree while an app-owned workspace is created lazily. */
  watchMissingRoot?: boolean
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
  errorKind?: ArtifactFileTreeErrorKind
  setExpandedIds: (ids: ReadonlySet<string>) => void
  /** Loads a folder's entries into `nodeById` without expanding it. */
  loadFolder: (id: string) => void
}

export type ArtifactFileTreeErrorKind = 'invalid_path' | 'load_error'

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
  watchMissingRoot = false,
  treeOpen,
  expandedIds,
  searchKeyword,
  enableFileSearch,
  selectedFile,
  onExpandedIdsChange
}: UseArtifactFileTreeModelParams): ArtifactFileTreeModel {
  const workspacePathResult = workspacePath ? AbsoluteFilePathSchema.safeParse(workspacePath) : null
  const validWorkspacePath = workspacePathResult?.success ? workspacePathResult.data : undefined
  const invalidWorkspacePath = Boolean(workspacePath && !workspacePathResult?.success)

  useEffect(() => {
    if (invalidWorkspacePath) {
      logger.warn('Skipped artifact file tree for invalid workspace path', { workspacePath })
    }
  }, [invalidWorkspacePath, workspacePath])

  const { tree, isLoading, hasLoaded, error } = useWorkspaceFileTree(
    treeOpen ? validWorkspacePath : undefined,
    watchMissingRoot
  )
  const {
    displayTree,
    isLoading: isLazyLoading,
    loadDirectoryChildren
  } = useLazyArtifactFileTree({
    workspacePath: validWorkspacePath,
    treeOpen,
    tree,
    expandedIds
  })

  const setExpandedIds = useCallback(
    (ids: ReadonlySet<string>) => {
      const nextIds = stripWorkspaceRootId(ids)
      onExpandedIdsChange(nextIds)
    },
    [onExpandedIdsChange]
  )

  // Loaded entries attach under their folder's node, which exists only once its ancestors are loaded.
  const loadFolder = useCallback(
    (id: string) => {
      const segments = id.split('/')
      segments.forEach((_, index) => loadDirectoryChildren(segments.slice(0, index + 1).join('/')))
    },
    [loadDirectoryChildren]
  )

  const trimmedFileSearch = enableFileSearch ? searchKeyword.trim() : ''
  const searchTree = useArtifactFileSearch(
    treeOpen && enableFileSearch ? validWorkspacePath : undefined,
    trimmedFileSearch
  )
  const searchableTree = useMemo(() => {
    if (!trimmedFileSearch || !searchTree) return displayTree
    return mergeFileTreeNodeLists(displayTree, searchTree)
  }, [displayTree, searchTree, trimmedFileSearch])

  const displayNodeById = useMemo(() => indexFileTreeNodes(displayTree), [displayTree])
  const searchableNodeById = useMemo(() => indexFileTreeNodes(searchableTree), [searchableTree])
  const preservedSelectedSearchNodeRef = useRef<FileTreeNode | null>(null)

  useEffect(() => {
    if (!selectedFile || !validWorkspacePath) {
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
  }, [displayNodeById, searchableNodeById, selectedFile, trimmedFileSearch, validWorkspacePath])

  const nodeById = useMemo(() => {
    const result = new Map(searchableNodeById)
    const preservedSelectedSearchNode = preservedSelectedSearchNodeRef.current
    if (preservedSelectedSearchNode && !result.has(preservedSelectedSearchNode.id)) {
      result.set(preservedSelectedSearchNode.id, preservedSelectedSearchNode)
    }
    return result
  }, [searchableNodeById])

  const expandedIdsWithWorkspaceRoot = useMemo<ReadonlySet<string>>(() => {
    if (!validWorkspacePath) return expandedIds
    const next = new Set(expandedIds)
    next.add(WORKSPACE_ROOT_ID)
    return next
  }, [expandedIds, validWorkspacePath])

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

  // The workspace is the pane's subject, so its synthetic root row is not shown.
  const visibleTree = useMemo<FileTreeNode[]>(
    () =>
      filteredTree.length === 1 && filteredTree[0].id === WORKSPACE_ROOT_ID
        ? (filteredTree[0].children ?? [])
        : filteredTree,
    [filteredTree]
  )

  return {
    filteredTree: visibleTree,
    effectiveExpandedIds,
    nodeById,
    isLoading,
    hasLoaded: hasLoaded && !isLazyLoading,
    errorKind: invalidWorkspacePath ? 'invalid_path' : error ? 'load_error' : undefined,
    setExpandedIds,
    loadFolder
  }
}
