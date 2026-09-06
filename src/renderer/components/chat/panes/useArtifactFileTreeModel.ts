import { loggerService } from '@logger'
import type { FileTreeModel } from '@renderer/components/FileTree'
import { useDirectoryTree } from '@renderer/hooks/useDirectoryTree'
import { ipcApi } from '@renderer/ipc'
import { joinPath } from '@renderer/utils/path'
import { AbsoluteFilePathSchema } from '@shared/types/file'
import type {
  CreateTreeIpcResult,
  DirectoryTreeOptions,
  TreeDirRoot,
  TreeMutationEvent,
  TreeNode
} from '@shared/utils/file'
import { useCallback, useEffect, useRef, useState } from 'react'

import { normalizeArtifactPaneFilePath } from './artifactPanePath'

const logger = loggerService.withContext('useArtifactFileTreeModel')

const ARTIFACT_TREE_INITIAL_MAX_DEPTH = 3
/** Handshake rounds before a lazy watcher gives up — see `useDirectoryTree`'s copy. */
const MAX_ACTIVATION_ATTEMPTS = 3
const ARTIFACT_FILE_SEARCH_DEBOUNCE_MS = 200
const ARTIFACT_FILE_SEARCH_MAX_ENTRIES = 200
const WORKSPACE_TREE_OPTIONS: DirectoryTreeOptions = {
  maxDepth: ARTIFACT_TREE_INITIAL_MAX_DEPTH
}
export const ARTIFACT_MISSING_WORKSPACE_TREE_OPTIONS: DirectoryTreeOptions = {
  watchMissingRoot: true
}

/**
 * Grace period before the lazy directory watchers of an unmounted/hidden tree
 * are actually disposed. Absorbs <Activity> tab switches, which run this
 * hook's cleanups on hide and re-run its effects on show — without the grace,
 * every switch paid a tree.dispose + tree.create IPC per expanded directory.
 */
const LAZY_WATCHER_DISPOSE_GRACE_MS = 10_000

/** Canonical tree path for a node: workspace-relative, directories keep a trailing slash. */
function toTreePath(relativePath: string, isDirectory: boolean): string {
  return isDirectory ? `${relativePath}/` : relativePath
}

/**
 * Projects the main-side mirror into the flat, workspace-relative path list the
 * tree model consumes. There is no synthetic root row — the workspace name is a
 * pane header, the way VS Code titles its explorer.
 */
function collectWorkspacePaths(root: TreeDirRoot | null, workspacePath: string | undefined): string[] {
  if (!root || !workspacePath) return []
  const paths: string[] = []
  root.walk((node: TreeNode) => {
    if (node === root) return
    const relativePath = normalizeArtifactPaneFilePath(workspacePath, node.path)
    if (!relativePath) return
    paths.push(toTreePath(relativePath, node.isTreeDir()))
  })
  return paths
}

/**
 * Directories with no children in the scan. Those are the ones the depth cap cut
 * off (a genuinely empty directory is in here too — loading it just yields
 * nothing, which is harmless and self-correcting).
 */
function collectUnloadedDirectories(paths: readonly string[]): Set<string> {
  const directories = new Set<string>()
  const parentsWithChildren = new Set<string>()
  for (const path of paths) {
    if (path.endsWith('/')) directories.add(path)
    const lastSeparator = path.replace(/\/$/, '').lastIndexOf('/')
    if (lastSeparator > 0) parentsWithChildren.add(`${path.slice(0, lastSeparator)}/`)
  }
  for (const parent of parentsWithChildren) directories.delete(parent)
  return directories
}

interface LazyDirectoryWatcher {
  treeId?: string
  unsubscribe?: () => void
  disposed: boolean
}

/**
 * Loads directories the initial depth-capped scan cut off, on expand.
 *
 * The library has no expansion callback, so this reacts to model notifications
 * and sweeps the visible rows. Counting them cannot stand in for a callback —
 * expanding an unloaded directory adds no rows, so the count never moves — but
 * the rows themselves carry `isExpanded`, and rows hidden under a collapsed
 * ancestor are absent, which is exactly the set worth loading and watching.
 *
 * The sweep is coalesced per frame: notifications also fire for focus and
 * selection moves, which must not each cost a pass.
 */
function useLazyArtifactDirectories({
  model,
  workspacePath,
  treeOpen
}: {
  model: FileTreeModel
  workspacePath?: string
  treeOpen: boolean
}) {
  const unloadedDirectoriesRef = useRef<Set<string>>(new Set())
  const loadingDirectoriesRef = useRef<Set<string>>(new Set())
  const watchersRef = useRef<Map<string, LazyDirectoryWatcher>>(new Map())
  const pendingWatcherDisposeRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const watchersWorkspacePathRef = useRef(workspacePath)
  const currentWorkspacePathRef = useRef(workspacePath)
  const generationRef = useRef(0)
  const [pendingCount, setPendingCount] = useState(0)
  currentWorkspacePathRef.current = workspacePath

  const disposeWatcher = useCallback((dirPath: string) => {
    const watcher = watchersRef.current.get(dirPath)
    if (!watcher) return
    watcher.disposed = true
    watcher.unsubscribe?.()
    if (watcher.treeId) {
      Promise.resolve(ipcApi.request('file.tree.dispose', { treeId: watcher.treeId })).catch((err) => {
        logger.warn(`Failed to dispose lazy directory watcher: ${dirPath}`, err as Error)
      })
    }
    watchersRef.current.delete(dirPath)
  }, [])

  const disposeWatchers = useCallback(() => {
    for (const dirPath of Array.from(watchersRef.current.keys())) disposeWatcher(dirPath)
  }, [disposeWatcher])

  const loadDirectory = useCallback(
    (dirPath: string, options?: { force?: boolean }) => {
      if (!workspacePath) return
      if (!options?.force && loadingDirectoriesRef.current.has(dirPath)) return

      loadingDirectoriesRef.current.add(dirPath)
      setPendingCount((count) => count + 1)
      const generation = generationRef.current
      const requestWorkspacePath = workspacePath
      const relativeDir = dirPath.replace(/\/$/, '')
      const absoluteDir = joinPath(workspacePath, relativeDir)

      void (async () => {
        try {
          // One round trip that classifies each entry — avoids an `isDirectory`
          // IPC call per entry (was N+1 round trips per expanded folder).
          const entries = await window.api.file.listDirectoryEntries(AbsoluteFilePathSchema.parse(absoluteDir), {
            recursive: false,
            includeHidden: false,
            includeFiles: true,
            includeDirectories: true
          })
          if (generation !== generationRef.current || requestWorkspacePath !== currentWorkspacePathRef.current) {
            return
          }

          const childPaths: string[] = []
          for (const entry of entries) {
            const relativePath = normalizeArtifactPaneFilePath(requestWorkspacePath, entry.path)
            if (!relativePath) continue
            childPaths.push(toTreePath(relativePath, entry.isDirectory))
          }

          // One semantic mutation for the whole directory — the model patches its
          // projection in place instead of us rebuilding and re-diffing a tree.
          model.batch(childPaths.map((path) => ({ type: 'add' as const, path })))

          unloadedDirectoriesRef.current.delete(dirPath)
          for (const childPath of childPaths) {
            if (childPath.endsWith('/')) unloadedDirectoriesRef.current.add(childPath)
          }
        } catch (err) {
          const normalized = err instanceof Error ? err : new Error(String(err))
          logger.warn(`Failed to load directory children: ${absoluteDir}`, normalized)
        } finally {
          if (generation === generationRef.current && requestWorkspacePath === currentWorkspacePathRef.current) {
            loadingDirectoriesRef.current.delete(dirPath)
            setPendingCount((count) => count - 1)
          }
        }
      })()
    },
    [model, workspacePath]
  )

  const createWatcher = useCallback(
    (dirPath: string) => {
      if (!workspacePath || watchersRef.current.has(dirPath)) return

      const watcher: LazyDirectoryWatcher = { disposed: false }
      watchersRef.current.set(dirPath, watcher)

      const requestWorkspacePath = workspacePath
      const absoluteDir = joinPath(workspacePath, dirPath.replace(/\/$/, ''))

      void (async () => {
        try {
          for (let attempt = 1; attempt <= MAX_ACTIVATION_ATTEMPTS; attempt += 1) {
            const result: CreateTreeIpcResult = await ipcApi.request('file.tree.create', {
              rootPath: AbsoluteFilePathSchema.parse(absoluteDir),
              options: { maxDepth: 1, includeHidden: false }
            })
            if (
              watcher.disposed ||
              requestWorkspacePath !== currentWorkspacePathRef.current ||
              watchersRef.current.get(dirPath) !== watcher
            ) {
              Promise.resolve(ipcApi.request('file.tree.dispose', { treeId: result.treeId })).catch((err) => {
                logger.warn(`Failed to dispose stale lazy directory watcher: ${dirPath}`, err as Error)
              })
              return
            }

            // Assign both before awaiting `activate`, so a concurrent
            // `disposeWatcher` tears this watcher down completely.
            watcher.treeId = result.treeId
            watcher.unsubscribe = ipcApi.on('file.tree.mutation', (payload) => {
              if (payload.treeId !== result.treeId) return
              loadDirectory(dirPath, { force: true })
            })

            // A created consumer stays pending: mutations queue main-side until it is
            // activated. Without this the subtree would freeze at its snapshot and the
            // queue would grow for as long as the directory stays expanded.
            const activated = await ipcApi.request('file.tree.activate', {
              treeId: result.treeId,
              revision: result.revision
            })
            if (activated) {
              // A refused round means events were dropped while we were unwatched, so
              // the rendered children predate them. Nothing else re-runs this effect.
              if (attempt > 1) loadDirectory(dirPath, { force: true })
              return
            }

            // Main dropped this consumer (pending-buffer overflow) before we activated.
            // Release the half-installed watcher and take a fresh snapshot — leaving it
            // would keep the expanded directory frozen with nothing to un-freeze it.
            logger.warn(`Lazy directory watcher refused activation, retaking the snapshot: ${dirPath}`, { attempt })
            watcher.unsubscribe?.()
            watcher.unsubscribe = undefined
            watcher.treeId = undefined
            Promise.resolve(ipcApi.request('file.tree.dispose', { treeId: result.treeId })).catch((err) => {
              logger.warn(`Failed to dispose refused lazy directory watcher: ${dirPath}`, err as Error)
            })
          }
          throw new Error(`Lazy directory watcher was refused activation ${MAX_ACTIVATION_ATTEMPTS} times: ${dirPath}`)
        } catch (err) {
          if (watcher.disposed || watchersRef.current.get(dirPath) !== watcher) return
          // Drops the subscription and the main-side tree too — both may already be
          // attached if the failure came from `activate` rather than `create`.
          disposeWatcher(dirPath)
          const normalized = err instanceof Error ? err : new Error(String(err))
          logger.warn(`Failed to watch lazy directory: ${absoluteDir}`, normalized)
        }
      })()
    },
    [disposeWatcher, loadDirectory, workspacePath]
  )

  /** Adopt a fresh scan: everything previously loaded lazily is superseded. */
  const resetUnloadedDirectories = useCallback((paths: readonly string[]) => {
    generationRef.current += 1
    loadingDirectoriesRef.current.clear()
    unloadedDirectoriesRef.current = collectUnloadedDirectories(paths)
  }, [])

  useEffect(() => {
    if (!treeOpen || !workspacePath) return
    let frame: number | null = null

    const sweep = () => {
      frame = null
      // One pass over the visible rows answers both questions: which expanded
      // directories still need their children, and which ones deserve a watcher.
      // Rows under a collapsed ancestor are absent, and those need neither.
      const expanded = new Set<string>()
      const rows = model.getVisibleRows(0, model.getVisibleCount())
      for (const row of rows) {
        if (row.kind !== 'directory' || !row.isExpanded) continue
        expanded.add(row.path)
        if (unloadedDirectoriesRef.current.has(row.path)) loadDirectory(row.path)
      }
      for (const dirPath of Array.from(watchersRef.current.keys())) {
        if (!expanded.has(dirPath)) disposeWatcher(dirPath)
      }
      for (const dirPath of expanded) createWatcher(dirPath)
    }

    const schedule = () => {
      if (frame !== null) return
      frame = requestAnimationFrame(sweep)
    }

    schedule()
    const unsubscribe = model.subscribe(schedule)
    return () => {
      if (frame !== null) cancelAnimationFrame(frame)
      unsubscribe()
    }
  }, [createWatcher, disposeWatcher, loadDirectory, model, treeOpen, workspacePath])

  useEffect(() => {
    // A dispose scheduled by the previous cleanup (an <Activity> hide) is
    // canceled here: the watcher map lives in a ref that survived, so the
    // still-live watchers are reused instead of recreated.
    if (pendingWatcherDisposeRef.current !== null) {
      clearTimeout(pendingWatcherDisposeRef.current)
      pendingWatcherDisposeRef.current = null
    }
    // Watchers watch absolute paths under the previous workspace — after a
    // workspace switch, surviving watchers must be dropped immediately.
    if (watchersWorkspacePathRef.current !== workspacePath) {
      watchersWorkspacePathRef.current = workspacePath
      disposeWatchers()
    }
    return () => {
      pendingWatcherDisposeRef.current = setTimeout(() => {
        pendingWatcherDisposeRef.current = null
        disposeWatchers()
      }, LAZY_WATCHER_DISPOSE_GRACE_MS)
    }
  }, [disposeWatchers, workspacePath])

  const reloadExpandedDirectories = useCallback(() => {
    for (const dirPath of Array.from(watchersRef.current.keys())) loadDirectory(dirPath, { force: true })
  }, [loadDirectory])

  return { resetUnloadedDirectories, reloadExpandedDirectories, isLoading: pendingCount > 0 }
}

/** Debounced cross-directory search, merged into the model as extra paths. */
function useArtifactFileSearch(model: FileTreeModel, workspacePath: string | undefined, searchKeyword: string) {
  const generationRef = useRef(0)

  useEffect(() => {
    const trimmedSearch = searchKeyword.trim()
    // The library filters the loaded tree itself; this only pulls in matches that
    // the depth cap never scanned, so deep hits stay reachable from search.
    model.setSearch(trimmedSearch || null)
    if (!workspacePath || !trimmedSearch) {
      generationRef.current += 1
      return
    }

    const generation = generationRef.current + 1
    generationRef.current = generation

    const timeout = setTimeout(() => {
      void (async () => {
        try {
          const entries = await window.api.file.listDirectoryEntries(AbsoluteFilePathSchema.parse(workspacePath), {
            recursive: true,
            maxDepth: 0,
            includeHidden: false,
            includeFiles: true,
            includeDirectories: true,
            maxEntries: ARTIFACT_FILE_SEARCH_MAX_ENTRIES,
            searchPattern: trimmedSearch
          })
          if (generation !== generationRef.current) return
          const additions = entries
            .map((entry) => {
              const relativePath = normalizeArtifactPaneFilePath(workspacePath, entry.path)
              return relativePath ? toTreePath(relativePath, entry.isDirectory) : null
            })
            .filter((path) => path !== null)
          model.batch(additions.map((path) => ({ type: 'add' as const, path })))
        } catch (err) {
          const normalized = err instanceof Error ? err : new Error(String(err))
          logger.warn(`Failed to search workspace files: ${workspacePath}`, normalized)
        }
      })()
    }, ARTIFACT_FILE_SEARCH_DEBOUNCE_MS)

    return () => {
      clearTimeout(timeout)
    }
  }, [model, searchKeyword, workspacePath])
}

/** True when `path` resolves to a file (not a directory) in the current tree. */
export function isSelectableFilePath(model: FileTreeModel, path: string | null): boolean {
  if (!path) return false
  return model.getItem(path)?.isDirectory() === false
}

export interface UseArtifactFileTreeModelParams {
  /** Caller-owned tree model, created above the pane's `<Activity>` boundary. */
  model: FileTreeModel
  workspacePath?: string
  /** Keep an empty watched tree while an app-owned workspace is created lazily. */
  watchMissingRoot?: boolean
  /** Gates "scan only while visible" — the main-side tree is built only when open. */
  treeOpen: boolean
  searchKeyword: string
  enableFileSearch: boolean
}

export interface ArtifactFileTreeModel {
  isLoading: boolean
  hasLoaded: boolean
  errorKind?: ArtifactFileTreeErrorKind
  reloadExpandedDirectories: () => void
  refresh: () => void
}

export type ArtifactFileTreeErrorKind = 'invalid_path' | 'load_error'

/**
 * Drives the workspace file tree: materialization (`useDirectoryTree`), lazy
 * directory loading, and search — all as incremental mutations on a caller-owned
 * `@pierre/trees` model.
 *
 * Nothing here projects or clones a tree. A filesystem event becomes one
 * `add`/`remove`/`move`; an expanded directory becomes one `batch`. That is what
 * keeps the cost proportional to the change instead of to the workspace.
 */
export function useArtifactFileTreeModel({
  model,
  workspacePath,
  watchMissingRoot = false,
  treeOpen,
  searchKeyword,
  enableFileSearch
}: UseArtifactFileTreeModelParams): ArtifactFileTreeModel {
  const workspacePathResult = workspacePath ? AbsoluteFilePathSchema.safeParse(workspacePath) : null
  const validWorkspacePath = workspacePathResult?.success ? workspacePathResult.data : undefined
  const invalidWorkspacePath = Boolean(workspacePath && !workspacePathResult?.success)

  useEffect(() => {
    if (invalidWorkspacePath) {
      logger.warn('Skipped artifact file tree for invalid workspace path', { workspacePath })
    }
  }, [invalidWorkspacePath, workspacePath])

  const scanPath = treeOpen ? validWorkspacePath : undefined
  const {
    resetUnloadedDirectories,
    reloadExpandedDirectories,
    isLoading: isLazyLoading
  } = useLazyArtifactDirectories({ model, workspacePath: validWorkspacePath, treeOpen })

  // Filesystem churn is applied as semantic mutations rather than a re-scan, so
  // the tree stays live without rebuilding anything.
  const applyMutation = useCallback(
    (event: TreeMutationEvent) => {
      if (!validWorkspacePath) return
      const toRelative = (absolutePath: string) => normalizeArtifactPaneFilePath(validWorkspacePath, absolutePath)
      if (event.type === 'added') {
        const relativePath = toRelative(event.path)
        if (relativePath) model.add(toTreePath(relativePath, event.kind === 'directory'))
        return
      }
      if (event.type === 'removed') {
        const relativePath = toRelative(event.path)
        if (!relativePath) return
        // The mutation stream does not say which kind vanished; only one of the
        // two candidate paths exists, and `remove` on a missing path is a no-op.
        model.remove(relativePath, { recursive: true })
        model.remove(`${relativePath}/`, { recursive: true })
        return
      }
      if (event.type === 'renamed') {
        const from = toRelative(event.oldPath)
        const to = toRelative(event.newPath)
        if (!from || !to) return
        const isDirectory = model.getItem(`${from}/`)?.isDirectory() === true
        model.move(toTreePath(from, isDirectory), toTreePath(to, isDirectory))
      }
    },
    [model, validWorkspacePath]
  )

  const { root, version, isLoading, error } = useDirectoryTree(
    scanPath,
    watchMissingRoot ? ARTIFACT_MISSING_WORKSPACE_TREE_OPTIONS : WORKSPACE_TREE_OPTIONS,
    applyMutation
  )

  // A fresh snapshot replaces the model wholesale; later churn arrives through
  // `applyMutation`, so this runs on scan identity rather than every version tick.
  const appliedScanRef = useRef<{ root: TreeDirRoot | null; path?: string } | null>(null)
  useEffect(() => {
    if (appliedScanRef.current?.root === root && appliedScanRef.current.path === scanPath) return
    appliedScanRef.current = { root, path: scanPath }
    const paths = collectWorkspacePaths(root, scanPath)
    model.resetPaths(paths)
    resetUnloadedDirectories(paths)
  }, [model, resetUnloadedDirectories, root, scanPath])
  void version

  useArtifactFileSearch(model, treeOpen && enableFileSearch ? validWorkspacePath : undefined, searchKeyword)

  const refresh = useCallback(() => {
    /* no-op — watcher-driven */
  }, [])

  return {
    isLoading,
    hasLoaded: !isLoading && root !== null && !isLazyLoading,
    errorKind: invalidWorkspacePath ? 'invalid_path' : error ? 'load_error' : undefined,
    reloadExpandedDirectories,
    refresh
  }
}
