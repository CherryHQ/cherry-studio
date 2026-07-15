import { Button, CodeEditor, ConfirmDialog, Markdown, PreviewEditor, Tooltip } from '@cherrystudio/ui'
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
import { type FileSizeState, useFileSize } from '@renderer/hooks/useFileSize'
import { type IsTextState, useIsTextFile } from '@renderer/hooks/useIsTextFile'
import { toast } from '@renderer/services/toast'
import { getLanguageByFilePath } from '@renderer/utils/codeLanguage'
import { buildEditorUrl } from '@renderer/utils/editor'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import { joinPath } from '@renderer/utils/path'
import { isMac, isWin } from '@renderer/utils/platform'
import { fileErrorCodes } from '@shared/ipc/errors/file'
import { IpcError } from '@shared/ipc/errors/IpcError'
import type { FilePath } from '@shared/types/file'
import { TEXT_FILE_EDIT_MAX_BYTES } from '@shared/types/file'
import { toFileUrl } from '@shared/utils/file'
import { AlertCircle, FileText, FolderOpen, RotateCw, Sparkles, X } from 'lucide-react'
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
import { type ArtifactFileEditor, useArtifactFileEditor } from './useArtifactFileEditor'
import { type ArtifactFileTreeModel, isSelectableFileNode, useArtifactFileTreeModel } from './useArtifactFileTreeModel'

// Re-exported from their home modules so existing imports of these from
// `ArtifactPane` keep working.
export type { ArtifactPaneFileSelection } from './artifactPanePath'
export { normalizeArtifactPaneFilePath, resolveArtifactPaneFileSelection } from './artifactPanePath'

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
  /** Optional lifted editor controller. When omitted, the standalone pane owns one. */
  fileEditor?: ArtifactFileEditor
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

/** Files above this size skip text preview (and `readText`) — Shiki tokenize gets unusable past ~2MB. */
export const ARTIFACT_PREVIEW_MAX_SIZE_BYTES = TEXT_FILE_EDIT_MAX_BYTES
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
  const oversizedForPreview =
    !isPdfPreview &&
    !isOfficeDocumentPreview &&
    !isImagePreview &&
    fileSize.status === 'ok' &&
    fileSize.size > ARTIFACT_PREVIEW_MAX_SIZE_BYTES

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

interface ArtifactPaneViewProps {
  workspacePath?: string
  maximized?: boolean
  previewFileSelection?: ArtifactPaneFileSelection | null
  onPreviewClose?: () => void
  pdfLayoutPending?: boolean
  pdfLayoutRefreshKey?: number
  enableFileSearch?: boolean
  /** The lifted directory-tree model. Owning it above the component lets the
   *  agent right-pane survive the Host↔Overlay maximize remount without
   *  rebuilding the tree. */
  model: ArtifactFileTreeModel
  selectedFile: string | null
  onSelectedFileChange: (file: string | null) => void
  searchKeyword: string
  onSearchKeywordChange: (keyword: string) => void
  fileEditor?: ArtifactFileEditor
}

interface PendingArtifactPaneTransition {
  file: string | null
  closePreview: boolean
}

/**
 * Presentational artifact pane: renders file tree and selected-file overlay
 * preview from the supplied model.
 */
export function ArtifactPaneView({
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
  fileEditor
}: ArtifactPaneViewProps) {
  const { t } = useTranslation()
  const { activeCmTheme } = useCodeStyle()
  const { data: externalApps } = useExternalApps({ enabled: true })
  const artifactPaneRef = useRef<HTMLDivElement>(null)
  const overlayRef = useRef<HTMLDivElement>(null)
  const [contentRefreshToken, setContentRefreshToken] = useState(0)
  const [editConflictOpen, setEditConflictOpen] = useState(false)
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
  const editSession = overlaySelection ? fileEditor?.getSession(overlaySelection) : undefined
  const canEditSelection =
    Boolean(fileEditor && overlaySelection) &&
    isText === 'text' &&
    fileSize.status === 'ok' &&
    fileSize.size <= ARTIFACT_PREVIEW_MAX_SIZE_BYTES
  const isEditDirty = editSession ? editSession.draft !== editSession.savedContent : false

  useEffect(() => {
    if (previousPreviewKeyRef.current === previewKey) return
    previousPreviewKeyRef.current = previewKey
    setContentRefreshToken(0)
    setEditConflictOpen(false)
  }, [previewKey])

  useEffect(() => {
    if (!overlayWorkspacePath || !overlayFilePath) return
    overlayRef.current?.focus()
  }, [overlayFilePath, overlayWorkspacePath])

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
    if (overlaySelection && editSession && !isEditDirty) {
      void fileEditor?.reload(overlaySelection).catch((error: unknown) => {
        logger.error('Failed to refresh editable file snapshot', error as Error)
        toast.error(t('agent.preview_pane.edit.refresh_failed'))
      })
    }
  }, [
    editSession,
    fileEditor,
    isImageSelection,
    isEditDirty,
    isOfficeDocumentSelection,
    isText,
    overlayFilePath,
    overlaySelection,
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

  const refreshButton = (
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
  )

  const searchToolbar = (
    <div className="flex shrink-0 items-center gap-1">
      {refreshButton}
      {workspacePath && <OpenExternalAppButton workdir={workspacePath} />}
    </div>
  )

  const isSelectedHtmlPreview = previewFilePath ? isHtmlFile(previewFilePath) : false
  const isSelectedPdfPreview = isPdfSelection
  const isSelectedOfficePreview = isOfficeDocumentSelection
  const isSelectedImagePreview = isImageSelection

  const handleEditorModeChange = useCallback(
    (mode: 'preview' | 'edit') => {
      if (!fileEditor || !overlaySelection) return
      void fileEditor.setMode(overlaySelection, mode).catch((error: unknown) => {
        logger.error('Failed to open text file editor', error as Error)
        if (error instanceof IpcError && error.code === fileErrorCodes.TEXT_EDIT_UNSUPPORTED) {
          toast.error(t('agent.preview_pane.edit.unsupported'))
          return
        }
        toast.error(t('agent.preview_pane.edit.open_failed'))
      })
    },
    [fileEditor, overlaySelection, t]
  )

  const handleSaveEdit = useCallback(async () => {
    if (!fileEditor || !overlaySelection) return
    if (editSession?.status === 'conflict') {
      setEditConflictOpen(true)
      return
    }
    try {
      await fileEditor.save(overlaySelection)
      setContentRefreshToken((value) => value + 1)
    } catch (error) {
      logger.error('Failed to save edited artifact file', error as Error)
      if (error instanceof IpcError && error.code === fileErrorCodes.TEXT_EDIT_STALE) {
        setEditConflictOpen(true)
        return
      }
      if (error instanceof IpcError && error.code === fileErrorCodes.TEXT_EDIT_UNSUPPORTED) {
        toast.error(t('agent.preview_pane.edit.unsupported'))
        return
      }
      toast.error(t('agent.preview_pane.edit.save_failed'))
    }
  }, [editSession?.status, fileEditor, overlaySelection, t])

  const handleDiscardEdit = useCallback(() => {
    if (!fileEditor || !overlaySelection) return
    if (editSession?.status === 'conflict') {
      setEditConflictOpen(true)
      return
    }
    fileEditor.discard(overlaySelection)
  }, [editSession?.status, fileEditor, overlaySelection])

  const handleReloadConflict = useCallback(async () => {
    if (!fileEditor || !overlaySelection) return
    try {
      await fileEditor.reload(overlaySelection)
      setContentRefreshToken((value) => value + 1)
    } catch (error) {
      logger.error('Failed to reload artifact after an edit conflict', error as Error)
      toast.error(t('agent.preview_pane.edit.refresh_failed'))
    }
  }, [fileEditor, overlaySelection, t])

  const previewContent = overlaySelection ? (
    <ArtifactFilePreview
      workspacePath={overlaySelection.workspacePath}
      filePath={overlaySelection.filePath}
      isText={isText}
      fileSize={fileSize}
      pdfLayoutPending={pdfLayoutPending}
      pdfLayoutRefreshKey={pdfLayoutRefreshKey}
      contentRefreshKey={contentRefreshToken}
      contentOverride={editSession?.status === 'loading' ? undefined : editSession?.draft}
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
        {canEditSelection && fileEditor ? (
          <PreviewEditor
            mode={editSession?.mode ?? 'preview'}
            onModeChange={handleEditorModeChange}
            title={getPreviewFileTitle(overlaySelection.filePath)}
            actions={overlayActions}
            labels={{
              preview: t('common.preview'),
              edit: t('common.edit'),
              save: t('common.save'),
              discard: t('agent.preview_pane.edit.discard'),
              unsaved: t('agent.preview_pane.edit.unsaved')
            }}
            isDirty={isEditDirty}
            isLoading={editSession?.status === 'loading'}
            isSaving={editSession?.status === 'saving'}
            onSave={handleSaveEdit}
            onDiscard={handleDiscardEdit}
            contentClassName={contentClassName}
            preview={previewContent}
            editor={
              editSession?.status === 'ready' ||
              editSession?.status === 'saving' ||
              editSession?.status === 'conflict' ? (
                <CodeEditor
                  key={previewKey}
                  value={editSession.draft}
                  language={getLanguageByFilePath(overlaySelection.filePath)}
                  theme={activeCmTheme}
                  editable={editSession.status !== 'saving'}
                  onChange={(content) => fileEditor.updateDraft(overlaySelection, content)}
                  onSave={() => void handleSaveEdit()}
                  height="100%"
                  expanded={false}
                  wrapped={false}
                  style={{ minHeight: 0 }}
                  options={{ keymap: true, lineNumbers: true }}
                />
              ) : (
                <div className="flex h-full items-center justify-center">
                  <LoadingState label={t('common.loading')} />
                </div>
              )
            }
          />
        ) : (
          <>
            <div className="flex h-10 shrink-0 items-center justify-between gap-2 border-border-subtle border-b pr-2 pl-3">
              <div className="min-w-0 truncate font-medium text-foreground text-sm">
                {getPreviewFileTitle(overlaySelection.filePath)}
              </div>
              <div className="flex shrink-0 items-center gap-1">{overlayActions}</div>
            </div>
            <div className={cn('min-h-0 flex-1', contentClassName)}>{previewContent}</div>
          </>
        )}
        <ConfirmDialog
          open={editConflictOpen}
          onOpenChange={setEditConflictOpen}
          title={t('agent.preview_pane.edit.conflict.title')}
          description={t('agent.preview_pane.edit.conflict.description')}
          confirmText={t('agent.preview_pane.edit.conflict.reload')}
          cancelText={t('common.cancel')}
          destructive
          onConfirm={handleReloadConflict}
        />
      </div>
    )
  }

  const renderFileTree = () =>
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
    )

  if (!workspacePath && !overlaySelection) {
    return (
      <div
        ref={artifactPaneRef}
        className={cn(
          'flex h-full min-h-0 flex-col overflow-hidden bg-card text-card-foreground',
          maximized && 'rounded-lg border border-border-subtle shadow-sm'
        )}>
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
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <aside className="flex h-full w-full flex-col overflow-hidden">
          <div data-artifact-file-tree-scroll-region className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
            {renderFileTree()}
          </div>
        </aside>
        {renderOverlay()}
      </div>
    </div>
  )
}

/**
 * Standalone artifact pane: owns its own (optionally controlled) selection /
 * file-tree state and builds the tree model internally. The agent right-pane
 * instead lifts the model into a surviving provider and renders
 * `ArtifactPaneView` directly (so maximize/minimize doesn't rebuild the tree).
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
  enableFileSearch = false,
  fileEditor: fileEditorProp
}: ArtifactPaneProps) => {
  const { t } = useTranslation()
  const [internalSelectedFile, setInternalSelectedFile] = useState<string | null>(null)
  const [internalPreviewFileSelection, setInternalPreviewFileSelection] = useState<ArtifactPaneFileSelection | null>(
    null
  )
  const [internalFileTreeExpandedIds, setInternalFileTreeExpandedIds] = useState<ReadonlySet<string>>(() => new Set())
  const [internalFileTreeSearchKeyword, setInternalFileTreeSearchKeyword] = useState('')
  const internalFileEditor = useArtifactFileEditor(workspacePath)
  const fileEditor = fileEditorProp ?? internalFileEditor
  const { clear: clearFileEditor } = fileEditor
  const [pendingTransition, setPendingTransition] = useState<PendingArtifactPaneTransition | null>(null)
  const previousWorkspacePathRef = useRef(workspacePath)
  const hasMountedRef = useRef(false)
  const selectedFileControlled = selectedFileProp !== undefined
  const selectedFile = selectedFileControlled ? selectedFileProp : internalSelectedFile
  const previewFileSelectionControlled = previewFileSelection !== undefined
  const effectivePreviewFileSelection = previewFileSelectionControlled
    ? previewFileSelection
    : internalPreviewFileSelection
  const activeFileSelection = useMemo(
    () =>
      effectivePreviewFileSelection ??
      (workspacePath && selectedFile ? { workspacePath, filePath: selectedFile } : null),
    [effectivePreviewFileSelection, selectedFile, workspacePath]
  )
  const fileTreeExpandedIdsControlled = fileTreeExpandedIdsProp !== undefined
  const expandedIds = fileTreeExpandedIdsProp ?? internalFileTreeExpandedIds
  const fileTreeSearchKeywordControlled = fileTreeSearchKeywordProp !== undefined
  const fileSearchKeyword = fileTreeSearchKeywordProp ?? internalFileTreeSearchKeyword

  const applySelectedFile = useCallback(
    ({ file, closePreview }: PendingArtifactPaneTransition) => {
      clearFileEditor()
      if (!selectedFileControlled) setInternalSelectedFile(file)
      if (!previewFileSelectionControlled) {
        setInternalPreviewFileSelection(file && workspacePath ? { workspacePath, filePath: file } : null)
      }
      onSelectedFileChange?.(file)
      if (closePreview) onPreviewClose?.()
    },
    [
      clearFileEditor,
      onPreviewClose,
      onSelectedFileChange,
      previewFileSelectionControlled,
      selectedFileControlled,
      workspacePath
    ]
  )
  const requestSelectedFile = useCallback(
    (file: string | null, closePreview = false) => {
      const isCurrentSelection = file
        ? Boolean(
            activeFileSelection &&
              activeFileSelection.workspacePath === workspacePath &&
              activeFileSelection.filePath === file
          )
        : !activeFileSelection
      if (isCurrentSelection) return

      const transition = { file, closePreview }
      if (fileEditor.hasUnsavedChanges) {
        setPendingTransition(transition)
        return
      }
      applySelectedFile(transition)
    },
    [activeFileSelection, applySelectedFile, fileEditor.hasUnsavedChanges, workspacePath]
  )
  const confirmPendingTransition = useCallback(() => {
    if (!pendingTransition) return
    const transition = pendingTransition
    setPendingTransition(null)
    applySelectedFile(transition)
  }, [applySelectedFile, pendingTransition])
  const handlePreviewClose = useCallback(() => requestSelectedFile(null, true), [requestSelectedFile])
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
  const { resetLazyChildren } = model

  // Reset transient state when the workspace changes.
  useEffect(() => {
    const workspaceChanged = previousWorkspacePathRef.current !== workspacePath
    if (workspaceChanged) {
      clearFileEditor()
      setPendingTransition(null)
      if (!selectedFileControlled) {
        setInternalSelectedFile(null)
        onSelectedFileChange?.(null)
      }
      if (!previewFileSelectionControlled) setInternalPreviewFileSelection(null)
      resetLazyChildren()
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
    clearFileEditor,
    onSelectedFileChange,
    previewFileSelectionControlled,
    selectedFileControlled,
    setExpandedIdsState,
    setFileSearchKeyword,
    resetLazyChildren,
    workspacePath
  ])

  useEffect(() => {
    if (!selectedFile || !model.hasLoaded) return
    if (isSelectableFileNode(model.nodeById, selectedFile)) return
    applySelectedFile({ file: null, closePreview: false })
  }, [applySelectedFile, model.hasLoaded, model.nodeById, selectedFile])

  return (
    <>
      <ArtifactPaneView
        workspacePath={workspacePath}
        maximized={maximized}
        previewFileSelection={effectivePreviewFileSelection}
        onPreviewClose={handlePreviewClose}
        pdfLayoutPending={pdfLayoutPending}
        pdfLayoutRefreshKey={pdfLayoutRefreshKey}
        enableFileSearch={enableFileSearch}
        model={model}
        selectedFile={selectedFile}
        onSelectedFileChange={requestSelectedFile}
        searchKeyword={fileSearchKeyword}
        onSearchKeywordChange={setFileSearchKeyword}
        fileEditor={fileEditor}
      />
      <ConfirmDialog
        open={pendingTransition !== null}
        onOpenChange={(open) => {
          if (!open) setPendingTransition(null)
        }}
        title={t('agent.preview_pane.edit.leave.title')}
        description={t('agent.preview_pane.edit.leave.description')}
        confirmText={t('agent.preview_pane.edit.leave.confirm')}
        cancelText={t('common.cancel')}
        destructive
        onConfirm={confirmPendingTransition}
      />
    </>
  )
}

export default ArtifactPane
