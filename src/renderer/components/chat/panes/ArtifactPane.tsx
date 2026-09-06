import { Button, CodeEditor, ConfirmDialog, Tooltip } from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import { loggerService } from '@logger'
import { EmptyState, LoadingState } from '@renderer/components/chat/primitives'
import { CommandContextMenu, type CommandContextMenuExtraItem } from '@renderer/components/command'
import { FilePreview } from '@renderer/components/FilePreview'
import { FileTree, type FileTreeNode } from '@renderer/components/FileTree'
import { loadOpenTargetMenuItems, OpenTargetButton } from '@renderer/components/OpenTarget'
import { useCmTheme } from '@renderer/hooks/useCodeStyle'
import {
  FILE_EDIT_MAX_SIZE_BYTES as ARTIFACT_PREVIEW_MAX_SIZE_BYTES,
  type FileEditSession
} from '@renderer/hooks/useFileEditSession'
import { useFileSize } from '@renderer/hooks/useFileSize'
import { useIsTextFile } from '@renderer/hooks/useIsTextFile'
import { toast } from '@renderer/services/toast'
import { getFileExtension } from '@renderer/utils/file'
import { isFilesystemRoot, joinPath } from '@renderer/utils/path'
import { isWin } from '@renderer/utils/platform'
import { AbsoluteFilePathSchema } from '@shared/types/file'
import { AlertCircle, ArrowLeft, Copy, CopySlash, Eye, RotateCw, Sparkles, SquarePen, X } from 'lucide-react'
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import { useTranslation } from 'react-i18next'

import {
  type ArtifactPaneFileSelection,
  getArtifactPaneSelectionPath,
  getCopyableAbsolutePath,
  WORKSPACE_ROOT_ID
} from './artifactPanePath'
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

/** Files above this size skip text preview (and `readText`) — Shiki tokenize gets unusable past ~2MB. */
const ARTIFACT_PREVIEW_MAX_SIZE_LABEL = '2 MB'

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

const OPEN_TARGET_LOOKUP_TIMEOUT_MS = 1_000

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
  const activeCmTheme = useCmTheme(editMode === 'edit')
  const artifactPaneRef = useRef<HTMLDivElement>(null)
  const overlayRef = useRef<HTMLDivElement>(null)
  const [contentRefreshToken, setContentRefreshToken] = useState(0)
  const [knownFileSizeBytes, setKnownFileSizeBytes] = useState<number | undefined>(undefined)
  const [staleConflictOpen, setStaleConflictOpen] = useState(false)
  // Destructure the stable callbacks so effect/callback deps don't have to
  // list the whole `model` (a fresh object every render).
  const { refresh, reloadExpandedDirectories } = model

  const trimmedFileSearch = enableFileSearch ? searchKeyword.trim() : ''
  const previewSelectionWorkspacePath = previewFileSelection?.workspacePath
  const parsedPreviewWorkspacePath = useMemo(
    () => (previewSelectionWorkspacePath ? AbsoluteFilePathSchema.safeParse(previewSelectionWorkspacePath) : null),
    [previewSelectionWorkspacePath]
  )
  const isPreviewWorkspaceRoot =
    parsedPreviewWorkspacePath?.success && isFilesystemRoot(parsedPreviewWorkspacePath.data)
  const hasInvalidPreviewSelection = Boolean(
    previewFileSelection && (!parsedPreviewWorkspacePath?.success || isPreviewWorkspaceRoot)
  )
  const validPreviewFileSelection =
    parsedPreviewWorkspacePath?.success && !isPreviewWorkspaceRoot ? previewFileSelection : null
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
  const overlayWorkspacePath = overlaySelection?.workspacePath
  const overlayFilePath = overlaySelection?.filePath
  const previewWorkspacePath = overlayWorkspacePath ?? (hasInvalidWorkspacePath ? undefined : workspacePath)
  const previewFilePath = overlayFilePath ?? selectedFile
  const previewKey = `${previewWorkspacePath ?? ''}\0${previewFilePath ?? ''}`
  const previousPreviewKeyRef = useRef(previewKey)

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

  const isText = useIsTextFile(previewWorkspacePath, previewFilePath)
  const fileSize = useFileSize(previewWorkspacePath, previewFilePath, contentRefreshToken, knownFileSizeBytes)
  const hasActiveEditSession = editMode === 'edit' && fileSession?.status === 'ready'
  const canEditSelection =
    Boolean(fileSession && overlaySelection) &&
    isText === 'text' &&
    (hasActiveEditSession || (fileSize.status === 'ok' && fileSize.size <= ARTIFACT_PREVIEW_MAX_SIZE_BYTES))
  const isEditDirty = fileSession?.isDirty ?? false

  useEffect(() => {
    if (previousPreviewKeyRef.current === previewKey) return
    previousPreviewKeyRef.current = previewKey
    setContentRefreshToken(0)
    setKnownFileSizeBytes(undefined)
    setStaleConflictOpen(false)
  }, [previewKey])

  // Successful writes return an exact byte size through the edit session.
  // Invalidate the separate metadata gate whenever that size changes so a
  // saved file that crosses the preview limit cannot reuse stale metadata.
  useEffect(() => {
    if (fileSession?.savedSizeBytes === undefined) return
    setKnownFileSizeBytes(fileSession.savedSizeBytes)
    setContentRefreshToken((value) => value + 1)
  }, [fileSession?.savedSizeBytes])

  // Surface an external-change conflict (a stale autosave) as the reload dialog.
  useEffect(() => {
    if (fileSession?.conflict) setStaleConflictOpen(true)
  }, [fileSession?.conflict])

  // A file that cannot be edited in place (binary / oversize) can't enter edit
  // mode — toast why and fall back to preview.
  useEffect(() => {
    if (editMode !== 'edit' || fileSession?.status !== 'unsupported') return
    if (fileSession.unsupportedReason === 'size') {
      setContentRefreshToken((value) => value + 1)
    }
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

  // Depend on the session's stable `reload` callback, not the session object —
  // the object changes on every keystroke and would drag the whole toolbar /
  // file-tree memo chain below with it.
  const fileSessionReload = fileSession?.reload
  const fileSessionFlush = fileSession?.flush
  const fileSessionDiscard = fileSession?.discard
  const editorLoading = fileSession?.status === 'loading'
  // Menu items outlive their opening render (the portal stays up across
  // renders), so every value they read at click time must live in a ref.
  const editModeRef = useRef(editMode)
  editModeRef.current = editMode
  const editorLoadingRef = useRef(editorLoading)
  editorLoadingRef.current = editorLoading
  const canEditSelectionRef = useRef(canEditSelection)
  canEditSelectionRef.current = canEditSelection
  const isEditDirtyRef = useRef(isEditDirty)
  isEditDirtyRef.current = isEditDirty
  const fileSessionReloadRef = useRef(fileSessionReload)
  fileSessionReloadRef.current = fileSessionReload
  const overlayPathsRef = useRef<{ filePath?: string; workspacePath?: string }>({})
  overlayPathsRef.current = { filePath: overlayFilePath, workspacePath: overlayWorkspacePath }
  const handleRefresh = useCallback(() => {
    refresh()
    reloadExpandedDirectories()
    const { filePath, workspacePath } = overlayPathsRef.current
    if (workspacePath && filePath) {
      setContentRefreshToken((value) => value + 1)
    }
    const reload = fileSessionReloadRef.current
    if (editModeRef.current === 'edit' && reload && !isEditDirtyRef.current) {
      void reload().catch((error: unknown) => {
        logger.error('Failed to refresh editable file snapshot', error as Error)
        toast.error(t('agent.preview_pane.edit.refresh_failed'))
      })
    }
  }, [refresh, reloadExpandedDirectories, t])

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

  const getFileTreeMenuItems = useCallback(
    async (node: FileTreeNode): Promise<readonly CommandContextMenuExtraItem[]> => {
      const targetPath = getFileTreeNodeTargetPath(workspacePath, node)
      if (!targetPath) return []

      const copyItems: CommandContextMenuExtraItem[] = [
        { type: 'separator' },
        {
          type: 'item',
          id: 'copy-path',
          label: t('agent.preview_pane.copy_path'),
          icon: <Copy size={16} />,
          onSelect: () => void copyPath(getCopyableAbsolutePath(targetPath, isWin))
        }
      ]
      if (node.id !== WORKSPACE_ROOT_ID) {
        copyItems.push({
          type: 'item',
          id: 'copy-relative-path',
          label: t('agent.preview_pane.copy_relative_path'),
          icon: <CopySlash size={16} />,
          onSelect: () => void copyPath(node.id)
        })
      }

      const openItems = await loadOpenTargetMenuItems({
        targetPath,
        pathKind: node.kind === 'file' ? 'file' : 'directory',
        t
      })
      return [...openItems, ...copyItems]
    },
    [copyPath, t, workspacePath]
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
          {workspacePath && !hasInvalidWorkspacePath ? (
            <OpenTargetButton targetPath={workspacePath} pathKind="directory" />
          ) : null}
        </div>
      ),
    [hasInvalidWorkspacePath, props.headerVariant, refreshButton, workspacePath]
  )

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

  const nextEditorMode = editMode === 'preview' ? 'edit' : 'preview'
  const modeActionLabel = t(nextEditorMode === 'edit' ? 'common.edit' : 'common.preview')
  const ModeActionIcon = nextEditorMode === 'edit' ? SquarePen : Eye

  // Header right-click menu: synchronous tab actions as baseline, best-effort async open targets.
  // The items factory snapshots display state but reads refs at click time so portals never act stale.
  const buildTabActionItems = useCallback(
    (snapshot?: {
      canEditSelection?: boolean
      editMode?: 'preview' | 'edit'
      editorLoading?: boolean
    }): CommandContextMenuExtraItem[] => {
      const canEdit = snapshot?.canEditSelection ?? canEditSelectionRef.current
      const currentMode = snapshot?.editMode ?? editModeRef.current
      const isLoading = snapshot?.editorLoading ?? editorLoadingRef.current
      // Label and action must promise the same thing: navigate to the mode this
      // item was built for, even if the toolbar toggled while the menu was open.
      const targetMode = currentMode === 'preview' ? 'edit' : 'preview'
      const label = t(targetMode === 'edit' ? 'common.edit' : 'common.preview')
      const ModeIcon = targetMode === 'edit' ? SquarePen : Eye
      return [
        ...(canEdit
          ? [
              {
                type: 'item' as const,
                id: 'artifact-pane.overlay.toggle-edit-mode',
                label,
                icon: <ModeIcon size={14} />,
                enabled: !isLoading,
                onSelect: () => {
                  if (editorLoadingRef.current) return
                  handleEditorModeChange(targetMode)
                }
              }
            ]
          : []),
        {
          type: 'item' as const,
          id: 'artifact-pane.overlay.refresh',
          label: t('agent.preview_pane.refresh'),
          icon: <RotateCw size={14} />,
          onSelect: handleRefresh
        },
        { type: 'separator' },
        {
          type: 'item' as const,
          id: 'artifact-pane.overlay.close',
          label: t('agent.preview_pane.close'),
          icon: <X size={14} />,
          onSelect: handleClosePreview
        }
      ]
    },
    [handleClosePreview, handleEditorModeChange, handleRefresh, t]
  )

  // Pending baseline rendered synchronously while open targets resolve; the
  // menus are disabled without a selection, so skip building items entirely.
  const tabActionItems = useMemo(
    () => (overlaySelection ? buildTabActionItems({ canEditSelection, editMode, editorLoading }) : []),
    [buildTabActionItems, canEditSelection, editMode, editorLoading, overlaySelection]
  )

  // Open-target items can outlive their opening render (the menu stays open
  // across file switches), so drop them when the selection changed mid-flight.
  const currentPreviewKeyRef = useRef(previewKey)
  currentPreviewKeyRef.current = previewKey

  const getOverlayMenuItems = useCallback(async (): Promise<readonly CommandContextMenuExtraItem[]> => {
    if (!overlaySelection) return []
    let openTargetItems: readonly CommandContextMenuExtraItem[] = []
    try {
      const targetPath = getArtifactPaneSelectionPath(overlaySelection)
      const timeoutPromise = new Promise<readonly CommandContextMenuExtraItem[]>((resolve) =>
        setTimeout(() => resolve([]), OPEN_TARGET_LOOKUP_TIMEOUT_MS)
      )
      openTargetItems = await Promise.race([
        loadOpenTargetMenuItems({ targetPath, pathKind: 'file', t }),
        timeoutPromise
      ])
    } catch (error) {
      logger.warn('Failed to resolve open targets for the opened-file header menu', error as Error)
    }
    // Selection changed mid-flight: the resolved items point at the previous
    // path, so rebuild the baseline from live refs instead.
    if (currentPreviewKeyRef.current !== previewKey) return buildTabActionItems()
    return [
      ...openTargetItems,
      ...(openTargetItems.length ? [{ type: 'separator' } as const] : []),
      ...buildTabActionItems()
    ]
  }, [buildTabActionItems, overlaySelection, previewKey, t])

  const paneHeader =
    props.headerVariant === 'pane' ? (
      <div
        data-testid="artifact-pane-header"
        className="flex h-(--navbar-height) shrink-0 items-center justify-between gap-2 border-border-subtle border-b bg-card px-2 [-webkit-app-region:no-drag]">
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
            <CommandContextMenu
              key={previewKey}
              location="webcontents.context"
              disabled={!overlaySelection}
              pendingExtraItems={tabActionItems}
              getExtraItems={getOverlayMenuItems}>
              <div
                data-testid="artifact-pane-header-title"
                className={cn(
                  'min-w-0 flex-1 select-none truncate font-medium text-foreground text-sm',
                  overlaySelection && 'cursor-context-menu'
                )}
                title={overlaySelection ? getArtifactPaneSelectionPath(overlaySelection) : undefined}>
                {overlaySelection ? getPreviewFileTitle(overlaySelection.filePath) : props.paneTitle}
              </div>
            </CommandContextMenu>
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
              <OpenTargetButton
                targetPath={overlaySelection ? getArtifactPaneSelectionPath(overlaySelection) : previewWorkspacePath}
                pathKind={overlaySelection ? 'file' : 'directory'}
              />
              {refreshButton}
              <div className="mx-0.5 h-4 w-px bg-border-subtle" aria-hidden="true" />
            </>
          ) : null}
          {props.paneActions}
        </div>
      </div>
    ) : null

  const previewContent = overlaySelection ? (
    <FilePreview
      filePath={getArtifactPaneSelectionPath(overlaySelection)}
      refreshKey={contentRefreshToken}
      type="artifact"
    />
  ) : null

  const renderOverlay = () => {
    if (!overlaySelection) return null

    const overlayActions = (
      <>
        <OpenTargetButton targetPath={getArtifactPaneSelectionPath(overlaySelection)} pathKind="file" />
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
              <CommandContextMenu
                key={previewKey}
                location="webcontents.context"
                disabled={!overlaySelection}
                pendingExtraItems={tabActionItems}
                getExtraItems={getOverlayMenuItems}>
                <span className="cursor-context-menu truncate" title={getArtifactPaneSelectionPath(overlaySelection)}>
                  {getPreviewFileTitle(overlaySelection.filePath)}
                </span>
              </CommandContextMenu>
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
            className="flex shrink-0 items-center gap-2 border-error-border border-b bg-error-subtle px-3 py-2 text-error-subtle-foreground text-xs">
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
        {/* The inset pads inside the editor's scroll container (not this wrapper) so the
            editor runs full height under the elevated composer with trailing scroll room. */}
        <div className="min-h-0 flex-1 overflow-hidden [&_.cm-scroller]:pb-[var(--chat-composer-inset,0px)]">
          {canEditSelection && editMode === 'edit' && fileSession?.status === 'ready' ? (
            <CodeEditor
              key={previewKey}
              value={fileSession.draft}
              language={getFileExtension(overlaySelection.filePath)}
              theme={activeCmTheme}
              onChange={(content) => fileSession.setDraft(content)}
              height="100%"
              expanded={false}
              wrapped
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
          <div
            data-artifact-file-tree-scroll-region
            className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden pb-[var(--chat-composer-inset,0px)]">
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
