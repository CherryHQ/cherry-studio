import type { TFunction } from 'i18next'
import {
  AlertCircle,
  AtSign,
  Copy,
  Eye,
  Folder,
  List,
  MessageSquareText,
  Sparkles,
  SquareDashedMousePointer,
  SquarePen,
  X
} from 'lucide-react'
import {
  type KeyboardEvent as ReactKeyboardEvent,
  lazy,
  type ReactNode,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import { useTranslation } from 'react-i18next'

import { FilePreviewToolbarPortalHost, FilePreviewToolbarPortalProvider } from '@cherrystudio/file-preview/react'
import {
  Button,
  ConfirmDialog,
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
  type ResizablePanelHandle,
  Tooltip
} from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import { usePersistCache } from '@data/hooks/useCache'
import { loggerService } from '@logger'
import { EmptyState, LoadingState } from '@renderer/components/chat/primitives'
import { CommandContextMenu, type CommandContextMenuExtraItem } from '@renderer/components/command'
import FileCommentBox from '@renderer/components/FileCommentBox'
import type { LineComment } from '@renderer/components/FileEditor'
import { canProduceSelectionReference, FilePreview, hasRenderedFilePreview } from '@renderer/components/FilePreview'
import { FileTree, type FileTreeNode } from '@renderer/components/FileTree'
import { buildOpenTargetMenuItems, loadOpenTargetMenuItems, OpenTargetButton } from '@renderer/components/OpenTarget'
import { useExternalOpenTargets } from '@renderer/hooks/useExternalOpenTargets'
import {
  FILE_EDIT_MAX_SIZE_BYTES as ARTIFACT_PREVIEW_MAX_SIZE_BYTES,
  type FileEditSession
} from '@renderer/hooks/useFileEditSession'
import { useFileSize } from '@renderer/hooks/useFileSize'
import { useIsTextFile } from '@renderer/hooks/useIsTextFile'
import { toast } from '@renderer/services/toast'
import {
  type ComposerFileReference,
  SELECTION_EXCERPT_MAX_LENGTH,
  type SelectionReference
} from '@renderer/types/selectionReference'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import { getFileExtension } from '@renderer/utils/file'
import { joinPath } from '@renderer/utils/path'
import { isMac, isWin } from '@renderer/utils/platform'
import { hasUnwrappableLine } from '@renderer/utils/softWrap'
import type { ExternalOpenTarget } from '@shared/types/externalApp'
import { AbsoluteFilePathSchema } from '@shared/types/file'

import { ArtifactPaneBreadcrumb } from './ArtifactPaneBreadcrumb'
import { ArtifactPaneFileTabs } from './ArtifactPaneFileTabs'
import {
  type ArtifactPaneFileSelection,
  getArtifactPaneSelectionPath,
  getArtifactPaneSelectionDisplayPath,
  getArtifactPaneSelectionRelativePath,
  getCopyableAbsolutePath,
  getPathBasename,
  WORKSPACE_ROOT_ID
} from './artifactPanePath'
import { ArtifactPaneSettingsMenu, useFilePaneSettings } from './ArtifactPaneSettingsMenu'
import {
  type ArtifactFileTreeErrorKind,
  type ArtifactFileTreeModel,
  isSelectableFileNode,
  useArtifactFileTreeModel
} from './useArtifactFileTreeModel'

// Re-exported from their home modules so existing imports of these from
// `ArtifactPane` keep working.
export type { ArtifactPaneFileSelection } from './artifactPanePath'
export {
  getArtifactPaneSelectionPath,
  normalizeArtifactPaneFilePath,
  resolveArtifactPaneFileSelection
} from './artifactPanePath'

const logger = loggerService.withContext('ArtifactPane')
const FileEditor = lazy(() => import('@renderer/components/FileEditor'))

const ARTIFACT_FILE_TREE_ERROR_KEYS = {
  invalid_path: {
    description: 'agent.preview_pane.tree_error.invalid_path.description',
    title: 'agent.preview_pane.tree_error.invalid_path.title'
  },
  load_error: {
    description: 'agent.preview_pane.tree_error.load_error.description',
    title: 'agent.preview_pane.tree_error.load_error.title'
  }
} as const satisfies Record<ArtifactFileTreeErrorKind, { description: string; title: string }>

export interface ArtifactPaneProps {
  workspacePath?: string
  maximized?: boolean
  previewFileSelection?: ArtifactPaneFileSelection | null
  onPreviewClose?: () => void
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

export { FILE_EDIT_MAX_SIZE_BYTES as ARTIFACT_PREVIEW_MAX_SIZE_BYTES } from '@renderer/hooks/useFileEditSession'

const DOCUMENT_CONTENT_COPY_MAX_SIZE_BYTES = 25 * 1024 * 1024
const COPYABLE_DOCUMENT_EXTENSIONS = new Set(['.doc', '.docx'])
const NON_TEXT_DOCUMENT_EXTENSIONS = new Set(['.pdf', '.ppt', '.pptx', '.xls', '.xlsx', '.odt', '.odp', '.ods'])
const TOOLBAR_BUTTON_CLASS = 'text-muted-foreground hover:bg-accent hover:text-foreground'
const SPLIT_MIN_WIDTH_PX = 672

/** The shared "Copy" submenu for a file or folder in the tree and the open-file header. */
function buildCopyMenu({
  t,
  copy,
  onCopyContent,
  absolutePath,
  relativePath,
  fileName
}: {
  t: TFunction
  copy: (text: string) => void
  onCopyContent?: () => void
  absolutePath: string
  relativePath: string | null
  fileName: string
}): CommandContextMenuExtraItem {
  return {
    type: 'submenu',
    id: 'artifact-pane.file.copy',
    label: t('common.copy'),
    icon: <Copy size={14} />,
    children: [
      ...(onCopyContent
        ? [
            {
              type: 'item' as const,
              id: 'artifact-pane.overlay.copy-content',
              label: t('agent.preview_pane.copy_menu.content'),
              onSelect: onCopyContent
            }
          ]
        : []),
      {
        type: 'item',
        id: 'artifact-pane.overlay.copy-path',
        label: t('agent.preview_pane.copy_menu.absolute_path'),
        onSelect: () => copy(absolutePath)
      },
      ...(relativePath
        ? [
            {
              type: 'item' as const,
              id: 'artifact-pane.overlay.copy-relative-path',
              label: t('agent.preview_pane.copy_menu.relative_path'),
              onSelect: () => copy(relativePath)
            }
          ]
        : []),
      {
        type: 'item',
        id: 'artifact-pane.overlay.copy-file-name',
        label: t('agent.preview_pane.copy_menu.file_name'),
        onSelect: () => copy(fileName)
      }
    ]
  }
}

function FilePaneSplit({
  treeOnRight,
  tree,
  file,
  resizeLabel
}: {
  treeOnRight: boolean
  tree: ReactNode
  file: ReactNode
  resizeLabel: string
}) {
  const [savedTreeWidth, setSavedTreeWidth] = usePersistCache('ui.agent.file_pane.tree_width')
  // A Panel re-registers whenever defaultSize changes, so feeding the saved width back would loop the layout.
  const [initialTreeWidth] = useState(savedTreeWidth)
  const treePanelRef = useRef<ResizablePanelHandle | null>(null)
  const treePanel = (
    <ResizablePanel
      id="file-tree"
      panelRef={treePanelRef}
      defaultSize={`${initialTreeWidth}px`}
      minSize="180px"
      maxSize="480px"
      groupResizeBehavior="preserve-pixel-size">
      {tree}
    </ResizablePanel>
  )
  const filePanel = (
    <ResizablePanel id="file-column" className="relative">
      {file}
    </ResizablePanel>
  )
  return (
    <ResizablePanelGroup
      onLayoutChanged={() => {
        const width = treePanelRef.current?.getSize().inPixels
        if (width && Math.abs(width - savedTreeWidth) >= 1) setSavedTreeWidth(Math.round(width))
      }}>
      {treeOnRight ? filePanel : treePanel}
      <ResizableHandle aria-label={resizeLabel} />
      {treeOnRight ? treePanel : filePanel}
    </ResizablePanelGroup>
  )
}

function getPreviewFileTitle(selection: ArtifactPaneFileSelection): string {
  // displayName is the attachment filename; filePath may be a managed copy.
  if (selection.displayName) return selection.displayName
  return getPathBasename(selection.filePath)
}

function canCopyFileContent(filePath: string | null, isText: string, fileSize: { status: string; size?: number }) {
  if (!filePath || fileSize.status !== 'ok' || typeof fileSize.size !== 'number') return false
  const extension = getFileExtension(filePath)
  if (COPYABLE_DOCUMENT_EXTENSIONS.has(extension)) return fileSize.size <= DOCUMENT_CONTENT_COPY_MAX_SIZE_BYTES
  if (NON_TEXT_DOCUMENT_EXTENSIONS.has(extension)) return false
  return isText === 'text' && fileSize.size <= ARTIFACT_PREVIEW_MAX_SIZE_BYTES
}

function getFileTreeNodeTargetPath(workspacePath: string | undefined, node: { id: string }): string | null {
  if (!workspacePath) return null
  return node.id === WORKSPACE_ROOT_ID ? workspacePath : joinPath(workspacePath, node.id)
}

interface ArtifactPaneViewBaseProps {
  workspacePath?: string
  maximized?: boolean
  previewFileSelection?: ArtifactPaneFileSelection | null
  onPreviewClose?: () => void
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
  /**
   * Hands the preview's current selection to a composer. Supplying it is what
   * turns selection capture on: without it the preview never reports one and no
   * quote affordance is offered.
   */
  onInsertSelectionReference?: (reference: ComposerFileReference) => void
  /** Open file tabs; `previewFileSelection` is the active one. Defaults to the open file alone. */
  fileTabs?: ArtifactPaneFileSelection[]
  onActivateFileTab?: (tab: ArtifactPaneFileSelection) => void
  onCloseFileTab?: (tab: ArtifactPaneFileSelection) => void
  /** Keeps only the given tab open (Close others), or none (Close all). */
  onRetainFileTab?: (tab: ArtifactPaneFileSelection | null) => void
  /**
   * Adds a file or folder to the composer as context; omitted where there is no composer.
   * `name` labels the chip when the readable file is a managed copy of an attachment.
   */
  onAttachPathToContext?: (path: string, kind: 'file' | 'directory', name?: string) => void
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
 *
 * Escape is handled in two places and never at the document level: the overlay owns it for anything
 * focused inside it, and the pane root covers the picker toggle, which sits in the pane header as the
 * overlay's sibling. The picker takes precedence over closing the preview, because losing the mode is
 * cheaper to recover from than losing the preview.
 */
export function ArtifactPaneView(props: ArtifactPaneViewProps) {
  const {
    workspacePath,
    maximized = false,
    previewFileSelection = null,
    onPreviewClose,
    enableFileSearch = false,
    model,
    selectedFile,
    onSelectedFileChange,
    searchKeyword,
    onSearchKeywordChange,
    fileSession,
    editMode = 'preview',
    onEditModeChange,
    onInsertSelectionReference,
    fileTabs,
    onActivateFileTab,
    onCloseFileTab,
    onRetainFileTab,
    onAttachPathToContext
  } = props
  const { t } = useTranslation()
  const [paneElement, artifactPaneRef] = useState<HTMLDivElement | null>(null)
  const [paneSettings] = useFilePaneSettings()
  // Wide panes keep the tree beside the preview; narrow panes cover it with the preview overlay.
  const [isWide, setIsWide] = useState(false)
  const [unpinnedTreeWorkspaces, setUnpinnedTreeWorkspaces] = usePersistCache(
    'ui.agent.file_pane.unpinned_tree_workspaces'
  )
  const treePinned = !workspacePath || !unpinnedTreeWorkspaces.includes(workspacePath)
  const isSplit = isWide && treePinned
  const toggleTreePinned = () => {
    if (!workspacePath) return
    setUnpinnedTreeWorkspaces(
      treePinned
        ? [...unpinnedTreeWorkspaces, workspacePath]
        : unpinnedTreeWorkspaces.filter((path) => path !== workspacePath)
    )
  }
  useEffect(() => {
    if (!paneElement) return
    const observer = new ResizeObserver(([entry]) => setIsWide(entry.contentRect.width >= SPLIT_MIN_WIDTH_PX))
    observer.observe(paneElement)
    return () => observer.disconnect()
  }, [paneElement])
  const overlayRef = useRef<HTMLDivElement>(null)
  const [contentRefreshToken, setContentRefreshToken] = useState(0)
  const [knownFileSizeBytes, setKnownFileSizeBytes] = useState<number | undefined>(undefined)
  const [staleConflictOpen, setStaleConflictOpen] = useState(false)
  const [selectionReference, setSelectionReference] = useState<SelectionReference | null>(null)
  // Destructure the stable callbacks so effect/callback deps don't have to
  // list the whole `model` (a fresh object every render).

  const trimmedFileSearch = enableFileSearch ? searchKeyword.trim() : ''
  const previewSelectionWorkspacePath = previewFileSelection?.workspacePath
  const parsedPreviewWorkspacePath = useMemo(
    () => (previewSelectionWorkspacePath ? AbsoluteFilePathSchema.safeParse(previewSelectionWorkspacePath) : null),
    [previewSelectionWorkspacePath]
  )
  const hasInvalidPreviewSelection = Boolean(previewFileSelection && !parsedPreviewWorkspacePath?.success)
  const validPreviewFileSelection = parsedPreviewWorkspacePath?.success ? previewFileSelection : null
  const effectiveTreeErrorKind: ArtifactFileTreeErrorKind | undefined = hasInvalidPreviewSelection
    ? 'invalid_path'
    : model.errorKind
  const treeErrorKeys = effectiveTreeErrorKind ? ARTIFACT_FILE_TREE_ERROR_KEYS[effectiveTreeErrorKind] : undefined
  const hasInvalidWorkspacePath = effectiveTreeErrorKind === 'invalid_path'
  const overlaySelection = useMemo(
    () =>
      validPreviewFileSelection
        ? validPreviewFileSelection
        : workspacePath && !hasInvalidWorkspacePath && selectedFile
          ? { workspacePath, filePath: selectedFile }
          : null,
    [hasInvalidWorkspacePath, selectedFile, validPreviewFileSelection, workspacePath]
  )
  const [pickerActive, setPickerActive] = useState(false)
  const pickerAvailable = Boolean(
    onInsertSelectionReference &&
    overlaySelection &&
    canProduceSelectionReference(getArtifactPaneSelectionPath(overlaySelection))
  )
  const overlayWorkspacePath = overlaySelection?.workspacePath
  const overlayFilePath = overlaySelection?.filePath
  const previewWorkspacePath = overlayWorkspacePath ?? (hasInvalidWorkspacePath ? undefined : workspacePath)
  const previewFilePath = overlayFilePath ?? selectedFile
  const previewKey = `${previewWorkspacePath ?? ''}\0${previewFilePath ?? ''}`
  // Narrow panes cover the tree with the open file; the header toggle reveals it until another file opens.
  const [treeRevealedFor, setTreeRevealedFor] = useState<string | null>(null)
  const treeRevealed = !isWide && treeRevealedFor === previewKey
  const previousPreviewKeyRef = useRef(previewKey)

  const handleSelectedChange = useCallback(
    (id: string | null) => {
      if (!id) {
        onSelectedFileChange(null)
        return
      }
      if (!isSelectableFileNode(model.nodeById, id)) return
      setTreeRevealedFor(null)
      onSelectedFileChange(id)
    },
    [model.nodeById, onSelectedFileChange]
  )

  const isText = useIsTextFile(previewWorkspacePath, previewFilePath)
  // Plain text always opens in the editor; rendered text formats (Markdown, HTML, SVG) switch between the two.
  const canToggleEdit = Boolean(
    overlaySelection &&
    !overlaySelection.readOnly &&
    onEditModeChange &&
    isText === 'text' &&
    hasRenderedFilePreview(getArtifactPaneSelectionPath(overlaySelection))
  )
  const editToggleLabel = t(editMode === 'edit' ? 'common.preview' : 'common.edit')
  const fileSize = useFileSize(previewWorkspacePath, previewFilePath, contentRefreshToken, knownFileSizeBytes)
  const canCopyPreviewContent = canCopyFileContent(previewFilePath ?? null, isText, fileSize)
  const isEditDirty = fileSession?.isDirty ?? false
  const editorDraft = editMode === 'edit' && fileSession?.status === 'ready' ? fileSession.draft : ''
  const wordWrapUnavailable = useMemo(() => hasUnwrappableLine(editorDraft), [editorDraft])

  useEffect(() => {
    if (previousPreviewKeyRef.current === previewKey) return
    previousPreviewKeyRef.current = previewKey
    setContentRefreshToken(0)
    setKnownFileSizeBytes(undefined)
    setStaleConflictOpen(false)
    setSelectionReference(null)
  }, [previewKey])

  // The host owns the captured reference. Clear it as soon as refresh starts,
  // before metadata resolves and the retained plugin receives its new refresh key.
  useEffect(() => {
    setSelectionReference(null)
  }, [contentRefreshToken])

  // The editor replaces the preview, taking the plugin that owns the selection
  // with it — anything captured before the switch is no longer on screen.
  useEffect(() => {
    if (editMode === 'edit') setSelectionReference(null)
  }, [editMode])

  // The picker is a mode of the preview, so it ends with the preview. It survives a file switch to another
  // pickable file on purpose — the button stays on while the user gathers references.
  useEffect(() => {
    if (editMode === 'edit' || !pickerAvailable) setPickerActive(false)
  }, [editMode, pickerAvailable])

  // Switching capture off is the one moment the plugin cannot report null itself: its callback is
  // already gone. (Escape is handled by handleOverlayKeyDown, not here.)
  useEffect(() => {
    if (pickerActive) return
    setSelectionReference(null)
  }, [pickerActive])

  // Successful writes return an exact byte size through the edit session.
  // Invalidate the separate metadata gate whenever that size changes so a
  // saved file that crosses the preview limit cannot reuse stale metadata.
  useEffect(() => {
    if (fileSession?.savedSizeBytes === undefined) return
    setKnownFileSizeBytes(fileSession.savedSizeBytes)
    setContentRefreshToken((value) => value + 1)
  }, [fileSession?.savedSizeBytes])

  // Surface an unresolved external-change conflict as the reload dialog;
  // autosave stays paused until it is resolved. saveError changes reopen it.
  const conflictResolvedRef = useRef(false)
  useEffect(() => {
    if (fileSession?.conflict) {
      conflictResolvedRef.current = false
      setStaleConflictOpen(true)
    }
  }, [fileSession?.conflict, fileSession?.saveError])

  // Files open in the editor by default; one that cannot be edited in place
  // (binary / oversize) quietly falls back to its preview.
  useEffect(() => {
    if (editMode !== 'edit' || fileSession?.status !== 'unsupported') return
    if (fileSession.unsupportedReason === 'size') {
      setContentRefreshToken((value) => value + 1)
    }
    onEditModeChange?.('preview')
  }, [editMode, fileSession?.status, fileSession?.unsupportedReason, onEditModeChange])

  // Autosave I/O failure: the draft stays in the editor and automatic retries
  // pause until the user explicitly retries or discards it.
  useEffect(() => {
    if (!fileSession?.saveError) return
    if (fileSession.metadataRecoveryPending) {
      toast.warning(t('agent.preview_pane.edit.metadata_pending'))
    } else {
      toast.error(t('agent.preview_pane.edit.save_failed'))
    }
  }, [fileSession?.metadataRecoveryPending, fileSession?.saveError, t])

  useEffect(() => {
    if (!overlayWorkspacePath || !overlayFilePath) return
    overlayRef.current?.focus()
  }, [overlayFilePath, overlayWorkspacePath])

  // Depend on the session's stable callbacks, not the session object —
  // the object changes on every keystroke and would drag the whole toolbar /
  // file-tree memo chain below with it.
  const fileSessionFlush = fileSession?.flush
  const fileSessionDiscard = fileSession?.discard
  // Menu items outlive their opening render (the portal stays up across
  // renders), so every value they read at click time must live in a ref.
  const canCopyPreviewContentRef = useRef(canCopyPreviewContent)
  canCopyPreviewContentRef.current = canCopyPreviewContent
  const overlayPathsRef = useRef<{ filePath?: string; workspacePath?: string }>({})
  overlayPathsRef.current = {
    filePath: overlayFilePath,
    workspacePath: overlayWorkspacePath
  }
  const handleClosePreview = useCallback(() => {
    if (onPreviewClose) {
      onPreviewClose()
      return
    }
    onSelectedFileChange(null)
  }, [onPreviewClose, onSelectedFileChange])

  // React 19 delegates events at the root container, so a document-level listener would never see a keydown
  // whose SyntheticEvent.stopPropagation() this handler already called.
  const handleOverlayKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (event.key === 's' && (isMac ? event.metaKey : event.ctrlKey) && editMode === 'edit' && fileSession?.isDirty) {
        event.preventDefault()
        // A failed save stays visible in the session's error banner.
        void fileSessionFlush?.().catch(() => undefined)
        return
      }
      if (event.key !== 'Escape') return
      if (pickerActive) {
        event.stopPropagation()
        setPickerActive(false)
        return
      }
      event.stopPropagation()
      handleClosePreview()
    },
    [editMode, fileSession?.isDirty, fileSessionFlush, handleClosePreview, pickerActive]
  )

  const copyPath = useCallback(
    async (path: string) => {
      try {
        await navigator.clipboard.writeText(path)
        toast.success(t('message.copy.success'))
      } catch (error) {
        logger.error('Failed to copy path', error as Error)
        toast.error(t('message.copy.failed'))
      }
    },
    [t]
  )

  const handleCopyPreviewContent = useCallback(async () => {
    const { filePath, workspacePath } = overlayPathsRef.current
    if (!filePath || !workspacePath || !canCopyPreviewContentRef.current) return
    try {
      const absolutePath = getArtifactPaneSelectionPath({ workspacePath, filePath })
      const extension = getFileExtension(absolutePath)
      const content = COPYABLE_DOCUMENT_EXTENSIONS.has(extension)
        ? await window.api.file.readExternal(absolutePath, true)
        : await window.api.fs.readText(absolutePath)
      await navigator.clipboard.writeText(content)
      toast.success(t('message.copy.success'))
    } catch (error) {
      logger.error('Failed to copy file content', error as Error)
      toast.error(t('message.copy.failed'))
    }
  }, [t])

  const attachMenuItems = useCallback(
    (path: string, kind: 'file' | 'directory', name?: string): CommandContextMenuExtraItem[] =>
      onAttachPathToContext
        ? [
            {
              type: 'item',
              id: 'artifact-pane.file.attach',
              label: t('agent.preview_pane.attach_as_context'),
              icon: <AtSign size={14} />,
              onSelect: () => onAttachPathToContext(path, kind, name)
            }
          ]
        : [],
    [onAttachPathToContext, t]
  )

  const getFileTreeMenuItems = useCallback(
    async (node: FileTreeNode): Promise<readonly CommandContextMenuExtraItem[]> => {
      const targetPath = getFileTreeNodeTargetPath(workspacePath, node)
      if (!targetPath) return []

      const pathKind = node.kind === 'file' ? 'file' : 'directory'
      const openItems = await loadOpenTargetMenuItems({ targetPath, pathKind, t })
      return [
        ...attachMenuItems(targetPath, pathKind),
        buildCopyMenu({
          t,
          copy: (text) => void copyPath(text),
          absolutePath: getCopyableAbsolutePath(targetPath, isWin),
          relativePath: node.id === WORKSPACE_ROOT_ID ? null : node.id,
          fileName: node.name
        }),
        ...(openItems.length ? [{ type: 'separator' as const }, ...openItems] : [])
      ]
    },
    [attachMenuItems, copyPath, t, workspacePath]
  )

  const getFolderMenuItems = useCallback(
    (id: string) => {
      const node = model.nodeById.get(id)
      return node ? getFileTreeMenuItems(node) : []
    },
    [getFileTreeMenuItems, model.nodeById]
  )

  const pickerToggle = useMemo(
    () =>
      pickerAvailable && editMode !== 'edit' ? (
        <Tooltip content={t('agent.preview_pane.pick_selection')} delay={800}>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className={cn(
              'text-muted-foreground hover:bg-accent hover:text-foreground',
              pickerActive && 'bg-accent text-foreground'
            )}
            aria-label={t('agent.preview_pane.pick_selection')}
            aria-pressed={pickerActive}
            onClick={() => setPickerActive((active) => !active)}>
            <SquareDashedMousePointer size={16} />
          </Button>
        </Tooltip>
      ) : null,
    [editMode, pickerActive, pickerAvailable, t]
  )

  const searchToolbar = useMemo(
    () =>
      props.headerVariant === 'pane' ? undefined : (
        <div className="flex shrink-0 items-center gap-1">
          {workspacePath && !hasInvalidWorkspacePath ? (
            <OpenTargetButton targetPath={workspacePath} pathKind="directory" />
          ) : null}
        </div>
      ),
    [hasInvalidWorkspacePath, props.headerVariant, workspacePath]
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

  const handleKeepDraftAfterConflict = useCallback(async () => {
    if (!fileSession) return
    try {
      await fileSession.keepDraft()
    } catch (error) {
      logger.error('Failed to keep the artifact draft after a write conflict', error as Error)
      toast.error(t('agent.preview_pane.edit.save_failed'))
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

  const handleDiscardFailedSave = useCallback(async () => {
    try {
      await fileSessionDiscard?.()
    } catch {
      /* The retained session exposes the failure. */
    }
  }, [fileSessionDiscard])

  const fileTargetPath = overlaySelection ? getArtifactPaneSelectionPath(overlaySelection) : ''
  const { targets: fileOpenTargets, openTarget: openFileTarget } = useExternalOpenTargets(fileTargetPath, 'file', {
    enabled: Boolean(overlaySelection)
  })
  const handleOpenFileTarget = useCallback(
    (target: ExternalOpenTarget) => {
      void openFileTarget(target).catch((error: unknown) => {
        toast.error(formatErrorMessageWithPrefix(error, t('files.error.open_path', { path: fileTargetPath })))
      })
    },
    [fileTargetPath, openFileTarget, t]
  )

  // One file menu for the breadcrumb and the tabs, built from the same pieces as the tree's.
  const buildFileMenuItems = useCallback(
    (
      selection: ArtifactPaneFileSelection,
      openItems: readonly CommandContextMenuExtraItem[],
      onCopyContent?: () => void
    ): CommandContextMenuExtraItem[] => {
      const absolutePath = getArtifactPaneSelectionDisplayPath(selection)
      const relativePath = getArtifactPaneSelectionRelativePath(workspacePath, selection)
      return [
        // Attach the file the preview reads; an attachment's original path may no longer exist.
        ...attachMenuItems(getArtifactPaneSelectionPath(selection), 'file', getPreviewFileTitle(selection)),
        buildCopyMenu({
          t,
          copy: (text) => void copyPath(text),
          onCopyContent,
          absolutePath: getCopyableAbsolutePath(absolutePath, isWin),
          relativePath,
          fileName: getPreviewFileTitle(selection)
        }),
        ...(openItems.length ? [{ type: 'separator' as const }, ...openItems] : [])
      ]
    },
    [attachMenuItems, copyPath, t, workspacePath]
  )
  const activeOpenItems = useMemo(
    () => buildOpenTargetMenuItems({ targets: fileOpenTargets, onOpen: handleOpenFileTarget, t }),
    [fileOpenTargets, handleOpenFileTarget, t]
  )
  const copyActiveContent = canCopyPreviewContent ? () => void handleCopyPreviewContent() : undefined
  const fileMenuItems = overlaySelection ? buildFileMenuItems(overlaySelection, activeOpenItems, copyActiveContent) : []

  const treeShown = isWide ? treePinned : treeRevealed
  const tabSelections = fileTabs ?? (overlaySelection ? [overlaySelection] : [])
  const tabKey = (tab: ArtifactPaneFileSelection) =>
    `${tab.previewType ?? 'artifact'}:${getArtifactPaneSelectionPath(tab)}`
  const activeTabKey = overlaySelection ? tabKey(overlaySelection) : null
  const findTab = (key: string) => tabSelections.find((tab) => tabKey(tab) === key)
  const closeTab = (key: string) => {
    const tab = findTab(key)
    if (!tab) return
    if (key === activeTabKey) handleClosePreview()
    else onCloseFileTab?.(tab)
  }
  const getTabMenuItems = async (key: string): Promise<readonly CommandContextMenuExtraItem[]> => {
    const tab = findTab(key)
    if (!tab) return []
    const active = key === activeTabKey
    const openItems = active
      ? activeOpenItems
      : await loadOpenTargetMenuItems({ targetPath: getArtifactPaneSelectionPath(tab), pathKind: 'file', t })
    const closeItem = (id: string, label: string, onSelect: () => void): CommandContextMenuExtraItem => ({
      type: 'item',
      id: `artifact-pane.tab.${id}`,
      label,
      onSelect
    })
    return [
      ...buildFileMenuItems(tab, openItems, active ? copyActiveContent : undefined),
      { type: 'separator' },
      closeItem('close', t('agent.preview_pane.tabs.close'), () => closeTab(key)),
      ...(onRetainFileTab
        ? [
            ...(tabSelections.length > 1
              ? [closeItem('close-others', t('agent.preview_pane.tabs.close_others'), () => onRetainFileTab(tab))]
              : []),
            closeItem('close-all', t('agent.preview_pane.tabs.close_all'), () => onRetainFileTab(null))
          ]
        : [])
    ]
  }
  // Wide panes pin or unpin the tree per workspace; narrow panes only reveal it for the open file.
  const treeToggle =
    isWide || overlaySelection ? (
      <Tooltip content={t('agent.preview_pane.toggle_tree')} delay={800}>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className={cn(
            TOOLBAR_BUTTON_CLASS,
            'shrink-0',
            treeShown && 'bg-resource-list-row-selected text-resource-list-row-selected-foreground'
          )}
          aria-label={t('agent.preview_pane.toggle_tree')}
          aria-pressed={treeShown}
          onClick={isWide ? toggleTreePinned : () => setTreeRevealedFor(treeRevealed ? null : previewKey)}>
          <List size={16} />
        </Button>
      </Tooltip>
    ) : null
  // The toggle follows the tree to the right; a narrow pane covers the file instead, so it stays left.
  const treeToggleOnRight = isWide && paneSettings.treePosition === 'right'
  const paneHeader =
    props.headerVariant === 'pane' ? (
      <div
        data-testid="artifact-pane-header"
        className="flex min-h-(--navbar-height) shrink-0 items-center gap-2 border-b border-border-subtle bg-card px-2 [-webkit-app-region:no-drag]">
        {treeToggleOnRight ? null : treeToggle}
        {tabSelections.length ? (
          <ArtifactPaneFileTabs
            tabs={tabSelections.map((tab) => ({
              key: tabKey(tab),
              title: getPreviewFileTitle(tab),
              path: getArtifactPaneSelectionPath(tab)
            }))}
            activeKey={activeTabKey}
            activeDirty={isEditDirty}
            dirtyLabel={t('agent.preview_pane.edit.unsaved')}
            closeLabel={t('agent.preview_pane.close')}
            overflowLabel={t('agent.preview_pane.tabs.show_all')}
            onActivate={(key) => {
              const tab = findTab(key)
              if (tab) onActivateFileTab?.(tab)
            }}
            onClose={closeTab}
            getMenuItems={getTabMenuItems}
          />
        ) : (
          <div
            data-testid="artifact-pane-header-title"
            className="min-w-0 flex-1 truncate px-1 text-sm font-medium text-foreground select-none">
            {props.paneTitle}
          </div>
        )}
        <div className="ml-auto flex shrink-0 items-center gap-1">
          {treeToggleOnRight ? treeToggle : null}
          <ArtifactPaneSettingsMenu buttonClassName={TOOLBAR_BUTTON_CLASS} wordWrapUnavailable={wordWrapUnavailable} />
          {props.paneActions}
        </div>
      </div>
    ) : null

  const lineCommentPath = overlaySelection ? getArtifactPaneSelectionPath(overlaySelection) : null
  const handleLineComment = useCallback(
    ({ startLine, endLine, lines, comment }: LineComment) => {
      if (!lineCommentPath) return
      // Code points, like every other reference excerpt, so a surrogate pair is never split.
      const excerpt = [...lines].slice(0, SELECTION_EXCERPT_MAX_LENGTH).join('')
      onInsertSelectionReference?.({ path: lineCommentPath, startLine, endLine, excerpt, comment })
    },
    [lineCommentPath, onInsertSelectionReference]
  )

  // The box belongs to the selection it opened on, so picking another region closes it.
  const [commentTarget, setCommentTarget] = useState<SelectionReference | null>(null)
  // Not cleared on submit: the composer receives the reference over a window event and can still refuse it
  // (no room in the input) without reporting back, so clearing here would drop the selection on a failure.
  const handleSelectionComment = useCallback(
    (comment: string) => {
      if (!selectionReference) return
      onInsertSelectionReference?.(comment ? { ...selectionReference, comment } : selectionReference)
      setCommentTarget(null)
    },
    [onInsertSelectionReference, selectionReference]
  )

  const previewContent = overlaySelection ? (
    <FilePreview
      filePath={getArtifactPaneSelectionPath(overlaySelection)}
      refreshKey={contentRefreshToken}
      type={overlaySelection.previewType ?? 'artifact'}
      onSelectionReference={onInsertSelectionReference && pickerActive ? setSelectionReference : undefined}
      onLineComment={onInsertSelectionReference ? handleLineComment : undefined}
    />
  ) : null

  const selectionReferenceChip =
    onInsertSelectionReference && selectionReference ? (
      commentTarget === selectionReference ? (
        <FileCommentBox
          allowEmpty
          className="absolute right-4 bottom-4 z-10 w-80 bg-background shadow-md"
          onSubmit={handleSelectionComment}
          onCancel={() => setCommentTarget(null)}
        />
      ) : (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="absolute right-4 bottom-4 z-10 gap-1.5 rounded-full shadow-md"
          onClick={() => setCommentTarget(selectionReference)}>
          <MessageSquareText size={14} />
          {t('agent.preview_pane.comment.submit')}
        </Button>
      )
    ) : null

  const renderOverlay = () => {
    if (!overlaySelection || treeRevealed) return null
    const isPane = props.headerVariant === 'pane'

    const overlayActions = (
      <>
        {/* Plugin toolbars (e.g. an attachment's Markdown/HTML preview-source toggle) portal into this slot. */}
        <FilePreviewToolbarPortalHost />
        {pickerToggle}
        {!paneSettings.autoSave && editMode === 'edit' && fileSession?.isDirty ? (
          <>
            <Button type="button" variant="ghost" size="sm" onClick={() => void handleDiscardFailedSave()}>
              {t('common.cancel')}
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={fileSession.isSaving}
              onClick={() => void handleRetryFailedSave()}>
              {t('common.save')}
            </Button>
          </>
        ) : null}
        {canToggleEdit ? (
          <Tooltip content={editToggleLabel} delay={800}>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className={TOOLBAR_BUTTON_CLASS}
              aria-label={editToggleLabel}
              onClick={() => onEditModeChange?.(editMode === 'edit' ? 'preview' : 'edit')}>
              {editMode === 'edit' ? <Eye size={16} /> : <SquarePen size={16} />}
            </Button>
          </Tooltip>
        ) : null}
        <OpenTargetButton targetPath={getArtifactPaneSelectionPath(overlaySelection)} pathKind="file" />
        {isPane ? null : (
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
        )}
      </>
    )

    return (
      <div
        ref={overlayRef}
        data-testid="artifact-file-preview-overlay"
        tabIndex={-1}
        onKeyDown={handleOverlayKeyDown}
        className="absolute inset-0 z-20 flex min-h-0 flex-col overflow-hidden bg-card text-card-foreground">
        <FilePreviewToolbarPortalProvider>
          <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border-subtle pr-2 pl-3">
            <div className="flex min-w-0 flex-1 items-center gap-1.5 text-sm font-medium text-foreground">
              {isPane || isSplit ? (
                <div className="flex min-w-0 cursor-context-menu font-normal">
                  <ArtifactPaneBreadcrumb
                    key={previewKey}
                    relativePath={getArtifactPaneSelectionRelativePath(workspacePath, overlaySelection)}
                    fallbackTitle={getPreviewFileTitle(overlaySelection)}
                    fullPath={getArtifactPaneSelectionPath(overlaySelection)}
                    rootEntries={model.filteredTree}
                    nodeById={model.nodeById}
                    onOpenFile={handleSelectedChange}
                    onLoadFolder={model.loadFolder}
                    fileMenuItems={fileMenuItems}
                    getFolderMenuItems={getFolderMenuItems}
                  />
                </div>
              ) : (
                <CommandContextMenu key={previewKey} location="webcontents.context" extraItems={fileMenuItems}>
                  <span className="cursor-context-menu truncate" title={getArtifactPaneSelectionPath(overlaySelection)}>
                    {getPreviewFileTitle(overlaySelection)}
                  </span>
                </CommandContextMenu>
              )}
              {isEditDirty && !isPane && (
                <span
                  className="size-1.5 shrink-0 rounded-full bg-warning"
                  aria-label={t('agent.preview_pane.edit.unsaved')}
                  title={t('agent.preview_pane.edit.unsaved')}
                />
              )}
            </div>
            <div className="ml-auto flex shrink-0 items-center gap-1">{overlayActions}</div>
          </div>
          {fileSession?.saveError && (
            <div
              role="alert"
              className="flex shrink-0 items-center gap-2 border-b border-error-border bg-error-subtle px-3 py-2 text-xs text-error-subtle-foreground">
              <AlertCircle className="size-4 shrink-0" />
              <span className="min-w-0 flex-1">
                {t(
                  fileSession.metadataRecoveryPending
                    ? 'agent.preview_pane.edit.metadata_pending'
                    : 'agent.preview_pane.edit.save_failed'
                )}
              </span>
              {!fileSession.metadataRecoveryPending && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={fileSession.isSaving}
                  onClick={() => void handleRetryFailedSave()}>
                  {t('common.retry')}
                </Button>
              )}
              <Button
                type="button"
                variant="destructive"
                size="sm"
                disabled={fileSession.isSaving}
                onClick={handleDiscardFailedSave}>
                {t('agent.preview_pane.edit.discard')}
              </Button>
            </div>
          )}
          <div data-file-edit className="relative min-h-0 flex-1 overflow-hidden">
            {editMode === 'edit' && fileSession?.status === 'ready' ? (
              <Suspense fallback={<LoadingState label={t('common.loading')} />}>
                <FileEditor
                  // Pierre measures tab stops when it attaches, so a tab-size change remounts the editor.
                  key={`${previewKey}:${fileSession.sessionId}:${fileSession.documentEpoch}:${paneSettings.tabSize}`}
                  sessionKey={`artifact:${previewKey}:${fileSession.sessionId}:${fileSession.documentEpoch}`}
                  readOnly={fileSession.readOnly}
                  value={fileSession.draft}
                  fileName={getPathBasename(overlaySelection.filePath)}
                  onChange={fileSession.setDraft}
                  wrapLines={paneSettings.wordWrap}
                  tabSize={paneSettings.tabSize}
                  tabIndent={paneSettings.tabIndent}
                  indentGuides={paneSettings.indentGuides}
                  showWhitespace={paneSettings.showWhitespace}
                  scrollPastEnd={paneSettings.scrollPastEnd}
                  onLineComment={onInsertSelectionReference ? handleLineComment : undefined}
                  className="h-full"
                />
              </Suspense>
            ) : editMode === 'edit' && fileSession?.status === 'loading' ? (
              <div className="flex h-full items-center justify-center">
                <LoadingState label={t('common.loading')} />
              </div>
            ) : (
              <>
                {previewContent}
                {selectionReferenceChip}
              </>
            )}
          </div>
        </FilePreviewToolbarPortalProvider>
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
          showFolderIcons={false}
          emptyState={
            <div className="px-2 py-3 text-xs text-muted-foreground">
              {treeErrorKeys
                ? t(treeErrorKeys.title)
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
      treeErrorKeys,
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

  if (treeErrorKeys && !overlaySelection) {
    return (
      <div
        ref={artifactPaneRef}
        className={cn(
          'flex h-full min-h-0 flex-col overflow-hidden bg-card text-card-foreground',
          maximized && 'rounded-lg border border-border-subtle shadow-sm'
        )}>
        {paneHeader}
        <EmptyState icon={AlertCircle} title={t(treeErrorKeys.title)} description={t(treeErrorKeys.description)} />
      </div>
    )
  }

  const treeAside = (
    <aside className={cn('flex h-full w-full flex-col overflow-hidden', isWide && !treePinned && 'hidden')}>
      <div
        data-artifact-file-tree-scroll-region
        className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-1.5 pb-[var(--chat-composer-inset,0px)]">
        {fileTreeContent}
      </div>
    </aside>
  )
  const fileColumn = (
    <>
      {isWide && !overlaySelection ? (
        <div className="flex h-full min-w-0 flex-1">
          <EmptyState
            icon={Folder}
            title={t('agent.preview_pane.no_file_selected.title')}
            description={t('agent.preview_pane.no_file_selected.description')}
          />
        </div>
      ) : null}
      {renderOverlay()}
    </>
  )

  return (
    <div
      ref={artifactPaneRef}
      className={cn(
        'flex h-full min-h-0 flex-col overflow-hidden text-card-foreground',
        maximized && 'rounded-lg border border-border-subtle shadow-sm'
      )}>
      {paneHeader}
      <div className="relative flex min-h-0 flex-1 overflow-hidden">
        {isSplit ? (
          // Swapping panel order inside a live group loops the layout, so a position change remounts it.
          <FilePaneSplit
            key={paneSettings.treePosition}
            treeOnRight={paneSettings.treePosition === 'right'}
            tree={treeAside}
            file={fileColumn}
            resizeLabel={t('agent.preview_pane.resize_tree')}
          />
        ) : (
          <>
            {treeAside}
            {fileColumn}
          </>
        )}
      </div>
      <ConfirmDialog
        open={staleConflictOpen}
        onOpenChange={(open) => {
          setStaleConflictOpen(open)
          if (open || conflictResolvedRef.current) return
          void handleKeepDraftAfterConflict()
        }}
        title={t('agent.preview_pane.edit.conflict.title')}
        description={t('agent.preview_pane.edit.conflict.description')}
        confirmText={t('agent.preview_pane.edit.conflict.reload')}
        cancelText={t('agent.preview_pane.edit.conflict.keep_draft')}
        destructive
        onConfirm={() => {
          // Close before the async reload so the dialog's auto-close cannot land
          // after a failure publish reset the guard.
          conflictResolvedRef.current = true
          setStaleConflictOpen(false)
          void handleReloadAfterConflict()
        }}
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
