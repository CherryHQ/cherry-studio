import { Button, CodeEditor, ConfirmDialog, Markdown, Tooltip } from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import { loggerService } from '@logger'
import ImagePreviewPanel from '@renderer/components/ArtifactPreview/image/ImagePreviewPanel'
import type { OfficePreviewPanelProps } from '@renderer/components/ArtifactPreview/office/OfficePreviewPanel'
import { EmptyState, LoadingState } from '@renderer/components/chat/primitives'
import HtmlPreviewFrame from '@renderer/components/CodeBlockView/HtmlPreviewFrame'
import CodeViewer from '@renderer/components/CodeViewer'
import type { CommandContextMenuExtraItem } from '@renderer/components/command'
import { FileTree, type FileTreeNode } from '@renderer/components/FileTree'
import { getEditorIcon } from '@renderer/components/icons/EditorIcon'
import { FinderIcon } from '@renderer/components/icons/SvgIcon'
import { useCodeStyle } from '@renderer/hooks/useCodeStyle'
import { useExternalApps } from '@renderer/hooks/useExternalApps'
import {
  FILE_EDIT_MAX_SIZE_BYTES as ARTIFACT_PREVIEW_MAX_SIZE_BYTES,
  type FileEditSession
} from '@renderer/hooks/useFileEditSession'
import { type FileSizeState, useFileSize } from '@renderer/hooks/useFileSize'
import { type IsTextState, useIsTextFile } from '@renderer/hooks/useIsTextFile'
import { toast } from '@renderer/services/toast'
import { getLanguageByFilePath } from '@renderer/utils/codeLanguage'
import { buildEditorUrl } from '@renderer/utils/editor'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import { joinPath } from '@renderer/utils/path'
import { isMac, isWin } from '@renderer/utils/platform'
import type { FilePath } from '@shared/types/file'
import { toFileUrl } from '@shared/utils/file'
import { AlertCircle, ArrowLeft, Eye, FileText, FolderOpen, RotateCw, Sparkles, SquarePen, X } from 'lucide-react'
import {
  type ComponentType,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import { useTranslation } from 'react-i18next'

import { type ArtifactPaneFileSelection, WORKSPACE_ROOT_ID } from './artifactPanePath'
import OpenExternalAppButton from './OpenExternalAppButton'
import { type ArtifactFileTreeModel, isSelectableFileNode, useArtifactFileTreeModel } from './useArtifactFileTreeModel'

// Re-exported from their home modules so existing imports of these from
// `ArtifactPane` keep working.
export type { ArtifactPaneFileSelection } from './artifactPanePath'
export {
  getArtifactPaneSelectionPath,
  normalizeArtifactPaneFilePath,
  resolveArtifactPaneFileSelection
} from './artifactPanePath'

const logger = loggerService.withContext('ArtifactPane')

export interface ArtifactPaneProps {
  workspacePath?: string
  maximized?: boolean
  previewFileSelection?: ArtifactPaneFileSelection | null
  onPreviewClose?: () => void
  pdfLayoutPending?: boolean
  pdfLayoutRefreshKey?: number
  selectedFile?: string | null
  onSelectedFileChange?: (file: string | null) => void
  /** Caller-owned expanded folder ids. The synthetic workspace root is managed internally. */
  fileTreeExpandedIds?: ReadonlySet<string>
  onFileTreeExpandedIdsChange?: (next: ReadonlySet<string>) => void
  fileTreeSearchKeyword?: string
  onFileTreeSearchKeywordChange?: (keyword: string) => void
  /** Show a search input inside the file tree that filters nodes by name. */
  enableFileSearch?: boolean
}

interface ArtifactFilePreviewProps {
  workspacePath?: string
  filePath?: string | null
  isText: IsTextState
  fileSize: FileSizeState
  pdfLayoutPending?: boolean
  pdfLayoutRefreshKey?: number
  contentRefreshKey?: number
  contentOverride?: string
}

export { FILE_EDIT_MAX_SIZE_BYTES as ARTIFACT_PREVIEW_MAX_SIZE_BYTES } from '@renderer/hooks/useFileEditSession'

/** Files above this size skip text preview (and `readText`) — Shiki tokenize gets unusable past ~2MB. */
const ARTIFACT_PREVIEW_MAX_SIZE_LABEL = '2 MB'

// Extensions below drive special-case rendering (Markdown / iframe / PdfPreviewPanel),
// not text-vs-binary classification. Text detection lives in `useIsTextFile`.
const MARKDOWN_EXT = new Set(['.md', '.mdx', '.markdown'])
const HTML_EXT = new Set(['.html', '.htm'])
const PDF_EXT = new Set(['.pdf'])
const OFFICE_DOCUMENT_EXT = new Set(['.doc', '.docx', '.xls', '.xlsx', '.xlsm', '.ppt', '.pptx'])
// Binary but renderable via `<img>` from a `file://` URL — no text read needed.
const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.ico', '.avif', '.svg'])

const extOf = (name: string): string => {
  const dot = name.lastIndexOf('.')
  return dot < 0 ? '' : name.slice(dot).toLowerCase()
}

const isMarkdownFile = (name: string) => MARKDOWN_EXT.has(extOf(name))
const isHtmlFile = (name: string) => HTML_EXT.has(extOf(name))
const isPdfFile = (name: string) => PDF_EXT.has(extOf(name))
export const isOfficeDocumentFile = (name: string) => OFFICE_DOCUMENT_EXT.has(extOf(name))
export const isImageFile = (name: string) => IMAGE_EXT.has(extOf(name))

function getPreviewFileTitle(filePath: string): string {
  const segments = filePath
    .trim()
    .split(/[/\\]+/)
    .filter(Boolean)
  return segments.at(-1) ?? filePath
}

function getFileTreeNodeTargetPath(workspacePath: string | undefined, node: { id: string }): string | null {
  if (!workspacePath) return null
  return node.id === WORKSPACE_ROOT_ID ? workspacePath : joinPath(workspacePath, node.id)
}

function renderFileManagerIcon(): ReactNode {
  return isMac ? <FinderIcon className="size-4" /> : <FolderOpen size={16} />
}

type PdfPreviewPanelComponent = ComponentType<{
  filePath: string
  fileName: string
  refreshKey: number
}>
type OfficePreviewPanelComponent = ComponentType<OfficePreviewPanelProps>

let pdfPreviewPanelPromise: Promise<PdfPreviewPanelComponent> | null = null
let officePreviewPanelPromise: Promise<OfficePreviewPanelComponent> | null = null

const loadPdfPreviewPanel = () => {
  pdfPreviewPanelPromise ??= import('@renderer/components/ArtifactPreview/pdf/PdfPreviewPanel')
    .then((module) => module.default)
    .catch((err: unknown) => {
      pdfPreviewPanelPromise = null
      throw err
    })
  return pdfPreviewPanelPromise
}

const loadOfficePreviewPanel = () => {
  officePreviewPanelPromise ??= import('@renderer/components/ArtifactPreview/office/OfficePreviewPanel')
    .then((module) => module.default)
    .catch((err: unknown) => {
      officePreviewPanelPromise = null
      throw err
    })
  return officePreviewPanelPromise
}

export function ArtifactFilePreview({
  workspacePath,
  filePath,
  isText,
  fileSize,
  pdfLayoutPending = false,
  pdfLayoutRefreshKey = 0,
  contentRefreshKey = 0,
  contentOverride
}: ArtifactFilePreviewProps) {
  const { t } = useTranslation()
  const [fileContent, setFileContent] = useState<string | null>(null)
  const [PdfPreviewPanel, setPdfPreviewPanel] = useState<PdfPreviewPanelComponent | null>(null)
  const [pdfPreviewLoadError, setPdfPreviewLoadError] = useState<Error | null>(null)
  const [OfficePreviewPanel, setOfficePreviewPanel] = useState<OfficePreviewPanelComponent | null>(null)
  const [officePreviewLoadError, setOfficePreviewLoadError] = useState<Error | null>(null)
  const [readError, setReadError] = useState<Error | null>(null)
  const [loadingContent, setLoadingContent] = useState(false)
  const isPdfPreview = filePath ? isPdfFile(filePath) : false
  const isOfficeDocumentPreview = filePath ? isOfficeDocumentFile(filePath) : false
  const isImagePreview = filePath ? isImageFile(filePath) : false
  // The draft re-renders this per keystroke, so decide the cap from `length`
  // alone where possible (UTF-8 is 1–3 bytes per UTF-16 code unit) and pay a
  // full encode only in the gray zone — never a per-keystroke Blob of the file.
  const contentOverrideOversized = useMemo(() => {
    if (contentOverride === undefined) return null
    if (contentOverride.length > ARTIFACT_PREVIEW_MAX_SIZE_BYTES) return true
    if (contentOverride.length * 3 <= ARTIFACT_PREVIEW_MAX_SIZE_BYTES) return false
    return new TextEncoder().encode(contentOverride).byteLength > ARTIFACT_PREVIEW_MAX_SIZE_BYTES
  }, [contentOverride])
  const oversizedForPreview =
    !isPdfPreview &&
    !isOfficeDocumentPreview &&
    !isImagePreview &&
    (contentOverrideOversized ?? (fileSize.status === 'ok' && fileSize.size > ARTIFACT_PREVIEW_MAX_SIZE_BYTES))

  useEffect(() => {
    if (contentOverride !== undefined) {
      setFileContent(null)
      setReadError(null)
      setLoadingContent(false)
      return
    }

    if (!filePath || !workspacePath) {
      setFileContent(null)
      setReadError(null)
      setLoadingContent(false)
      return
    }

    // Binary previewers render straight from disk or external apps; no readText needed.
    if (isPdfFile(filePath) || isOfficeDocumentFile(filePath) || isImageFile(filePath)) {
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
  }, [contentOverride, contentRefreshKey, filePath, workspacePath, isText, fileSize.status, oversizedForPreview])

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

  useEffect(() => {
    if (!isOfficeDocumentPreview) {
      setOfficePreviewLoadError(null)
      return
    }
    if (OfficePreviewPanel) return

    let cancelled = false
    setOfficePreviewLoadError(null)

    loadOfficePreviewPanel()
      .then((component) => {
        if (!cancelled) setOfficePreviewPanel(() => component)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        const normalized = err instanceof Error ? err : new Error(String(err))
        logger.error('Failed to load Office preview panel', normalized)
        setOfficePreviewLoadError(normalized)
      })

    return () => {
      cancelled = true
    }
  }, [OfficePreviewPanel, isOfficeDocumentPreview])

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

  // Image: binary but renderable via `<img>`; bypass isText / size gating.
  if (isImageFile(filePath)) {
    return (
      <ImagePreviewPanel
        key={`image-${filePath}-${contentRefreshKey}`}
        src={toFileUrl(joinPath(workspacePath, filePath) as FilePath)}
        fileName={filePath}
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
    if (officePreviewLoadError) {
      return <EmptyState icon={AlertCircle} title={t('common.error')} description={officePreviewLoadError.message} />
    }
    if (!OfficePreviewPanel) {
      return (
        <div className="flex h-full w-full items-center justify-center">
          <LoadingState label={t('common.loading')} />
        </div>
      )
    }
    return (
      <OfficePreviewPanel
        filePath={filePath}
        fileName={filePath}
        sourceFilePath={joinPath(workspacePath, filePath)}
        sourceSize={fileSize.status === 'ok' ? fileSize.size : undefined}
        className="min-h-0"
        refreshKey={contentRefreshKey}
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

  if (loadingContent && contentOverride === undefined) {
    return <LoadingState variant="skeleton" rows={4} />
  }

  if (readError && contentOverride === undefined) {
    return (
      <EmptyState
        icon={AlertCircle}
        title={t('agent.preview_pane.unavailable.title')}
        description={t('agent.preview_pane.unavailable.description')}
      />
    )
  }

  const effectiveContent = contentOverride ?? fileContent ?? ''

  if (isHtmlFile(filePath)) {
    return (
      <HtmlPreviewFrame
        key={`html-${filePath}-${contentRefreshKey}`}
        html={effectiveContent}
        title={filePath}
        baseUrl={toFileUrl(joinPath(workspacePath, filePath) as FilePath)}
      />
    )
  }
  if (isMarkdownFile(filePath)) {
    return (
      <div className="min-w-0 px-5 py-4">
        <Markdown id={`md-${filePath}-${contentRefreshKey}`}>{effectiveContent}</Markdown>
      </div>
    )
  }
  return (
    <CodeViewer
      key={`preview-${filePath}-${contentRefreshKey}`}
      value={effectiveContent}
      language={getLanguageByFilePath(filePath)}
      wrapped={false}
    />
  )
}

interface ArtifactPaneViewBaseProps {
  workspacePath?: string
  maximized?: boolean
  previewFileSelection?: ArtifactPaneFileSelection | null
  onPreviewClose?: () => void
  pdfLayoutPending?: boolean
  pdfLayoutRefreshKey?: number
  enableFileSearch?: boolean
  /** Directory-tree model owned by the surrounding artifact capability. */
  model: ArtifactFileTreeModel
  selectedFile: string | null
  onSelectedFileChange: (file: string | null) => void
  searchKeyword: string
  onSearchKeywordChange: (keyword: string) => void
  /** The unified file-edit session for the file being edited (loaded only in edit mode). */
  fileSession?: FileEditSession
  editMode?: 'preview' | 'edit'
  onEditModeChange?: (mode: 'preview' | 'edit') => void
}

type ArtifactPaneViewProps = ArtifactPaneViewBaseProps &
  (
    | {
        headerVariant?: 'overlay'
        paneTitle?: never
        paneActions?: never
      }
    | {
        headerVariant: 'pane'
        paneTitle: ReactNode
        paneActions: ReactNode
      }
  )

/**
 * Presentational artifact pane: renders file tree and selected-file overlay
 * preview from the supplied model.
 */
export function ArtifactPaneView(props: ArtifactPaneViewProps) {
  const {
    workspacePath,
    maximized = false,
    previewFileSelection = null,
    onPreviewClose,
    pdfLayoutPending = false,
    pdfLayoutRefreshKey = 0,
    enableFileSearch = false,
    model,
    selectedFile,
    onSelectedFileChange,
    searchKeyword,
    onSearchKeywordChange,
    fileSession,
    editMode = 'preview',
    onEditModeChange
  } = props
  const { t } = useTranslation()
  const { activeCmTheme } = useCodeStyle()
  const { data: externalApps } = useExternalApps({ enabled: true })
  const artifactPaneRef = useRef<HTMLDivElement>(null)
  const overlayRef = useRef<HTMLDivElement>(null)
  const [contentRefreshToken, setContentRefreshToken] = useState(0)
  const [staleConflictOpen, setStaleConflictOpen] = useState(false)
  // Destructure the stable callbacks so effect/callback deps don't have to
  // list the whole `model` (a fresh object every render).
  const { refresh, reloadExpandedDirectories } = model

  const trimmedFileSearch = enableFileSearch ? searchKeyword.trim() : ''
  const overlaySelection = useMemo(
    () =>
      previewFileSelection
        ? previewFileSelection
        : workspacePath && selectedFile
          ? { workspacePath, filePath: selectedFile }
          : null,
    [previewFileSelection, selectedFile, workspacePath]
  )
  const overlayWorkspacePath = overlaySelection?.workspacePath
  const overlayFilePath = overlaySelection?.filePath
  const previewWorkspacePath = overlayWorkspacePath ?? workspacePath
  const previewFilePath = overlayFilePath ?? selectedFile
  const previewKey = `${previewWorkspacePath ?? ''}\0${previewFilePath ?? ''}`
  const previousPreviewKeyRef = useRef(previewKey)
  const availableEditors = useMemo(
    () => externalApps?.filter((app) => app.tags.includes('code-editor')) ?? [],
    [externalApps]
  )
  const fileManagerName = useMemo(() => {
    if (isMac) return t('agent.session.file_manager.finder')
    if (isWin) return t('agent.session.file_manager.file_explorer')
    return t('agent.session.file_manager.files')
  }, [t])

  const handleSelectedChange = useCallback(
    (id: string | null) => {
      if (!id) {
        onSelectedFileChange(null)
        return
      }
      if (isSelectableFileNode(model.nodeById, id)) onSelectedFileChange(id)
    },
    [model.nodeById, onSelectedFileChange]
  )

  const isPdfSelection = previewFilePath ? isPdfFile(previewFilePath) : false
  const isOfficeDocumentSelection = previewFilePath ? isOfficeDocumentFile(previewFilePath) : false
  const isImageSelection = previewFilePath ? isImageFile(previewFilePath) : false
  const shouldSniffSelectedFile = !isPdfSelection && !isOfficeDocumentSelection && !isImageSelection
  const sniffedIsText = useIsTextFile(previewWorkspacePath, previewFilePath, { enabled: shouldSniffSelectedFile })
  const isText = shouldSniffSelectedFile ? sniffedIsText : 'binary'
  const fileSize = useFileSize(previewWorkspacePath, previewFilePath)
  const canEditSelection =
    Boolean(fileSession && overlaySelection) &&
    isText === 'text' &&
    fileSize.status === 'ok' &&
    fileSize.size <= ARTIFACT_PREVIEW_MAX_SIZE_BYTES
  const isEditDirty = fileSession?.isDirty ?? false

  useEffect(() => {
    if (previousPreviewKeyRef.current === previewKey) return
    previousPreviewKeyRef.current = previewKey
    setContentRefreshToken(0)
    setStaleConflictOpen(false)
  }, [previewKey])

  // Surface an external-change conflict (a stale autosave) as the reload dialog.
  useEffect(() => {
    if (fileSession?.conflict) setStaleConflictOpen(true)
  }, [fileSession?.conflict])

  // A file that cannot be edited in place (binary / oversize) can't enter edit
  // mode — toast why and fall back to preview.
  useEffect(() => {
    if (editMode !== 'edit' || fileSession?.status !== 'unsupported') return
    toast.error(
      fileSession.unsupportedReason === 'size'
        ? t('agent.preview_pane.too_large.description', { limit: ARTIFACT_PREVIEW_MAX_SIZE_LABEL })
        : t('agent.preview_pane.edit.unsupported')
    )
    onEditModeChange?.('preview')
  }, [editMode, fileSession?.status, fileSession?.unsupportedReason, onEditModeChange, t])

  // Autosave I/O failure: the draft stays in the editor and automatic retries
  // pause until the user explicitly retries or discards it.
  useEffect(() => {
    if (fileSession?.saveError) toast.error(t('agent.preview_pane.edit.save_failed'))
  }, [fileSession?.saveError, t])

  useEffect(() => {
    if (!overlayWorkspacePath || !overlayFilePath) return
    overlayRef.current?.focus()
  }, [overlayFilePath, overlayWorkspacePath])

  // Depend on the session's stable `reload` callback, not the session object —
  // the object changes on every keystroke and would drag the whole toolbar /
  // file-tree memo chain below with it.
  const fileSessionReload = fileSession?.reload
  const fileSessionFlush = fileSession?.flush
  const fileSessionDiscard = fileSession?.discard
  const handleRefresh = useCallback(() => {
    refresh()
    reloadExpandedDirectories()
    if (
      overlayWorkspacePath &&
      overlayFilePath &&
      (isText === 'text' || isOfficeDocumentSelection || isImageSelection)
    ) {
      setContentRefreshToken((value) => value + 1)
    }
    if (editMode === 'edit' && fileSessionReload && !isEditDirty) {
      void fileSessionReload().catch((error: unknown) => {
        logger.error('Failed to refresh editable file snapshot', error as Error)
        toast.error(t('agent.preview_pane.edit.refresh_failed'))
      })
    }
  }, [
    editMode,
    fileSessionReload,
    isImageSelection,
    isEditDirty,
    isOfficeDocumentSelection,
    isText,
    overlayFilePath,
    overlayWorkspacePath,
    refresh,
    reloadExpandedDirectories,
    t
  ])

  const handleClosePreview = useCallback(() => {
    if (onPreviewClose) {
      onPreviewClose()
      return
    }
    onSelectedFileChange(null)
  }, [onPreviewClose, onSelectedFileChange])

  const handleOverlayKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      handleClosePreview()
    },
    [handleClosePreview]
  )

  const openPath = useCallback(
    async (path: string) => {
      try {
        await window.api.file.openPath(path)
      } catch (error) {
        toast.error(formatErrorMessageWithPrefix(error, t('files.error.open_path', { path })))
      }
    },
    [t]
  )

  const showInFolder = useCallback(
    async (path: string) => {
      try {
        await window.api.file.showInFolder(path)
      } catch (error) {
        toast.error(formatErrorMessageWithPrefix(error, t('files.error.open_path', { path })))
      }
    },
    [t]
  )

  const getFileTreeMenuItems = useCallback(
    (node: FileTreeNode): readonly CommandContextMenuExtraItem[] => {
      const targetPath = getFileTreeNodeTargetPath(workspacePath, node)
      if (!targetPath) return []

      if (node.kind === 'file') {
        return [
          {
            type: 'item',
            id: 'open-default-app',
            label: t('agent.preview_pane.default_app'),
            icon: <FileText size={16} />,
            onSelect: () => void openPath(targetPath)
          },
          {
            type: 'item',
            id: 'show-in-folder',
            label: fileManagerName,
            icon: renderFileManagerIcon(),
            onSelect: () => void showInFolder(targetPath)
          },
          ...availableEditors.map<CommandContextMenuExtraItem>((app) => ({
            type: 'item',
            id: `open-editor-${app.id}`,
            label: app.name,
            icon: getEditorIcon(app),
            onSelect: () => window.open(buildEditorUrl(app, targetPath))
          }))
        ]
      }

      return [
        {
          type: 'item',
          id: 'open-file-manager',
          label: fileManagerName,
          icon: renderFileManagerIcon(),
          onSelect: () => void openPath(targetPath)
        },
        ...availableEditors.map<CommandContextMenuExtraItem>((app) => ({
          type: 'item',
          id: `open-editor-${app.id}`,
          label: app.name,
          icon: getEditorIcon(app),
          onSelect: () => window.open(buildEditorUrl(app, targetPath))
        }))
      ]
    },
    [availableEditors, fileManagerName, openPath, showInFolder, t, workspacePath]
  )

  // Memoized so the file-tree element below keeps its identity across the
  // per-keystroke re-renders the draft causes — React then skips the subtree.
  const refreshButton = useMemo(
    () => (
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
    ),
    [handleRefresh, t]
  )

  const searchToolbar = useMemo(
    () =>
      props.headerVariant === 'pane' ? undefined : (
        <div className="flex shrink-0 items-center gap-1">
          {refreshButton}
          {workspacePath ? <OpenExternalAppButton workdir={workspacePath} /> : null}
        </div>
      ),
    [props.headerVariant, refreshButton, workspacePath]
  )

  const isSelectedHtmlPreview = previewFilePath ? isHtmlFile(previewFilePath) : false
  const isSelectedPdfPreview = isPdfSelection
  const isSelectedOfficePreview = isOfficeDocumentSelection
  const isSelectedImagePreview = isImageSelection

  const handleEditorModeChange = useCallback(
    (mode: 'preview' | 'edit') => {
      // Loading + unsupported handling is reactive via `fileSession.status`.
      onEditModeChange?.(mode)
    },
    [onEditModeChange]
  )

  const handleReloadAfterConflict = useCallback(async () => {
    if (!fileSession) return
    try {
      await fileSession.reload()
      setContentRefreshToken((value) => value + 1)
    } catch (error) {
      logger.error('Failed to reload artifact file after a write conflict', error as Error)
      toast.error(t('agent.preview_pane.edit.refresh_failed'))
    }
  }, [fileSession, t])

  const handleRetryFailedSave = useCallback(async () => {
    if (!fileSessionFlush) return
    try {
      await fileSessionFlush()
    } catch {
      // The session keeps the latest error and draft visible for another retry
      // or an explicit discard.
    }
  }, [fileSessionFlush])

  const handleDiscardFailedSave = useCallback(() => {
    fileSessionDiscard?.()
  }, [fileSessionDiscard])

  const editorLoading = fileSession?.status === 'loading'
  const nextEditorMode = editMode === 'preview' ? 'edit' : 'preview'
  const modeActionLabel = t(nextEditorMode === 'edit' ? 'common.edit' : 'common.preview')
  const ModeActionIcon = nextEditorMode === 'edit' ? SquarePen : Eye

  const paneHeader =
    props.headerVariant === 'pane' ? (
      <div
        data-testid="artifact-pane-header"
        className="flex h-(--navbar-height) shrink-0 items-center justify-between gap-2 border-border-subtle border-b px-2 [-webkit-app-region:no-drag]">
        <div className="flex min-w-0 flex-1 items-center gap-0.5">
          {overlaySelection ? (
            <Tooltip content={t('common.back')} delay={800}>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="shrink-0 text-muted-foreground hover:bg-accent hover:text-foreground"
                aria-label={t('common.back')}
                onClick={handleClosePreview}>
                <ArrowLeft size={16} />
              </Button>
            </Tooltip>
          ) : null}
          <div className="flex min-w-0 flex-1 items-center gap-1.5 px-1">
            <div
              data-testid="artifact-pane-header-title"
              className="min-w-0 flex-1 select-none truncate font-medium text-foreground text-sm"
              title={overlaySelection?.filePath}>
              {overlaySelection ? getPreviewFileTitle(overlaySelection.filePath) : props.paneTitle}
            </div>
            {overlaySelection && isEditDirty ? (
              <span
                className="size-1.5 shrink-0 rounded-full bg-warning"
                aria-label={t('agent.preview_pane.edit.unsaved')}
                title={t('agent.preview_pane.edit.unsaved')}
              />
            ) : null}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {canEditSelection ? (
            <>
              <Tooltip content={modeActionLabel} delay={800}>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="text-muted-foreground hover:bg-accent hover:text-foreground"
                  aria-label={modeActionLabel}
                  disabled={editorLoading}
                  onClick={() => handleEditorModeChange(nextEditorMode)}>
                  <ModeActionIcon size={14} />
                </Button>
              </Tooltip>
              <div className="mx-0.5 h-4 w-px bg-border-subtle" aria-hidden="true" />
            </>
          ) : null}
          {previewWorkspacePath ? (
            <>
              <OpenExternalAppButton workdir={previewWorkspacePath} filePath={overlaySelection?.filePath} />
              {refreshButton}
              <div className="mx-0.5 h-4 w-px bg-border-subtle" aria-hidden="true" />
            </>
          ) : null}
          {props.paneActions}
        </div>
      </div>
    ) : null

  const previewContent = overlaySelection ? (
    <ArtifactFilePreview
      workspacePath={overlaySelection.workspacePath}
      filePath={overlaySelection.filePath}
      isText={isText}
      fileSize={fileSize}
      pdfLayoutPending={pdfLayoutPending}
      pdfLayoutRefreshKey={pdfLayoutRefreshKey}
      contentRefreshKey={contentRefreshToken}
      contentOverride={editMode === 'edit' && fileSession?.status === 'ready' ? fileSession.draft : undefined}
    />
  ) : null

  const renderOverlay = () => {
    if (!overlaySelection) return null

    const overlayActions = (
      <>
        <OpenExternalAppButton workdir={overlaySelection.workspacePath} filePath={overlaySelection.filePath} />
        {refreshButton}
        <Tooltip content={t('agent.preview_pane.close')} delay={800}>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label={t('agent.preview_pane.close')}
            onClick={handleClosePreview}>
            <X size={16} />
          </Button>
        </Tooltip>
      </>
    )

    const contentClassName =
      isSelectedHtmlPreview || isSelectedPdfPreview || isSelectedOfficePreview || isSelectedImagePreview
        ? 'overflow-hidden'
        : 'overflow-auto'
    return (
      <div
        ref={overlayRef}
        data-testid="artifact-file-preview-overlay"
        tabIndex={-1}
        onKeyDown={handleOverlayKeyDown}
        className="absolute inset-0 z-20 flex min-h-0 flex-col overflow-hidden bg-card text-card-foreground">
        {props.headerVariant === 'pane' ? null : (
          <div className="flex h-10 shrink-0 items-center gap-2 border-border-subtle border-b pr-2 pl-3">
            <div className="flex min-w-0 flex-1 items-center gap-1.5 font-medium text-foreground text-sm">
              <span className="truncate">{getPreviewFileTitle(overlaySelection.filePath)}</span>
              {isEditDirty && (
                <span
                  className="size-1.5 shrink-0 rounded-full bg-warning"
                  aria-label={t('agent.preview_pane.edit.unsaved')}
                  title={t('agent.preview_pane.edit.unsaved')}
                />
              )}
            </div>
            <div className="ml-auto flex shrink-0 items-center gap-1">
              {canEditSelection && (
                <>
                  <Tooltip content={modeActionLabel} delay={800}>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className="text-muted-foreground hover:bg-accent hover:text-foreground"
                      aria-label={modeActionLabel}
                      disabled={editorLoading}
                      onClick={() => handleEditorModeChange(nextEditorMode)}>
                      <ModeActionIcon size={14} />
                    </Button>
                  </Tooltip>
                  <span aria-hidden className="mx-0.5 h-4 w-px bg-border-subtle" />
                </>
              )}
              {overlayActions}
            </div>
          </div>
        )}
        {fileSession?.saveError && (
          <div
            role="alert"
            className="flex shrink-0 items-center gap-2 border-error-border border-b bg-error-bg px-3 py-2 text-error-text text-xs">
            <AlertCircle className="size-4 shrink-0" />
            <span className="min-w-0 flex-1">{t('agent.preview_pane.edit.save_failed')}</span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={fileSession.isSaving}
              onClick={() => void handleRetryFailedSave()}>
              {t('common.retry')}
            </Button>
            <Button type="button" variant="destructive" size="sm" onClick={handleDiscardFailedSave}>
              {t('agent.preview_pane.edit.discard')}
            </Button>
          </div>
        )}
        <div className={cn('min-h-0 flex-1', contentClassName)}>
          {canEditSelection && editMode === 'edit' && fileSession?.status === 'ready' ? (
            <CodeEditor
              key={previewKey}
              value={fileSession.draft}
              language={getLanguageByFilePath(overlaySelection.filePath)}
              theme={activeCmTheme}
              editable={!fileSession.isSaving}
              onChange={(content) => fileSession.setDraft(content)}
              height="100%"
              expanded={false}
              wrapped={false}
              fontSize={14}
              style={{ minHeight: 0 }}
              options={{ keymap: true, lineNumbers: true }}
            />
          ) : canEditSelection && editMode === 'edit' && fileSession?.status === 'loading' ? (
            <div className="flex h-full items-center justify-center">
              <LoadingState label={t('common.loading')} />
            </div>
          ) : (
            previewContent
          )}
        </div>
      </div>
    )
  }

  // Element identity is keystroke-stable (all deps are memoized model fields or
  // stable callbacks), so typing in the editor never re-renders the file tree.
  const fileTreeContent = useMemo(
    () =>
      model.isLoading ? (
        <LoadingState variant="skeleton" rows={4} />
      ) : (
        <FileTree
          nodes={model.filteredTree}
          expandedIds={model.effectiveExpandedIds}
          onExpandedChange={model.setExpandedIds}
          selectedId={selectedFile}
          onSelectedChange={handleSelectedChange}
          showSearch={enableFileSearch}
          searchKeyword={searchKeyword}
          onSearchKeywordChange={onSearchKeywordChange}
          searchPlaceholder={t('agent.preview_pane.search_placeholder')}
          searchToolbar={searchToolbar}
          searchClearLabel={t('common.clear')}
          getMenuItems={getFileTreeMenuItems}
          emptyState={
            <div className="px-2 py-3 text-muted-foreground text-xs">
              {model.error
                ? t('common.error')
                : trimmedFileSearch
                  ? t('agent.preview_pane.no_search_results')
                  : workspacePath
                    ? t('agent.preview_pane.empty.title')
                    : t('agent.preview_pane.empty.description')}
            </div>
          }
        />
      ),
    [
      model.isLoading,
      model.filteredTree,
      model.effectiveExpandedIds,
      model.setExpandedIds,
      model.error,
      selectedFile,
      handleSelectedChange,
      enableFileSearch,
      searchKeyword,
      onSearchKeywordChange,
      searchToolbar,
      getFileTreeMenuItems,
      trimmedFileSearch,
      workspacePath,
      t
    ]
  )

  if (!workspacePath && !overlaySelection) {
    return (
      <div
        ref={artifactPaneRef}
        className={cn(
          'flex h-full min-h-0 flex-col overflow-hidden bg-card text-card-foreground',
          maximized && 'rounded-lg border border-border-subtle shadow-sm'
        )}>
        {paneHeader}
        <EmptyState
          icon={Sparkles}
          title={t('agent.preview_pane.empty.title')}
          description={t('agent.preview_pane.empty.description')}
        />
      </div>
    )
  }

  if (model.error && !overlaySelection) {
    return (
      <div
        ref={artifactPaneRef}
        className={cn(
          'flex h-full min-h-0 flex-col overflow-hidden bg-card text-card-foreground',
          maximized && 'rounded-lg border border-border-subtle shadow-sm'
        )}>
        {paneHeader}
        <EmptyState icon={AlertCircle} title={t('common.error')} description={model.error.message} />
      </div>
    )
  }

  return (
    <div
      ref={artifactPaneRef}
      className={cn(
        'flex h-full min-h-0 flex-col overflow-hidden text-card-foreground',
        maximized && 'rounded-lg border border-border-subtle shadow-sm'
      )}>
      {paneHeader}
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <aside className="flex h-full w-full flex-col overflow-hidden">
          <div data-artifact-file-tree-scroll-region className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
            {fileTreeContent}
          </div>
        </aside>
        {renderOverlay()}
      </div>
      <ConfirmDialog
        open={staleConflictOpen}
        onOpenChange={setStaleConflictOpen}
        title={t('agent.preview_pane.edit.conflict.title')}
        description={t('agent.preview_pane.edit.conflict.description')}
        confirmText={t('agent.preview_pane.edit.conflict.reload')}
        cancelText={t('agent.preview_pane.edit.conflict.keep_draft')}
        destructive
        onConfirm={handleReloadAfterConflict}
      />
    </div>
  )
}

/**
 * Standalone artifact pane: owns its own (optionally controlled) selection /
 * file-tree state and builds the tree model internally. The agent files
 * capability owns the same model and renders `ArtifactPaneView` directly; its
 * stable capability instance survives close, tab, and layout changes.
 */
const ArtifactPane = ({
  workspacePath,
  maximized = false,
  previewFileSelection,
  onPreviewClose,
  pdfLayoutPending = false,
  pdfLayoutRefreshKey = 0,
  selectedFile: selectedFileProp,
  onSelectedFileChange,
  fileTreeExpandedIds: fileTreeExpandedIdsProp,
  onFileTreeExpandedIdsChange,
  fileTreeSearchKeyword: fileTreeSearchKeywordProp,
  onFileTreeSearchKeywordChange,
  enableFileSearch = false
}: ArtifactPaneProps) => {
  const [internalSelectedFile, setInternalSelectedFile] = useState<string | null>(null)
  const [internalPreviewFileSelection, setInternalPreviewFileSelection] = useState<ArtifactPaneFileSelection | null>(
    null
  )
  const [internalFileTreeExpandedIds, setInternalFileTreeExpandedIds] = useState<ReadonlySet<string>>(() => new Set())
  const [internalFileTreeSearchKeyword, setInternalFileTreeSearchKeyword] = useState('')
  const previousWorkspacePathRef = useRef(workspacePath)
  const hasMountedRef = useRef(false)
  const selectedFileControlled = selectedFileProp !== undefined
  const selectedFile = selectedFileControlled ? selectedFileProp : internalSelectedFile
  const previewFileSelectionControlled = previewFileSelection !== undefined
  const effectivePreviewFileSelection = previewFileSelectionControlled
    ? previewFileSelection
    : internalPreviewFileSelection
  const fileTreeExpandedIdsControlled = fileTreeExpandedIdsProp !== undefined
  const expandedIds = fileTreeExpandedIdsProp ?? internalFileTreeExpandedIds
  const fileTreeSearchKeywordControlled = fileTreeSearchKeywordProp !== undefined
  const fileSearchKeyword = fileTreeSearchKeywordProp ?? internalFileTreeSearchKeyword

  const setSelectedFile = useCallback(
    (file: string | null) => {
      if (!selectedFileControlled) setInternalSelectedFile(file)
      if (!previewFileSelectionControlled) {
        setInternalPreviewFileSelection(file && workspacePath ? { workspacePath, filePath: file } : null)
      }
      onSelectedFileChange?.(file)
    },
    [onSelectedFileChange, previewFileSelectionControlled, selectedFileControlled, workspacePath]
  )
  const setExpandedIdsState = useCallback(
    (ids: ReadonlySet<string>) => {
      if (!fileTreeExpandedIdsControlled) setInternalFileTreeExpandedIds(ids)
      onFileTreeExpandedIdsChange?.(ids)
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

  const model = useArtifactFileTreeModel({
    workspacePath,
    treeOpen: true,
    expandedIds,
    searchKeyword: fileSearchKeyword,
    enableFileSearch,
    selectedFile,
    onExpandedIdsChange: setExpandedIdsState
  })

  // Reset transient state when the workspace changes.
  useEffect(() => {
    const workspaceChanged = previousWorkspacePathRef.current !== workspacePath
    if (workspaceChanged) {
      if (!selectedFileControlled) setSelectedFile(null)
      if (!previewFileSelectionControlled) setInternalPreviewFileSelection(null)
    }
    previousWorkspacePathRef.current = workspacePath

    if (!hasMountedRef.current || workspaceChanged) {
      if (!fileTreeExpandedIdsControlled) setExpandedIdsState(new Set())
      if (!fileTreeSearchKeywordControlled) setFileSearchKeyword('')
    }
    hasMountedRef.current = true
  }, [
    fileTreeExpandedIdsControlled,
    fileTreeSearchKeywordControlled,
    previewFileSelectionControlled,
    selectedFileControlled,
    setExpandedIdsState,
    setFileSearchKeyword,
    setSelectedFile,
    workspacePath
  ])

  useEffect(() => {
    if (!selectedFile || !model.hasLoaded) return
    if (isSelectableFileNode(model.nodeById, selectedFile)) return
    setSelectedFile(null)
  }, [model.hasLoaded, model.nodeById, selectedFile, setSelectedFile])

  return (
    <ArtifactPaneView
      workspacePath={workspacePath}
      maximized={maximized}
      previewFileSelection={effectivePreviewFileSelection}
      onPreviewClose={onPreviewClose}
      pdfLayoutPending={pdfLayoutPending}
      pdfLayoutRefreshKey={pdfLayoutRefreshKey}
      enableFileSearch={enableFileSearch}
      model={model}
      selectedFile={selectedFile}
      onSelectedFileChange={setSelectedFile}
      searchKeyword={fileSearchKeyword}
      onSearchKeywordChange={setFileSearchKeyword}
    />
  )
}

export default ArtifactPane
