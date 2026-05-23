import { Button, Tooltip } from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import { usePersistCache } from '@data/hooks/useCache'
import { loggerService } from '@logger'
import { EmptyState, LoadingState } from '@renderer/components/chat'
import CodeViewer from '@renderer/components/CodeViewer'
import { FileTree, type FileTreeNode } from '@renderer/components/FileTree'
import RichEditor from '@renderer/components/RichEditor'
import type { FilePath } from '@shared/file/types'
import { toFileUrl } from '@shared/file/urlUtil'
import {
  AlertCircle,
  CodeXml,
  Eye,
  FileText,
  Folder,
  FolderOpen,
  Maximize2,
  Minimize2,
  RotateCw,
  Sparkles
} from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { memo, type MouseEvent as ReactMouseEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { CHAT_SHELL_TRANSITION } from '../shell/types'
import OpenExternalAppButton from './OpenExternalAppButton'

const logger = loggerService.withContext('ArtifactPane')

export const ARTIFACT_PANE_WIDTH = 460
export const ARTIFACT_FILE_TREE_DEFAULT_WIDTH = 160
export const ARTIFACT_FILE_TREE_CACHE_KEY = 'ui.chat.artifact_pane.file_tree.width'
const ARTIFACT_FILE_TREE_MIN_WIDTH = 80
const ARTIFACT_FILE_TREE_MAX_WIDTH_OFFSET = 140

export interface ArtifactPaneProps {
  workspacePath?: string
  maximized?: boolean
  pdfLayoutPending?: boolean
  pdfLayoutRefreshKey?: number
  selectedFile?: string | null
  viewMode?: ArtifactPaneViewMode
  onSelectedFileChange?: (file: string | null) => void
  onViewModeChange?: (mode: ArtifactPaneViewMode) => void
  onToggleMaximized?: () => void
}

export type ArtifactPaneViewMode = 'preview' | 'code'

const MARKDOWN_EXT = new Set(['.md', '.mdx', '.markdown'])
const HTML_EXT = new Set(['.html', '.htm'])
const PDF_EXT = new Set(['.pdf'])

const LANG_MAP: Record<string, string> = {
  ts: 'typescript',
  tsx: 'tsx',
  js: 'javascript',
  jsx: 'jsx',
  json: 'json',
  py: 'python',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  yml: 'yaml',
  yaml: 'yaml',
  toml: 'toml',
  css: 'css',
  scss: 'scss',
  html: 'html',
  htm: 'html',
  xml: 'xml',
  sql: 'sql',
  rs: 'rust',
  go: 'go',
  rb: 'ruby',
  md: 'markdown',
  mdx: 'markdown',
  markdown: 'markdown',
  txt: 'text'
}

const extOf = (name: string): string => {
  const dot = name.lastIndexOf('.')
  return dot < 0 ? '' : name.slice(dot).toLowerCase()
}

const isMarkdownFile = (name: string) => MARKDOWN_EXT.has(extOf(name))
const isHtmlFile = (name: string) => HTML_EXT.has(extOf(name))
const isPdfFile = (name: string) => PDF_EXT.has(extOf(name))
const isSourceViewAvailable = (name: string) => {
  const ext = extOf(name).slice(1)
  return Boolean(ext && LANG_MAP[ext])
}
const guessLanguage = (name: string) => LANG_MAP[extOf(name).slice(1)] ?? 'text'

const joinPath = (base: string, rel: string): string => {
  const trimmed = rel.replace(/^[/\\]+/, '')
  if (!base) return trimmed
  return /[/\\]$/.test(base) ? `${base}${trimmed}` : `${base}/${trimmed}`
}

const WORKSPACE_ROOT_ID = '__workspace_root__'

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

const normalizeWorkspaceRelativePath = (workspacePath: string, rawPath: string): string | null => {
  const workspace = normalizeTreePath(workspacePath)
  const normalized = normalizeTreePath(rawPath)
  if (!normalized) return null

  if (normalized === workspace) return null
  if (workspace === '/' && normalized.startsWith('/')) return normalized.slice(1)
  if (normalized.startsWith(`${workspace}/`)) return normalized.slice(workspace.length + 1)
  if (isAbsoluteTreePath(normalized)) return null

  return normalized.replace(/^\/+/, '')
}

/**
 * Turn the flat `listDirectory` output (paths separated by `/`) into the nested
 * `FileTreeNode[]` shape that `@renderer/components/FileTree` consumes. Folders
 * are placed before files at each level and entries are alphabetised.
 */
function buildFileTreeNodes(workspacePath: string | undefined, paths: readonly string[]): FileTreeNode[] {
  if (!workspacePath) return []

  const root: FileTreeNode = {
    id: WORKSPACE_ROOT_ID,
    name: getPathBasename(workspacePath),
    kind: 'folder',
    path: WORKSPACE_ROOT_ID,
    children: []
  }

  const folderMap = new Map<string, FileTreeNode>()

  const getOrCreateFolder = (relPath: string, name: string): FileTreeNode => {
    const existing = folderMap.get(relPath)
    if (existing) return existing
    const node: FileTreeNode = {
      id: relPath,
      name,
      kind: 'folder',
      path: joinPath(WORKSPACE_ROOT_ID, relPath),
      children: []
    }
    folderMap.set(relPath, node)
    return node
  }

  const attach = (parentChildren: FileTreeNode[], child: FileTreeNode) => {
    if (!parentChildren.some((n) => n.id === child.id)) parentChildren.push(child)
  }

  const relativePaths = Array.from(
    new Set(
      paths.map((raw) =>
        normalizeWorkspaceRelativePath(workspacePath, raw)
          ?.split(/[/\\]+/)
          .filter(Boolean)
          .join('/')
      )
    )
  ).filter((path): path is string => Boolean(path))
  const directoryPaths = new Set<string>()

  for (const relPath of relativePaths) {
    const segments = relPath.split('/')
    for (let i = 1; i < segments.length; i += 1) {
      directoryPaths.add(segments.slice(0, i).join('/'))
    }
  }

  for (const relPath of relativePaths) {
    const segments = relPath.split('/')
    if (segments.length === 0) continue

    let parentChildren = root.children!
    for (let i = 0; i < segments.length; i += 1) {
      const name = segments[i]
      const isLast = i === segments.length - 1
      const currentRelPath = segments.slice(0, i + 1).join('/')

      if (!isLast || directoryPaths.has(currentRelPath)) {
        const folder = getOrCreateFolder(currentRelPath, name)
        attach(parentChildren, folder)
        parentChildren = folder.children!
      } else {
        attach(parentChildren, {
          id: currentRelPath,
          name,
          kind: 'file',
          path: joinPath(WORKSPACE_ROOT_ID, currentRelPath)
        })
      }
    }
  }

  const sortRecursive = (nodes: FileTreeNode[]) => {
    nodes.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1
      return a.name.localeCompare(b.name)
    })
    for (const node of nodes) {
      if (node.children?.length) sortRecursive(node.children)
    }
  }
  sortRecursive(root.children!)

  return [root]
}

interface WorkspaceFileTreeResult {
  tree: FileTreeNode[]
  isLoading: boolean
  hasLoaded: boolean
  error?: Error
  refresh: () => void
}

interface HtmlPreviewPanelProps {
  html: string
  title: string
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
  const resizeCleanupRef = useRef<(() => void) | null>(null)
  const isResizingRef = useRef(false)
  const [isResizing, setIsResizing] = useState(false)
  const [artifactPaneWidth, setArtifactPaneWidth] = useState(ARTIFACT_PANE_WIDTH)
  const paneWidth = clampArtifactFileTreeWidth(storedWidth ?? ARTIFACT_FILE_TREE_DEFAULT_WIDTH, artifactPaneWidth)

  const measureArtifactPaneWidth = useCallback(() => {
    const width = artifactPaneRef.current?.getBoundingClientRect().width
    return width && Number.isFinite(width) ? width : ARTIFACT_PANE_WIDTH
  }, [])

  useEffect(() => {
    return () => resizeCleanupRef.current?.()
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

  const startResizing = useCallback(
    (event: ReactMouseEvent) => {
      event.preventDefault()

      isResizingRef.current = true
      setIsResizing(true)

      const previousCursor = document.body.style.cursor
      const previousUserSelect = document.body.style.userSelect
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'

      const currentArtifactPaneWidth = measureArtifactPaneWidth()
      setArtifactPaneWidth(currentArtifactPaneWidth)
      const paneLeft = paneRef.current?.getBoundingClientRect().left ?? event.clientX - paneWidth

      const cleanup = () => {
        isResizingRef.current = false
        setIsResizing(false)
        document.body.style.cursor = previousCursor
        document.body.style.userSelect = previousUserSelect
        document.removeEventListener('mousemove', onMouseMove)
        document.removeEventListener('mouseup', onMouseUp)
        resizeCleanupRef.current = null
      }

      const onMouseMove = (moveEvent: MouseEvent) => {
        if (!isResizingRef.current) return
        setStoredWidth(clampArtifactFileTreeWidth(moveEvent.clientX - paneLeft, currentArtifactPaneWidth))
      }

      const onMouseUp = () => cleanup()

      document.addEventListener('mousemove', onMouseMove)
      document.addEventListener('mouseup', onMouseUp)
      resizeCleanupRef.current = cleanup
    },
    [measureArtifactPaneWidth, paneWidth, setStoredWidth]
  )

  return {
    artifactPaneRef,
    isResizing,
    paneRef,
    paneWidth,
    startResizing
  }
}

// HtmlArtifactsPopup uses this sandbox combination for local artifact previews.
/* eslint-disable @eslint-react/dom/no-unsafe-iframe-sandbox */
const HtmlPreviewPanel = memo<HtmlPreviewPanelProps>(({ html, title }) => {
  return (
    <div className="h-full w-full overflow-hidden bg-background">
      {html.trim() ? (
        <iframe
          srcDoc={html}
          title={title}
          sandbox="allow-scripts allow-same-origin allow-forms"
          className="h-full w-full border-0 bg-background"
        />
      ) : null}
    </div>
  )
})
/* eslint-enable @eslint-react/dom/no-unsafe-iframe-sandbox */

const useWorkspaceFileTree = (path: string | undefined): WorkspaceFileTreeResult => {
  const [paths, setPaths] = useState<string[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [hasLoaded, setHasLoaded] = useState(false)
  const [error, setError] = useState<Error | undefined>(undefined)
  const [refreshToken, setRefreshToken] = useState(0)

  useEffect(() => {
    if (!path) {
      setPaths([])
      setIsLoading(false)
      setHasLoaded(false)
      setError(undefined)
      return
    }

    let cancelled = false
    setIsLoading(true)
    setHasLoaded(false)
    setError(undefined)

    window.api.file
      .listDirectory(path, {
        recursive: true,
        includeHidden: false,
        includeFiles: true,
        includeDirectories: true
      })
      .then((result) => {
        if (cancelled) return
        setPaths(result)
        setIsLoading(false)
        setHasLoaded(true)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        const normalized = err instanceof Error ? err : new Error(String(err))
        logger.error(`Failed to list directory: ${path}`, normalized)
        setError(normalized)
        setPaths([])
        setIsLoading(false)
        setHasLoaded(true)
      })

    return () => {
      cancelled = true
    }
  }, [path, refreshToken])

  const tree = useMemo(() => buildFileTreeNodes(path, paths), [path, paths])
  const refresh = useCallback(() => setRefreshToken((v) => v + 1), [])

  return { tree, isLoading, hasLoaded, error, refresh }
}

const ArtifactPane = ({
  workspacePath,
  maximized = false,
  pdfLayoutPending = false,
  pdfLayoutRefreshKey = 0,
  selectedFile: selectedFileProp,
  viewMode: viewModeProp,
  onSelectedFileChange,
  onViewModeChange,
  onToggleMaximized
}: ArtifactPaneProps) => {
  const { t } = useTranslation()
  const { tree, isLoading, hasLoaded, error, refresh } = useWorkspaceFileTree(workspacePath)
  const {
    artifactPaneRef,
    isResizing: isFileTreeResizing,
    paneRef: fileTreePaneRef,
    paneWidth: fileTreeWidth,
    startResizing: startFileTreeResizing
  } = useArtifactFileTreeResize()

  const [treeOpen, setTreeOpen] = useState(false)
  const [internalViewMode, setInternalViewMode] = useState<ArtifactPaneViewMode>('preview')
  const [internalSelectedFile, setInternalSelectedFile] = useState<string | null>(null)
  const [expandedIds, setExpandedIds] = useState<ReadonlySet<string>>(() => new Set())
  const [fileContent, setFileContent] = useState<string | null>(null)
  const [loadingContent, setLoadingContent] = useState(false)
  const [contentRefreshToken, setContentRefreshToken] = useState(0)
  const previousWorkspacePathRef = useRef(workspacePath)
  const selectedFileControlled = selectedFileProp !== undefined
  const selectedFile = selectedFileControlled ? selectedFileProp : internalSelectedFile
  const viewModeControlled = viewModeProp !== undefined
  const viewMode = viewModeControlled ? viewModeProp : internalViewMode
  const setSelectedFile = useCallback(
    (file: string | null) => {
      if (!selectedFileControlled) setInternalSelectedFile(file)
      onSelectedFileChange?.(file)
    },
    [onSelectedFileChange, selectedFileControlled]
  )
  const setViewMode = useCallback(
    (mode: ArtifactPaneViewMode) => {
      if (!viewModeControlled) setInternalViewMode(mode)
      onViewModeChange?.(mode)
    },
    [onViewModeChange, viewModeControlled]
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

  // Reset transient state when the workspace changes.
  useEffect(() => {
    if (previousWorkspacePathRef.current !== workspacePath) {
      setSelectedFile(null)
      setViewMode('preview')
    }
    previousWorkspacePathRef.current = workspacePath
    setExpandedIds(workspacePath ? new Set([WORKSPACE_ROOT_ID]) : new Set())
    setFileContent(null)
    setLoadingContent(false)
    setContentRefreshToken(0)
  }, [setSelectedFile, setViewMode, workspacePath])

  useEffect(() => {
    if (!selectedFile || !hasLoaded) return

    const selectedNode = nodeById.get(selectedFile)
    if (selectedNode?.kind === 'file') return

    setSelectedFile(null)
    setFileContent(null)
    setLoadingContent(false)
  }, [hasLoaded, nodeById, selectedFile, setSelectedFile])

  // Load the selected text file. PDFs are rendered directly from a file:// URL.
  useEffect(() => {
    if (!selectedFile || !workspacePath) {
      setFileContent(null)
      setLoadingContent(false)
      return
    }

    if (!isSourceViewAvailable(selectedFile)) {
      setFileContent(null)
      setLoadingContent(false)
      return
    }

    const absPath = joinPath(workspacePath, selectedFile)
    let cancelled = false
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
      } finally {
        if (!cancelled) setLoadingContent(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [contentRefreshToken, selectedFile, workspacePath])

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

  const handleRefresh = useCallback(() => {
    refresh()
    if (workspacePath && selectedFile && isSourceViewAvailable(selectedFile)) setContentRefreshToken((v) => v + 1)
  }, [refresh, selectedFile, workspacePath])

  const handleViewModeToggle = useCallback(() => {
    if (!selectedFile || isSourceViewAvailable(selectedFile)) {
      setViewMode(viewMode === 'preview' ? 'code' : 'preview')
    }
  }, [selectedFile, setViewMode, viewMode])

  const sourceViewAvailable = selectedFile ? isSourceViewAvailable(selectedFile) : true

  useEffect(() => {
    if (selectedFile && !sourceViewAvailable && viewMode === 'code') {
      setViewMode('preview')
    }
  }, [selectedFile, setViewMode, sourceViewAvailable, viewMode])

  const isSelectedHtmlPreview = viewMode === 'preview' && selectedFile ? isHtmlFile(selectedFile) : false
  const viewModeLabel = t(viewMode === 'preview' ? 'agent.preview_pane.preview' : 'agent.preview_pane.code')
  const maximizeLabel = t(maximized ? 'agent.preview_pane.minimize' : 'agent.preview_pane.maximize')
  const FileTreeIcon = treeOpen ? FolderOpen : Folder
  const ViewModeIcon = viewMode === 'preview' ? Eye : CodeXml
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
    if (!selectedFile) {
      return <EmptyState icon={FileText} title={t('agent.preview_pane.select_file')} />
    }
    if (loadingContent) {
      return <LoadingState variant="skeleton" rows={4} />
    }

    const name = selectedFile

    if (viewMode === 'code') {
      if (!isSourceViewAvailable(name)) {
        return (
          <EmptyState
            icon={FileText}
            title={t('agent.preview_pane.preview')}
            description={t('agent.preview_pane.code_unavailable')}
          />
        )
      }
      return (
        <CodeViewer
          key={`code-${name}-${contentRefreshToken}`}
          value={fileContent ?? ''}
          language={guessLanguage(name)}
          wrapped={false}
        />
      )
    }

    if (isPdfFile(name)) {
      if (pdfLayoutPending) {
        return (
          <div className="flex h-full w-full items-center justify-center">
            <LoadingState label={t('common.loading')} />
          </div>
        )
      }

      const pdfUrl = `${toFileUrl(joinPath(workspacePath, name) as FilePath)}#toolbar=0`
      return (
        // Chromium's PDF viewer needs an unsandboxed iframe for local file rendering.
        // eslint-disable-next-line @eslint-react/dom/no-missing-iframe-sandbox
        <iframe
          key={`pdf-${name}-${contentRefreshToken}-${pdfLayoutRefreshKey}`}
          src={pdfUrl}
          title={name}
          className="h-full w-full border-0"
        />
      )
    }
    if (isHtmlFile(name)) {
      return <HtmlPreviewPanel key={`html-${name}-${contentRefreshToken}`} html={fileContent ?? ''} title={name} />
    }
    if (!isSourceViewAvailable(name)) {
      return (
        <EmptyState
          icon={FileText}
          title={t('agent.preview_pane.preview')}
          description={t('agent.preview_pane.code_unavailable')}
        />
      )
    }
    if (isMarkdownFile(name)) {
      return (
        <div className="min-w-0 px-5 py-4">
          <RichEditor
            key={`md-${name}-${contentRefreshToken}`}
            initialContent={fileContent ?? ''}
            isMarkdown
            editable={false}
            showToolbar={false}
            isFullWidth
          />
        </div>
      )
    }
    return (
      <CodeViewer
        key={`preview-${name}-${contentRefreshToken}`}
        value={fileContent ?? ''}
        language={guessLanguage(name)}
        wrapped={false}
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
                      nodes={tree}
                      expandedIds={expandedIds}
                      onExpandedChange={setExpandedIds}
                      selectedId={selectedFile}
                      onSelectedChange={handleSelectedChange}
                      emptyState={
                        <div className="px-2 py-3 text-muted-foreground text-xs">
                          {error
                            ? t('common.error')
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
                className="group/artifact-file-tree-resize-handle absolute top-0 right-0 bottom-0 z-10 w-2 cursor-col-resize">
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
                  onClick={() => setTreeOpen((v) => !v)}>
                  <FileTreeIcon size={16} />
                </Button>
              </Tooltip>
              <Tooltip content={viewModeLabel} delay={800}>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="text-muted-foreground hover:bg-accent hover:text-foreground"
                  aria-label={viewModeLabel}
                  disabled={!sourceViewAvailable}
                  onClick={handleViewModeToggle}>
                  <ViewModeIcon size={16} />
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
              {workspacePath && <OpenExternalAppButton workdir={workspacePath} />}
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
              isSelectedHtmlPreview ? 'overflow-hidden' : 'overflow-auto',
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
