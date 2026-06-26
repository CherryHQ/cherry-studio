import { Button, Markdown, Tooltip } from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import { usePersistCache } from '@data/hooks/useCache'
import { loggerService } from '@logger'
import { EmptyState, LoadingState } from '@renderer/components/chat'
import HtmlPreviewFrame from '@renderer/components/CodeBlockView/HtmlPreviewFrame'
import CodeViewer from '@renderer/components/CodeViewer'
import { FileTree, type FileTreeNode } from '@renderer/components/FileTree'
import { useDirectoryTree } from '@renderer/hooks/useDirectoryTree'
import { type FileSizeState, useFileSize } from '@renderer/hooks/useFileSize'
import { type IsTextState, useIsTextFile } from '@renderer/hooks/useIsTextFile'
import { useResizeDrag } from '@renderer/hooks/useResizeDrag'
import { getLanguageByFilePath } from '@renderer/utils/codeLanguage'
import { joinPath } from '@renderer/utils/path'
import type { FilePath } from '@shared/types/file/common'
import type { DirectoryTreeOptions, TreeDir, TreeDirRoot, TreeNode } from '@shared/utils/file/tree'
import { toFileUrl } from '@shared/utils/file/urlUtil'
import { AlertCircle, FileText, Folder, FolderOpen, Maximize2, Minimize2, RotateCw, Sparkles } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import {
  type ComponentType,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import { useTranslation } from 'react-i18next'

import { CHAT_SHELL_TRANSITION } from '../shell/paneLayout'
import { getVerticalSplitterProps } from '../shell/splitterA11y'
import OpenExternalAppButton from './OpenExternalAppButton'

const logger = loggerService.withContext('ArtifactPane')

export const ARTIFACT_PANE_WIDTH = 460
export const ARTIFACT_FILE_TREE_DEFAULT_WIDTH = 160
export const ARTIFACT_FILE_TREE_CACHE_KEY = 'ui.chat.artifact_pane.file_tree.width'
const ARTIFACT_FILE_TREE_MIN_WIDTH = 80
const ARTIFACT_FILE_TREE_MAX_WIDTH_OFFSET = 140
const WORKSPACE_ROOT_ID = '__workspace_root__'

export interface ArtifactPaneProps {
  workspacePath?: string
  maximized?: boolean
  pdfLayoutPending?: boolean
  pdfLayoutRefreshKey?: number
  selectedFile?: string | null
  onSelectedFileChange?: (file: string | null) => void
  fileTreeOpen?: boolean
  onFileTreeOpenChange?: (open: boolean) => void
  /** Caller-owned expanded folder ids. The synthetic workspace root is managed internally. */
  fileTreeExpandedIds?: ReadonlySet<string>
  onFileTreeExpandedIdsChange?: (next: ReadonlySet<string>) => void
  fileTreeSearchKeyword?: string
  onFileTreeSearchKeywordChange?: (keyword: string) => void
  onToggleMaximized?: () => void
  /** Show a search input inside the file tree that filters nodes by name. */
  enableFileSearch?: boolean
}

export interface ArtifactPaneFileSelection {
  workspacePath: string
  filePath: string
}

interface ArtifactFilePreviewProps {
  workspacePath?: string
  filePath?: string | null
  isText: IsTextState
  fileSize: FileSizeState
  officeActions?: ReactNode
  pdfLayoutPending?: boolean
  pdfLayoutRefreshKey?: number
  contentRefreshKey?: number
}

/** Files above this size skip text preview (and `readText`) — Shiki tokenize gets unusable past ~2MB. */
export const ARTIFACT_PREVIEW_MAX_SIZE_BYTES = 2 * 1024 * 1024
const ARTIFACT_PREVIEW_MAX_SIZE_LABEL = '2 MB'

// Extensions below drive special-case rendering (Markdown / iframe / PdfPreviewPanel),
// not text-vs-binary classification. Text detection lives in `useIsTextFile`.
const MARKDOWN_EXT = new Set(['.md', '.mdx', '.markdown'])
const HTML_EXT = new Set(['.html', '.htm'])
const PDF_EXT = new Set(['.pdf'])
const OFFICE_DOCUMENT_EXT = new Set(['.doc', '.docx', '.xls', '.xlsx', '.xlsm', '.ppt', '.pptx'])

const extOf = (name: string): string => {
  const dot = name.lastIndexOf('.')
  return dot < 0 ? '' : name.slice(dot).toLowerCase()
}

const isMarkdownFile = (name: string) => MARKDOWN_EXT.has(extOf(name))
const isHtmlFile = (name: string) => HTML_EXT.has(extOf(name))
const isPdfFile = (name: string) => PDF_EXT.has(extOf(name))
export const isOfficeDocumentFile = (name: string) => OFFICE_DOCUMENT_EXT.has(extOf(name))

const stripWorkspaceRootId = (ids: ReadonlySet<string>): ReadonlySet<string> => {
  if (!ids.has(WORKSPACE_ROOT_ID)) return ids
  const next = new Set(ids)
  next.delete(WORKSPACE_ROOT_ID)
  return next
}

const getPathBasename = (path: string): string => {
  const trimmed = path.trim().replace(/[\\/]+$/, '')
  if (!trimmed) return path
  const segments = trimmed.split(/[/\\]+/).filter(Boolean)
  return segments.at(-1) ?? trimmed
}

const normalizeTreePath = (path: string): string => {
  const normalized = path.trim().replace(/\\/g, '/')
  const withoutTrailingSlash = normalized.replace(/\/+$/, '')
  if (/^[A-Za-z]:$/.test(withoutTrailingSlash)) return `${withoutTrailingSlash}/`
  if (!withoutTrailingSlash && normalized.startsWith('/')) return '/'
  return withoutTrailingSlash
}

const isAbsoluteTreePath = (path: string): boolean => path.startsWith('/') || /^[A-Za-z]:\//.test(path)

const hasParentTraversal = (path: string): boolean => path.split(/[/\\]+/).some((segment) => segment === '..')

const getPathDirname = (path: string): string => {
  const normalized = normalizeTreePath(path)
  const basename = getPathBasename(normalized)
  if (!basename || normalized === basename) return ''

  const dirname = normalized.slice(0, normalized.length - basename.length).replace(/\/+$/, '')
  if (!dirname && normalized.startsWith('/')) return '/'
  if (/^[A-Za-z]:$/.test(dirname)) return `${dirname}/`
  return dirname
}

export const normalizeArtifactPaneFilePath = (workspacePath: string, rawPath: string): string | null => {
  const workspace = normalizeTreePath(workspacePath)
  const normalized = normalizeTreePath(rawPath)
  if (!normalized) return null

  if (normalized === workspace) return null
  if (workspace === '/' && normalized.startsWith('/')) return normalized.slice(1)
  if (normalized.startsWith(`${workspace}/`)) return normalized.slice(workspace.length + 1)
  if (isAbsoluteTreePath(normalized)) return null

  return normalized.replace(/^\/+/, '')
}

export const resolveArtifactPaneFileSelection = (
  workspacePath: string | undefined,
  rawPath: string
): ArtifactPaneFileSelection | null => {
  const normalized = normalizeTreePath(rawPath)
  if (!normalized) return null

  if (workspacePath) {
    const workspaceFilePath = normalizeArtifactPaneFilePath(workspacePath, normalized)
    if (workspaceFilePath) {
      if (!hasParentTraversal(workspaceFilePath)) {
        return { workspacePath, filePath: workspaceFilePath }
      }
      // Deliberate: a workspace-relative artifact path that climbs out via `..` is allowed — the
      // agent legitimately creates files outside the workspace — but re-root it to the resolved
      // file's directory (like the absolute-path branch below) so the displayed tree root and the
      // previewed file stay consistent, instead of showing the workspace while reading outside it.
      // Sandboxing, if ever needed, is the consumer's responsibility at the trust boundary.
      const resolvedAbsolute = joinPath(normalizeTreePath(workspacePath), workspaceFilePath)
      const escapedWorkspacePath = getPathDirname(resolvedAbsolute)
      const escapedFilePath = getPathBasename(resolvedAbsolute)
      return escapedWorkspacePath && escapedFilePath && escapedFilePath !== escapedWorkspacePath
        ? { workspacePath: escapedWorkspacePath, filePath: escapedFilePath }
        : null
    }
  }

  if (!isAbsoluteTreePath(normalized)) return null

  const externalWorkspacePath = getPathDirname(normalized)
  const filePath = getPathBasename(normalized)
  if (!externalWorkspacePath || !filePath || filePath === externalWorkspacePath) return null

  return { workspacePath: externalWorkspacePath, filePath }
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

interface WorkspaceFileTreeResult {
  tree: FileTreeNode[]
  isLoading: boolean
  hasLoaded: boolean
  error?: Error
  refresh: () => void
}

type PdfPreviewPanelComponent = ComponentType<{
  filePath: string
  fileName: string
  refreshKey: number
}>

let pdfPreviewPanelPromise: Promise<PdfPreviewPanelComponent> | null = null

const loadPdfPreviewPanel = () => {
  pdfPreviewPanelPromise ??= import('./PdfPreviewPanel')
    .then((module) => module.default)
    .catch((err: unknown) => {
      pdfPreviewPanelPromise = null
      throw err
    })
  return pdfPreviewPanelPromise
}

function getArtifactFileTreeWidthBounds(artifactPaneWidth: number) {
  const minWidth = ARTIFACT_FILE_TREE_MIN_WIDTH
  const maxWidth = Math.max(minWidth, Math.round(artifactPaneWidth - ARTIFACT_FILE_TREE_MAX_WIDTH_OFFSET))
  return { minWidth, maxWidth }
}

function clampArtifactFileTreeWidth(width: number, artifactPaneWidth: number): number {
  const { minWidth, maxWidth } = getArtifactFileTreeWidthBounds(artifactPaneWidth)
  return Math.min(maxWidth, Math.max(minWidth, Math.round(width)))
}

function useArtifactFileTreeResize() {
  const [storedWidth, setStoredWidth] = usePersistCache(ARTIFACT_FILE_TREE_CACHE_KEY)
  const artifactPaneRef = useRef<HTMLDivElement>(null)
  const paneRef = useRef<HTMLDivElement>(null)
  const currentArtifactPaneWidthRef = useRef(ARTIFACT_PANE_WIDTH)
  const paneLeftRef = useRef(0)
  const [artifactPaneWidth, setArtifactPaneWidth] = useState(ARTIFACT_PANE_WIDTH)
  const paneWidth = clampArtifactFileTreeWidth(storedWidth ?? ARTIFACT_FILE_TREE_DEFAULT_WIDTH, artifactPaneWidth)

  const measureArtifactPaneWidth = useCallback(() => {
    const width = artifactPaneRef.current?.getBoundingClientRect().width
    return width && Number.isFinite(width) ? width : ARTIFACT_PANE_WIDTH
  }, [])

  useEffect(() => {
    const updateArtifactPaneWidth = () => setArtifactPaneWidth(measureArtifactPaneWidth())
    updateArtifactPaneWidth()

    const element = artifactPaneRef.current
    if (!element || typeof ResizeObserver === 'undefined') return

    const observer = new ResizeObserver(updateArtifactPaneWidth)
    observer.observe(element)
    return () => observer.disconnect()
  }, [measureArtifactPaneWidth])

  const handleMouseMove = useCallback(
    (moveEvent: MouseEvent) => {
      setStoredWidth(
        clampArtifactFileTreeWidth(moveEvent.clientX - paneLeftRef.current, currentArtifactPaneWidthRef.current)
      )
    },
    [setStoredWidth]
  )

  const { isResizing, startResizing: startResizeDrag } = useResizeDrag({ onMove: handleMouseMove })

  const startResizing = useCallback(
    (event: ReactMouseEvent) => {
      const currentArtifactPaneWidth = measureArtifactPaneWidth()
      currentArtifactPaneWidthRef.current = currentArtifactPaneWidth
      setArtifactPaneWidth(currentArtifactPaneWidth)
      paneLeftRef.current = paneRef.current?.getBoundingClientRect().left ?? event.clientX - paneWidth
      startResizeDrag(event)
    },
    [measureArtifactPaneWidth, paneWidth, startResizeDrag]
  )

  const setPaneWidth = useCallback(
    // Clamp against the live measured width (same value that feeds the splitter's aria-valuemax),
    // not currentArtifactPaneWidthRef — that ref is only written at mouse-drag start, so a keyboard
    // resize without a prior drag would otherwise clamp to a stale bound and undershoot the max.
    (nextWidth: number) => setStoredWidth(clampArtifactFileTreeWidth(nextWidth, artifactPaneWidth)),
    [artifactPaneWidth, setStoredWidth]
  )

  const { minWidth, maxWidth } = getArtifactFileTreeWidthBounds(artifactPaneWidth)

  return {
    artifactPaneRef,
    isResizing,
    paneRef,
    paneWidth,
    minWidth,
    maxWidth,
    startResizing,
    setPaneWidth
  }
}

// Module-level defaults keep the sampled options stable for each tree mount.
// `useDirectoryTree` rebuilds only when the root path changes.
const WORKSPACE_TREE_OPTIONS: DirectoryTreeOptions = {
  // No extension filter — the workspace pane shows whatever the agent
  // produced. `respectGitignore` defaults to `true` (good for code repos),
  // dotfiles stay hidden by default.
}

// The main-side `DirectoryTreeManager` owns the scan + watcher lifecycle.
const useWorkspaceFileTree = (path: string | undefined): WorkspaceFileTreeResult => {
  const { root, version, isLoading, error } = useDirectoryTree(path, WORKSPACE_TREE_OPTIONS)

  const tree = useMemo(() => {
    void version
    return projectArtifactTree(root, path)
  }, [root, version, path])

  // The watcher attached by `DirectoryTreeBuilder` keeps the projection
  // current automatically (agent writes / external edits surface as
  // `added` / `removed` events). `refresh` stays in the public shape so
  // the toolbar refresh button + content-cache re-pull continue to work,
  // but the tree side is a no-op now.
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

export function ArtifactFilePreview({
  workspacePath,
  filePath,
  isText,
  fileSize,
  officeActions,
  pdfLayoutPending = false,
  pdfLayoutRefreshKey = 0,
  contentRefreshKey = 0
}: ArtifactFilePreviewProps) {
  const { t } = useTranslation()
  const [fileContent, setFileContent] = useState<string | null>(null)
  const [PdfPreviewPanel, setPdfPreviewPanel] = useState<PdfPreviewPanelComponent | null>(null)
  const [pdfPreviewLoadError, setPdfPreviewLoadError] = useState<Error | null>(null)
  const [readError, setReadError] = useState<Error | null>(null)
  const [loadingContent, setLoadingContent] = useState(false)
  const isPdfPreview = filePath ? isPdfFile(filePath) : false
  const isOfficeDocumentPreview = filePath ? isOfficeDocumentFile(filePath) : false
  const oversizedForPreview =
    !isPdfPreview &&
    !isOfficeDocumentPreview &&
    fileSize.status === 'ok' &&
    fileSize.size > ARTIFACT_PREVIEW_MAX_SIZE_BYTES

  useEffect(() => {
    if (!filePath || !workspacePath) {
      setFileContent(null)
      setReadError(null)
      setLoadingContent(false)
      return
    }

    // Binary previewers render straight from disk or external apps; no readText needed.
    if (isPdfFile(filePath) || isOfficeDocumentFile(filePath)) {
      setFileContent(null)
      setReadError(null)
      setLoadingContent(false)
      return
    }

    // Wait for both sniffs to settle before paying the readText cost — gates
    // out binary files, oversized files, and inaccessible paths.
    if (isText !== 'text' || fileSize.status !== 'ok' || oversizedForPreview) {
      setFileContent(null)
      setReadError(null)
      setLoadingContent(false)
      return
    }

    const absPath = joinPath(workspacePath, filePath)
    let cancelled = false
    setReadError(null)
    setLoadingContent(true)

    void (async () => {
      try {
        const text = await window.api.fs.readText(absPath)
        if (cancelled) return
        setFileContent(text)
      } catch (err) {
        if (cancelled) return
        const normalized = err instanceof Error ? err : new Error(String(err))
        logger.error(`Failed to read file: ${absPath}`, normalized)
        setFileContent(null)
        setReadError(normalized)
      } finally {
        if (!cancelled) setLoadingContent(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [contentRefreshKey, filePath, workspacePath, isText, fileSize.status, oversizedForPreview])

  useEffect(() => {
    if (!isPdfPreview) {
      setPdfPreviewLoadError(null)
      return
    }
    if (pdfLayoutPending || PdfPreviewPanel) return

    let cancelled = false
    setPdfPreviewLoadError(null)

    loadPdfPreviewPanel()
      .then((component) => {
        if (!cancelled) setPdfPreviewPanel(() => component)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        const normalized = err instanceof Error ? err : new Error(String(err))
        logger.error('Failed to load PDF preview panel', normalized)
        setPdfPreviewLoadError(normalized)
      })

    return () => {
      cancelled = true
    }
  }, [PdfPreviewPanel, filePath, isPdfPreview, pdfLayoutPending])

  if (!workspacePath) {
    return (
      <EmptyState
        icon={Sparkles}
        title={t('agent.preview_pane.empty.title')}
        description={t('agent.preview_pane.empty.description')}
      />
    )
  }
  if (!filePath) {
    return <EmptyState icon={FileText} title={t('agent.preview_pane.select_file')} />
  }

  // PDF: binary but renderable; bypass isText gating.
  if (isPdfFile(filePath)) {
    if (pdfPreviewLoadError) {
      return <EmptyState icon={AlertCircle} title={t('common.error')} description={pdfPreviewLoadError.message} />
    }
    if (pdfLayoutPending || !PdfPreviewPanel) {
      return (
        <div className="flex h-full w-full items-center justify-center">
          <LoadingState label={t('common.loading')} />
        </div>
      )
    }
    return (
      <PdfPreviewPanel
        key={`pdf-${filePath}-${pdfLayoutRefreshKey}`}
        filePath={joinPath(workspacePath, filePath)}
        fileName={filePath}
        refreshKey={pdfLayoutRefreshKey}
      />
    )
  }

  if (oversizedForPreview) {
    return (
      <EmptyState
        icon={FileText}
        title={t('agent.preview_pane.too_large.title')}
        description={t('agent.preview_pane.too_large.description', { limit: ARTIFACT_PREVIEW_MAX_SIZE_LABEL })}
      />
    )
  }

  if (isText === 'pending' || fileSize.status === 'pending') {
    return <LoadingState variant="skeleton" rows={4} />
  }
  // A failed size sniff means the file couldn't be stat'd (missing / moved /
  // inaccessible). This is the report surface for opening a file that no longer
  // exists — callers just open the file and let this pane explain the failure,
  // rather than pre-checking existence over IPC.
  if (fileSize.status === 'error') {
    return (
      <EmptyState
        icon={AlertCircle}
        title={t('agent.preview_pane.unavailable.title')}
        description={t('agent.preview_pane.unavailable.description')}
      />
    )
  }
  if (isOfficeDocumentPreview) {
    const extension = extOf(filePath).replace(/^\./, '')
    return (
      <EmptyState
        icon={FileText}
        title={t('agent.preview_pane.office.title', { extension })}
        description={t('agent.preview_pane.office.description')}
        actions={officeActions}
      />
    )
  }
  if (isText === 'binary') {
    return (
      <EmptyState
        icon={FileText}
        title={t('agent.preview_pane.preview')}
        description={t('agent.preview_pane.code_unavailable')}
      />
    )
  }

  if (loadingContent) {
    return <LoadingState variant="skeleton" rows={4} />
  }

  if (readError) {
    return (
      <EmptyState
        icon={AlertCircle}
        title={t('agent.preview_pane.unavailable.title')}
        description={t('agent.preview_pane.unavailable.description')}
      />
    )
  }

  if (isHtmlFile(filePath)) {
    return (
      <HtmlPreviewFrame
        key={`html-${filePath}-${contentRefreshKey}`}
        html={fileContent ?? ''}
        title={filePath}
        baseUrl={toFileUrl(joinPath(workspacePath, filePath) as FilePath)}
      />
    )
  }
  if (isMarkdownFile(filePath)) {
    return (
      <div className="min-w-0 px-5 py-4">
        <Markdown id={`md-${filePath}-${contentRefreshKey}`}>{fileContent ?? ''}</Markdown>
      </div>
    )
  }
  return (
    <CodeViewer
      key={`preview-${filePath}-${contentRefreshKey}`}
      value={fileContent ?? ''}
      language={getLanguageByFilePath(filePath)}
      wrapped={false}
    />
  )
}

const ArtifactPane = ({
  workspacePath,
  maximized = false,
  pdfLayoutPending = false,
  pdfLayoutRefreshKey = 0,
  selectedFile: selectedFileProp,
  onSelectedFileChange,
  fileTreeOpen: fileTreeOpenProp,
  onFileTreeOpenChange,
  fileTreeExpandedIds: fileTreeExpandedIdsProp,
  onFileTreeExpandedIdsChange,
  fileTreeSearchKeyword: fileTreeSearchKeywordProp,
  onFileTreeSearchKeywordChange,
  onToggleMaximized,
  enableFileSearch = false
}: ArtifactPaneProps) => {
  const { t } = useTranslation()
  const { tree, isLoading, hasLoaded, error, refresh } = useWorkspaceFileTree(workspacePath)
  const {
    artifactPaneRef,
    isResizing: isFileTreeResizing,
    paneRef: fileTreePaneRef,
    paneWidth: fileTreeWidth,
    minWidth: fileTreeMinWidth,
    maxWidth: fileTreeMaxWidth,
    startResizing: startFileTreeResizing,
    setPaneWidth: setFileTreeWidth
  } = useArtifactFileTreeResize()

  const [internalFileTreeOpen, setInternalFileTreeOpen] = useState(false)
  const [internalSelectedFile, setInternalSelectedFile] = useState<string | null>(null)
  const [internalFileTreeExpandedIds, setInternalFileTreeExpandedIds] = useState<ReadonlySet<string>>(() => new Set())
  const [contentRefreshToken, setContentRefreshToken] = useState(0)
  const [internalFileTreeSearchKeyword, setInternalFileTreeSearchKeyword] = useState('')
  const previousWorkspacePathRef = useRef(workspacePath)
  const hasMountedRef = useRef(false)
  const selectedFileControlled = selectedFileProp !== undefined
  const selectedFile = selectedFileControlled ? selectedFileProp : internalSelectedFile
  const fileTreeOpenControlled = fileTreeOpenProp !== undefined
  const treeOpen = fileTreeOpenProp ?? internalFileTreeOpen
  const fileTreeExpandedIdsControlled = fileTreeExpandedIdsProp !== undefined
  const expandedIds = fileTreeExpandedIdsProp ?? internalFileTreeExpandedIds
  const fileTreeSearchKeywordControlled = fileTreeSearchKeywordProp !== undefined
  const fileSearchKeyword = fileTreeSearchKeywordProp ?? internalFileTreeSearchKeyword
  const setSelectedFile = useCallback(
    (file: string | null) => {
      if (!selectedFileControlled) setInternalSelectedFile(file)
      onSelectedFileChange?.(file)
    },
    [onSelectedFileChange, selectedFileControlled]
  )
  const setTreeOpen = useCallback(
    (open: boolean) => {
      if (!fileTreeOpenControlled) setInternalFileTreeOpen(open)
      onFileTreeOpenChange?.(open)
    },
    [fileTreeOpenControlled, onFileTreeOpenChange]
  )
  const setExpandedIds = useCallback(
    (ids: ReadonlySet<string>) => {
      const nextIds = stripWorkspaceRootId(ids)
      if (!fileTreeExpandedIdsControlled) setInternalFileTreeExpandedIds(nextIds)
      onFileTreeExpandedIdsChange?.(nextIds)
    },
    [fileTreeExpandedIdsControlled, onFileTreeExpandedIdsChange]
  )
  const setFileSearchKeyword = useCallback(
    (keyword: string) => {
      if (!fileTreeSearchKeywordControlled) setInternalFileTreeSearchKeyword(keyword)
      onFileTreeSearchKeywordChange?.(keyword)
    },
    [fileTreeSearchKeywordControlled, onFileTreeSearchKeywordChange]
  )

  const nodeById = useMemo(() => {
    const result = new Map<string, FileTreeNode>()
    const visit = (nodes: readonly FileTreeNode[]) => {
      for (const node of nodes) {
        result.set(node.id, node)
        if (node.children?.length) visit(node.children)
      }
    }
    visit(tree)
    return result
  }, [tree])

  const trimmedFileSearch = enableFileSearch ? fileSearchKeyword.trim() : ''

  const expandedIdsWithWorkspaceRoot = useMemo<ReadonlySet<string>>(() => {
    if (!workspacePath) return expandedIds
    const next = new Set(expandedIds)
    next.add(WORKSPACE_ROOT_ID)
    return next
  }, [expandedIds, workspacePath])

  const filteredTree = useMemo<FileTreeNode[]>(() => {
    if (!trimmedFileSearch) return tree
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
    return filterNodes(tree)
  }, [tree, trimmedFileSearch])

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

  // Reset transient state when the workspace changes.
  useEffect(() => {
    const workspaceChanged = previousWorkspacePathRef.current !== workspacePath
    if (workspaceChanged) {
      if (!selectedFileControlled) setSelectedFile(null)
    }
    previousWorkspacePathRef.current = workspacePath

    if (!hasMountedRef.current || workspaceChanged) {
      if (!fileTreeExpandedIdsControlled) setExpandedIds(new Set())
      if (!fileTreeSearchKeywordControlled) setFileSearchKeyword('')
    }
    hasMountedRef.current = true
    setContentRefreshToken(0)
  }, [
    fileTreeExpandedIdsControlled,
    fileTreeSearchKeywordControlled,
    selectedFileControlled,
    setExpandedIds,
    setFileSearchKeyword,
    setSelectedFile,
    workspacePath
  ])

  useEffect(() => {
    if (!selectedFile || !hasLoaded) return

    const selectedNode = nodeById.get(selectedFile)
    if (selectedNode?.kind === 'file') return

    setSelectedFile(null)
  }, [hasLoaded, nodeById, selectedFile, setSelectedFile])

  const handleSelectedChange = useCallback(
    (id: string | null) => {
      if (!id) {
        setSelectedFile(null)
        return
      }

      const node = nodeById.get(id)
      if (node?.kind === 'file') setSelectedFile(id)
    },
    [nodeById, setSelectedFile]
  )

  const isPdfSelection = selectedFile ? isPdfFile(selectedFile) : false
  const isOfficeDocumentSelection = selectedFile ? isOfficeDocumentFile(selectedFile) : false
  const shouldSniffSelectedFile = !isPdfSelection && !isOfficeDocumentSelection
  const sniffedIsText = useIsTextFile(workspacePath, selectedFile, { enabled: shouldSniffSelectedFile })
  const isText = shouldSniffSelectedFile ? sniffedIsText : 'binary'
  const fileSize = useFileSize(workspacePath, selectedFile)

  const handleRefresh = useCallback(() => {
    refresh()
    if (workspacePath && selectedFile && isText === 'text') {
      setContentRefreshToken((v) => v + 1)
    }
  }, [refresh, selectedFile, workspacePath, isText])

  const isSelectedHtmlPreview = selectedFile ? isHtmlFile(selectedFile) : false
  const isSelectedPdfPreview = isPdfSelection
  const openableFilePath = isOfficeDocumentSelection ? selectedFile : null

  const maximizeLabel = t(maximized ? 'agent.preview_pane.minimize' : 'agent.preview_pane.maximize')
  const FileTreeIcon = treeOpen ? FolderOpen : Folder
  const MaximizeIcon = maximized ? Minimize2 : Maximize2

  const renderRight = () => {
    if (!workspacePath) {
      return (
        <EmptyState
          icon={Sparkles}
          title={t('agent.preview_pane.empty.title')}
          description={t('agent.preview_pane.empty.description')}
        />
      )
    }
    if (error) {
      return <EmptyState icon={AlertCircle} title={t('common.error')} description={error.message} />
    }
    return (
      <ArtifactFilePreview
        workspacePath={workspacePath}
        filePath={selectedFile}
        isText={isText}
        fileSize={fileSize}
        pdfLayoutPending={pdfLayoutPending}
        pdfLayoutRefreshKey={pdfLayoutRefreshKey}
        contentRefreshKey={contentRefreshToken}
      />
    )
  }

  const headerToggleClass = (active: boolean) =>
    cn(
      'text-muted-foreground hover:bg-accent hover:text-foreground',
      active && 'bg-accent text-foreground hover:text-foreground'
    )

  return (
    <div
      ref={artifactPaneRef}
      className={cn(
        'flex h-full min-h-0 flex-col overflow-hidden bg-card text-card-foreground',
        maximized && 'rounded-lg border border-border-subtle shadow-sm'
      )}>
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <AnimatePresence initial={false}>
          {treeOpen && (
            <motion.div
              ref={fileTreePaneRef}
              key="artifact-file-tree"
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: fileTreeWidth, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={isFileTreeResizing ? { duration: 0 } : CHAT_SHELL_TRANSITION}
              data-artifact-file-tree-pane
              data-resizing={isFileTreeResizing || undefined}
              className="group/artifact-file-tree relative shrink-0 overflow-hidden">
              <aside className="flex h-full w-full flex-col overflow-hidden border-border-subtle border-r">
                <div
                  data-artifact-file-tree-scroll-region
                  className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-1 py-2">
                  {isLoading ? (
                    <LoadingState variant="skeleton" rows={4} />
                  ) : (
                    <FileTree
                      nodes={filteredTree}
                      expandedIds={effectiveExpandedIds}
                      onExpandedChange={setExpandedIds}
                      selectedId={selectedFile}
                      onSelectedChange={handleSelectedChange}
                      showSearch={enableFileSearch}
                      searchKeyword={fileSearchKeyword}
                      onSearchKeywordChange={setFileSearchKeyword}
                      searchPlaceholder={t('agent.preview_pane.search_placeholder')}
                      emptyState={
                        <div className="px-2 py-3 text-muted-foreground text-xs">
                          {error
                            ? t('common.error')
                            : trimmedFileSearch
                              ? t('agent.preview_pane.no_search_results')
                              : workspacePath
                                ? t('agent.preview_pane.empty.title')
                                : t('agent.preview_pane.empty.description')}
                        </div>
                      }
                    />
                  )}
                </div>
              </aside>
              <div
                data-artifact-file-tree-resize-handle
                onMouseDown={startFileTreeResizing}
                {...getVerticalSplitterProps({
                  width: fileTreeWidth,
                  min: fileTreeMinWidth,
                  max: fileTreeMaxWidth,
                  label: t('common.resize_panel'),
                  onResize: setFileTreeWidth
                })}
                className="group/artifact-file-tree-resize-handle absolute top-0 right-0 bottom-0 z-10 w-2 cursor-col-resize focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
                <div className="absolute top-0 right-0 h-full w-0.5 bg-primary/20 opacity-0 transition-opacity group-hover/artifact-file-tree-resize-handle:opacity-100 group-data-[resizing=true]/artifact-file-tree:bg-primary/35 group-data-[resizing=true]/artifact-file-tree:opacity-100" />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
        <section className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="flex h-(--navbar-height) shrink-0 items-center justify-between gap-1 border-border-subtle px-2">
            <div className="flex items-center gap-1">
              <Tooltip content={t('agent.preview_pane.file_tree')} delay={800}>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className={headerToggleClass(treeOpen)}
                  aria-label={t('agent.preview_pane.file_tree')}
                  aria-pressed={treeOpen}
                  onClick={() => setTreeOpen(!treeOpen)}>
                  <FileTreeIcon size={16} />
                </Button>
              </Tooltip>
            </div>

            <div className="flex items-center gap-1">
              <Tooltip content={t('agent.preview_pane.refresh')} delay={800}>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="text-muted-foreground hover:bg-accent hover:text-foreground"
                  aria-label={t('agent.preview_pane.refresh')}
                  onClick={handleRefresh}>
                  <RotateCw size={16} />
                </Button>
              </Tooltip>
              {workspacePath && <OpenExternalAppButton workdir={workspacePath} filePath={openableFilePath} />}
              {onToggleMaximized && (
                <Tooltip content={maximizeLabel} delay={800}>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="text-muted-foreground hover:bg-accent hover:text-foreground"
                    aria-label={maximizeLabel}
                    aria-pressed={maximized}
                    onClick={onToggleMaximized}>
                    <MaximizeIcon size={16} />
                  </Button>
                </Tooltip>
              )}
            </div>
          </div>
          <div
            data-artifact-right-pane
            className={cn(
              'min-h-0 min-w-0 flex-1',
              isSelectedHtmlPreview || isSelectedPdfPreview ? 'overflow-hidden' : 'overflow-auto',
              isFileTreeResizing && 'pointer-events-none'
            )}>
            {renderRight()}
          </div>
        </section>
      </div>
    </div>
  )
}

export default ArtifactPane
