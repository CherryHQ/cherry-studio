import { Button, CodeEditor, ConfirmDialog, EmptyState, SegmentedControl, Skeleton } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { FilePreview } from '@renderer/components/FilePreview'
import { FileTree, type FileTreeNode } from '@renderer/components/FileTree'
import { useCodeStyle } from '@renderer/hooks/useCodeStyle'
import { useDirectoryTree } from '@renderer/hooks/useDirectoryTree'
import { useFileEditSession } from '@renderer/hooks/useFileEditSession'
import { ipcApi } from '@renderer/ipc'
import { toast } from '@renderer/services/toast'
import { type AbsoluteFilePath, AbsoluteFilePathSchema } from '@shared/types/file'
import { createFilePathHandle, type TreeDir, type TreeMutationEvent, type TreeNode } from '@shared/utils/file'
import { useBlocker } from '@tanstack/react-router'
import { AlertTriangle, Check, FileText, Loader2, RotateCcw } from 'lucide-react'
import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

const logger = loggerService.withContext('SkillFileBrowser')
const MARKDOWN_EXTENSIONS = new Set(['md', 'mdx', 'markdown'])

interface Props {
  rootPath: AbsoluteFilePath
  skillId: string
  access: 'read_only' | 'read_write'
  disabled?: boolean
}

export interface SkillFileBrowserHandles {
  flush: () => Promise<void>
}

function isMarkdownFile(filePath: string): boolean {
  const extension = filePath.split('.').pop()?.toLowerCase() ?? ''
  return MARKDOWN_EXTENSIONS.has(extension)
}

function getEditorLanguage(filePath: string): string {
  return filePath.split('.').pop()?.toLowerCase() || 'text'
}

function projectNode(node: TreeNode): FileTreeNode | null {
  if (node.basename === 'node_modules') return null
  if (node.isTreeFile()) {
    return { id: node.path, name: node.basename, kind: 'file', path: node.path }
  }
  if (!node.isTreeDir()) return null

  const children = Object.values(node.children)
    .map(projectNode)
    .filter((child): child is FileTreeNode => child !== null)
  return { id: node.path, name: node.basename, kind: 'folder', path: node.path, children }
}

function projectTree(root: TreeDir): FileTreeNode[] {
  return Object.values(root.children)
    .map(projectNode)
    .filter((node): node is FileTreeNode => node !== null)
}

function collectFiles(nodes: FileTreeNode[], files = new Set<string>()): Set<string> {
  for (const node of nodes) {
    if (node.kind === 'file') files.add(node.path)
    if (node.children) collectFiles(node.children, files)
  }
  return files
}

function findInitialFile(nodes: FileTreeNode[]): string | null {
  const rootSkillFile = nodes.find((node) => node.kind === 'file' && node.name.toLowerCase() === 'skill.md')
  if (rootSkillFile) return rootSkillFile.path

  for (const node of nodes) {
    if (node.kind === 'file') return node.path
    const child = node.children ? findInitialFile(node.children) : null
    if (child) return child
  }
  return null
}

export const SkillFileBrowser = function SkillFileBrowser({
  ref,
  rootPath,
  skillId,
  access,
  disabled = false
}: Props & { ref?: React.RefObject<SkillFileBrowserHandles | null> }) {
  const { t } = useTranslation()
  const { activeCmTheme } = useCodeStyle()
  const [expandedIds, setExpandedIds] = useState<ReadonlySet<string>>(new Set())
  const [selectedFile, setSelectedFile] = useState<AbsoluteFilePath | null>(null)
  const [pendingFile, setPendingFile] = useState<AbsoluteFilePath | null>(null)
  const [viewMode, setViewMode] = useState<'preview' | 'edit'>('preview')
  const [syncError, setSyncError] = useState<Error | null>(null)
  const [isSyncing, setIsSyncing] = useState(false)
  const [previewRevision, setPreviewRevision] = useState(0)

  const editableHandle = useMemo(
    () => (access === 'read_write' && selectedFile ? createFilePathHandle(selectedFile) : undefined),
    [access, selectedFile]
  )
  const fileSession = useFileEditSession(editableHandle)
  const notifyExternalChange = fileSession.notifyExternalChange
  const reloadFile = fileSession.reload
  const keepCurrentDraft = fileSession.keepDraft
  const selectedFileRef = useRef<AbsoluteFilePath | null>(selectedFile)
  selectedFileRef.current = selectedFile
  const reconcileChainRef = useRef<Promise<void>>(Promise.resolve())

  const reconcileSkill = useCallback((): Promise<void> => {
    const task = reconcileChainRef.current
      .catch(() => undefined)
      .then(() => ipcApi.request('skill.reconcile', { skillId }))
    reconcileChainRef.current = task
    setIsSyncing(true)
    void task.then(
      () => {
        if (reconcileChainRef.current === task) setSyncError(null)
      },
      (error) => {
        if (reconcileChainRef.current !== task) return
        const normalized = error instanceof Error ? error : new Error(String(error))
        logger.error('Failed to reconcile edited Skill', normalized, { skillId })
        setSyncError(normalized)
      }
    )
    const finish = () => {
      if (reconcileChainRef.current === task) setIsSyncing(false)
    }
    void task.then(finish, finish)
    return task
  }, [skillId])

  const handleTreeMutation = useCallback(
    (event: TreeMutationEvent) => {
      if (access !== 'read_write') return
      const activePath = selectedFileRef.current
      if (event.type === 'updated' && activePath === event.path) {
        notifyExternalChange(event.stats.mtime)
        return
      }
      void reconcileSkill().catch(() => undefined)
    },
    [access, notifyExternalChange, reconcileSkill]
  )

  const { root, version, isLoading, error } = useDirectoryTree(rootPath, undefined, handleTreeMutation)
  const tree = useMemo(() => {
    void version
    return root ? projectTree(root) : []
  }, [root, version])
  const filePaths = useMemo(() => collectFiles(tree), [tree])

  useEffect(() => {
    if (!selectedFile) {
      const initialFile = findInitialFile(tree)
      if (initialFile) {
        const next = AbsoluteFilePathSchema.parse(initialFile)
        setSelectedFile(next)
        setViewMode(isMarkdownFile(next) ? 'preview' : 'edit')
      }
      return
    }
    if (filePaths.has(selectedFile) || fileSession.isDirty || fileSession.conflict) return
    const initialFile = findInitialFile(tree)
    const next = initialFile ? AbsoluteFilePathSchema.parse(initialFile) : null
    setSelectedFile(next)
    setViewMode(next && !isMarkdownFile(next) ? 'edit' : 'preview')
  }, [filePaths, fileSession.conflict, fileSession.isDirty, selectedFile, tree])

  const observedSaveRef = useRef<{ path: string; content: string } | null>(null)
  useEffect(() => {
    observedSaveRef.current = null
  }, [selectedFile])
  useEffect(() => {
    if (!selectedFile || fileSession.status !== 'ready') return
    const observed = observedSaveRef.current
    if (!observed || observed.path !== selectedFile) {
      observedSaveRef.current = { path: selectedFile, content: fileSession.savedContent }
      return
    }
    if (observed.content === fileSession.savedContent) return
    observedSaveRef.current = { path: selectedFile, content: fileSession.savedContent }
    setPreviewRevision((current) => current + 1)
    void reconcileSkill().catch(() => undefined)
  }, [fileSession.savedContent, fileSession.status, reconcileSkill, selectedFile])

  const flush = useCallback(async () => {
    if (access !== 'read_write' || !selectedFile) return
    const shouldReconcile = fileSession.isDirty || fileSession.saveError !== undefined || syncError !== null
    await fileSession.flush()
    if (shouldReconcile) await reconcileSkill()
    else await reconcileChainRef.current
  }, [access, fileSession, reconcileSkill, selectedFile, syncError])

  useImperativeHandle(ref, () => ({ flush }), [flush])

  const shouldGuardNavigation =
    access === 'read_write' &&
    (fileSession.isDirty ||
      fileSession.isSaving ||
      fileSession.conflict ||
      fileSession.saveError !== undefined ||
      isSyncing ||
      syncError !== null)
  const flushRef = useRef(flush)
  flushRef.current = flush
  const blocker = useBlocker({
    shouldBlockFn: async () => {
      try {
        await flushRef.current()
        return false
      } catch {
        return true
      }
    },
    enableBeforeUnload: () => shouldGuardNavigation,
    disabled: !shouldGuardNavigation,
    withResolver: true
  })

  const selectFile = useCallback(
    async (nextFile: AbsoluteFilePath) => {
      if (nextFile === selectedFile || disabled) return
      try {
        await flush()
        setSelectedFile(nextFile)
        setViewMode(isMarkdownFile(nextFile) ? 'preview' : 'edit')
      } catch {
        setPendingFile(nextFile)
      }
    },
    [disabled, flush, selectedFile]
  )

  const discardAndSelectPending = useCallback(() => {
    const nextFile = pendingFile
    fileSession.discard()
    setSyncError(null)
    setPendingFile(null)
    if (nextFile) {
      setSelectedFile(nextFile)
      setViewMode(isMarkdownFile(nextFile) ? 'preview' : 'edit')
    }
  }, [fileSession, pendingFile])

  const retryPendingSelection = useCallback(async () => {
    const nextFile = pendingFile
    if (!nextFile) return
    try {
      await flush()
      setPendingFile(null)
      setSelectedFile(nextFile)
      setViewMode(isMarkdownFile(nextFile) ? 'preview' : 'edit')
    } catch (error) {
      logger.error('Failed to save Skill file before switching files', error as Error, { skillId, selectedFile })
      toast.error(t('settings.skills.editor.saveFailed'))
    }
  }, [flush, pendingFile, selectedFile, skillId, t])

  const reloadConflictedFile = useCallback(async () => {
    try {
      await reloadFile()
    } catch (error) {
      logger.error('Failed to reload conflicted Skill file', error as Error, { skillId, selectedFile })
      toast.error(t('library.skill_detail.file_load_failed'))
    }
  }, [reloadFile, selectedFile, skillId, t])

  const saveCurrentDraft = useCallback(async () => {
    try {
      await keepCurrentDraft()
    } catch (error) {
      logger.error('Failed to save the current Skill draft', error as Error, { skillId, selectedFile })
      toast.error(t('settings.skills.editor.saveFailed'))
    }
  }, [keepCurrentDraft, selectedFile, skillId, t])

  if (isLoading) {
    return (
      <div className="flex h-full min-h-0 flex-1 flex-col gap-3 lg:grid lg:grid-cols-[14rem_minmax(0,1fr)]">
        <Skeleton className="h-40 shrink-0 rounded-lg lg:h-full" />
        <Skeleton className="min-h-0 flex-1 rounded-lg" />
      </div>
    )
  }

  if (error) {
    return (
      <EmptyState
        preset="no-resource"
        title={t('library.skill_detail.no_files')}
        description={error.message}
        className="min-h-80"
      />
    )
  }

  const selectedFileName = selectedFile?.split('/').pop() ?? ''
  const selectedIsMarkdown = selectedFile ? isMarkdownFile(selectedFile) : false
  const canEdit = access === 'read_write' && fileSession.status === 'ready'
  let saveStatus = t('settings.skills.editor.saved')
  let statusIcon = <Check className="size-3.5" aria-hidden />
  if (fileSession.conflict) {
    saveStatus = t('settings.skills.editor.conflict')
    statusIcon = <AlertTriangle className="size-3.5" aria-hidden />
  } else if (fileSession.saveError) {
    saveStatus = t('settings.skills.editor.saveFailed')
    statusIcon = <AlertTriangle className="size-3.5" aria-hidden />
  } else if (syncError) {
    saveStatus = t('settings.skills.editor.syncFailed')
    statusIcon = <AlertTriangle className="size-3.5" aria-hidden />
  } else if (fileSession.isSaving || fileSession.isDirty) {
    saveStatus = t('settings.skills.editor.saving')
    statusIcon = <Loader2 className="size-3.5 animate-spin" aria-hidden />
  } else if (isSyncing) {
    saveStatus = t('settings.skills.editor.syncing')
    statusIcon = <Loader2 className="size-3.5 animate-spin" aria-hidden />
  } else if (fileSession.status === 'unsupported') {
    saveStatus =
      fileSession.unsupportedReason === 'mixed-line-endings'
        ? t('settings.skills.editor.unsupported.mixed-line-endings')
        : fileSession.unsupportedReason === 'size'
          ? t('settings.skills.editor.unsupported.size')
          : t('settings.skills.editor.unsupported.encoding')
    statusIcon = <AlertTriangle className="size-3.5" aria-hidden />
  } else if (fileSession.status === 'error') {
    saveStatus = t('settings.skills.editor.loadFailed')
    statusIcon = <AlertTriangle className="size-3.5" aria-hidden />
  }
  const showRecovery = fileSession.conflict || syncError !== null
  const previewHeader = (
    <>
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <FileText className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        <span className="truncate font-medium text-foreground text-sm">
          {selectedFileName || t('library.skill_detail.select_file')}
        </span>
        {access === 'read_write' && !showRecovery ? (
          <span
            role="status"
            aria-live="polite"
            className="flex min-w-0 items-center gap-1.5 text-muted-foreground text-xs">
            {statusIcon}
            <span className="truncate">{saveStatus}</span>
          </span>
        ) : null}
      </div>
      {canEdit ? (
        <SegmentedControl
          size="sm"
          aria-label={t('preview.label')}
          disabled={disabled}
          value={viewMode}
          onValueChange={setViewMode}
          options={[
            { value: 'preview', label: t('settings.skills.editor.preview') },
            { value: 'edit', label: t('settings.skills.editor.edit') }
          ]}
          className="shrink-0 rounded-md [&>button]:rounded-sm"
        />
      ) : null}
    </>
  )
  const customPreviewHeader = (
    <div className="relative flex h-11 min-h-11 shrink-0 items-center gap-2 px-3 after:pointer-events-none after:absolute after:right-3 after:bottom-0 after:left-3 after:border-border after:border-b after:content-['']">
      {previewHeader}
    </div>
  )

  return (
    <>
      <div
        data-ui="skill-file-workspace"
        className="flex h-full min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-hidden lg:grid lg:grid-cols-[14rem_minmax(0,1fr)]">
        <div className="flex h-40 min-h-0 shrink-0 flex-col overflow-hidden rounded-lg bg-background-subtle lg:h-full">
          <div className="flex h-10 shrink-0 items-center px-3 font-medium text-muted-foreground text-xs">
            {t('library.skill_detail.source_files')}
          </div>
          <div className="min-h-0 flex-1 overflow-hidden">
            {tree.length === 0 ? (
              <div className="flex h-full items-center justify-center px-4 text-center text-foreground-tertiary text-xs">
                {t('library.skill_detail.no_files')}
              </div>
            ) : (
              <FileTree
                nodes={tree}
                ariaLabel={t('library.skill_detail.source_files')}
                expandedIds={expandedIds}
                onExpandedChange={setExpandedIds}
                selectedId={selectedFile}
                onSelectedChange={(id) => {
                  if (id && filePaths.has(id)) void selectFile(AbsoluteFilePathSchema.parse(id))
                }}
                stickyFolders={false}
              />
            )}
          </div>
        </div>

        <div className="flex min-h-0 min-w-0 flex-col gap-2 overflow-hidden">
          <div className="min-h-0 flex-1 overflow-hidden rounded-lg bg-background-subtle">
            {selectedFile ? (
              viewMode === 'edit' && canEdit ? (
                <div className="flex h-full min-h-0 flex-col">
                  {customPreviewHeader}
                  <CodeEditor
                    value={fileSession.draft}
                    language={getEditorLanguage(selectedFile)}
                    onChange={fileSession.setDraft}
                    expanded={false}
                    height="100%"
                    theme={activeCmTheme}
                    editable={!disabled}
                    readOnly={disabled}
                    options={{ keymap: true }}
                    className="min-h-0 flex-1"
                  />
                </div>
              ) : viewMode === 'edit' && fileSession.status === 'loading' ? (
                <div className="flex h-full min-h-0 flex-col">
                  {customPreviewHeader}
                  <div className="space-y-3 p-4">
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-4 w-5/6" />
                    <Skeleton className="h-4 w-2/3" />
                  </div>
                </div>
              ) : (
                <FilePreview
                  filePath={selectedFile}
                  header={previewHeader}
                  refreshKey={version + previewRevision}
                  type={selectedIsMarkdown ? 'artifact' : 'file'}
                />
              )
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-2 text-foreground-tertiary">
                <FileText className="size-7" strokeWidth={1.2} aria-hidden />
                <span className="text-xs">{t('library.skill_detail.select_file')}</span>
              </div>
            )}
          </div>
          {access === 'read_write' && showRecovery ? (
            <div
              role="status"
              aria-live="polite"
              className="flex min-h-10 shrink-0 items-center gap-2 rounded-lg bg-warning-subtle px-3 text-warning-subtle-foreground text-xs">
              {statusIcon}
              <span>{saveStatus}</span>
              {fileSession.conflict ? (
                <div className="ml-auto flex items-center gap-1">
                  <Button variant="ghost" size="sm" onClick={() => void reloadConflictedFile()}>
                    {t('settings.skills.editor.reload')}
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => void saveCurrentDraft()}>
                    {t('settings.skills.editor.keepDraft')}
                  </Button>
                </div>
              ) : (
                <Button variant="ghost" size="sm" className="ml-auto" onClick={() => void reconcileSkill()}>
                  <RotateCcw className="size-3.5" aria-hidden />
                  {t('common.retry')}
                </Button>
              )}
            </div>
          ) : null}
        </div>
      </div>

      <ConfirmDialog
        open={pendingFile !== null}
        onOpenChange={(open) => {
          if (!open) setPendingFile(null)
        }}
        title={t('settings.skills.editor.leaveBlockedTitle')}
        description={t('settings.skills.editor.leaveBlockedDescription')}
        confirmText={t('common.retry')}
        cancelText={t('settings.skills.editor.keepDraft')}
        onConfirm={retryPendingSelection}
        content={
          <Button variant="destructive" disabled={fileSession.isSaving || isSyncing} onClick={discardAndSelectPending}>
            {t('settings.skills.editor.discardAndContinue')}
          </Button>
        }
      />

      <ConfirmDialog
        open={blocker.status === 'blocked'}
        onOpenChange={(open) => {
          if (!open && blocker.status === 'blocked') blocker.reset()
        }}
        title={t('settings.skills.editor.leaveBlockedTitle')}
        description={t('settings.skills.editor.leaveBlockedDescription')}
        confirmText={t('common.retry')}
        cancelText={t('settings.skills.editor.keepDraft')}
        onConfirm={async () => {
          if (blocker.status !== 'blocked') return
          try {
            await flushRef.current()
            blocker.proceed()
          } catch (error) {
            logger.error('Failed to save Skill file before navigation', error as Error, { skillId, selectedFile })
            toast.error(t('settings.skills.editor.saveFailed'))
          }
        }}
        content={
          <Button
            variant="destructive"
            disabled={fileSession.isSaving || isSyncing}
            onClick={() => {
              if (blocker.status !== 'blocked') return
              fileSession.discard()
              setSyncError(null)
              blocker.proceed()
            }}>
            {t('settings.skills.editor.discardAndContinue')}
          </Button>
        }
      />
    </>
  )
}
