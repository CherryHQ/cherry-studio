import {
  Button,
  Checkbox,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EmptyState,
  Scrollbar
} from '@cherrystudio/ui'
import { useInfiniteFlatItems, useInfiniteQuery, useQuery } from '@data/hooks/useDataApi'
import { loggerService } from '@logger'
import { ipcApi } from '@renderer/ipc'
import { safeOpen } from '@renderer/utils/file/safeOpen'
import { isMac } from '@renderer/utils/platform'
import type { FileEntry, FileEntryId } from '@shared/data/types/file'
import type { OutputFor } from '@shared/ipc/types'
import type { FilePath, FileType } from '@shared/types/file'
import { createFileEntryHandle, getFileTypeByExt, toSafeFileUrl } from '@shared/utils/file'
import { MoreHorizontal, Upload } from 'lucide-react'
import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { FileContextMenuActions } from './FileContextMenu'
import type { FileItem } from './fileDisplay'
import { formatFileSize } from './fileDisplay'
import { FileGrid } from './FileGrid'
import type { SortDir, SortKey } from './FileList'
import { FileList } from './FileList'
import type { SidebarFilter } from './FileSidebar'
import { FileSidebar } from './FileSidebar'

const logger = loggerService.withContext('FilesPage')
const FILES_PAGE_LIMIT = 100

type ServerSortKey = 'name' | 'size' | 'updatedAt' | 'ext'
type FileMetadataById = OutputFor<'file.batch_get_metadata'>
type PhysicalPathById = OutputFor<'file.batch_get_physical_paths'>
type DanglingStateById = OutputFor<'file.batch_get_dangling_states'>
type BatchCreateInternalEntriesResult = OutputFor<'file.batch_create_internal_entries'>
type FileBatchMutationResult = OutputFor<'file.batch_trash'>
type FileBatchRoute = 'file.batch_get_metadata' | 'file.batch_get_physical_paths' | 'file.batch_get_dangling_states'
type FileBatchMutationRoute = 'file.batch_trash' | 'file.batch_permanent_delete'

// Renderer-side chunk size for splitting large id lists into multiple IPC calls.
// This is a batching knob, not the schema cap itself; it only needs to stay at
// or below the per-request limit enforced by the shared file IPC schemas.
// Renderer intentionally avoids importing the schema registry here because
// schemas are main/preload IPC runtime contracts, not renderer dependencies.
const FILE_IPC_BATCH_SIZE = 500
// Keep at or below `FILE_IPC_MAX_BATCH_CREATE_ITEMS` from the IPC schema.
const FILE_IPC_CREATE_BATCH_SIZE = 100

async function requestBatchedFileRecords<Route extends FileBatchRoute>(
  route: Route,
  ids: readonly FileEntryId[]
): Promise<OutputFor<Route>> {
  if (ids.length === 0) return {} as OutputFor<Route>

  const chunks: FileEntryId[][] = []
  for (let i = 0; i < ids.length; i += FILE_IPC_BATCH_SIZE) {
    chunks.push(ids.slice(i, i + FILE_IPC_BATCH_SIZE))
  }
  const results = await Promise.all(
    chunks.map((chunk) => {
      switch (route) {
        case 'file.batch_get_metadata':
          return ipcApi.request('file.batch_get_metadata', {
            items: chunk.map((id) => ({ key: id, handle: { kind: 'entry' as const, entryId: id } }))
          })
        case 'file.batch_get_physical_paths':
          return ipcApi.request('file.batch_get_physical_paths', { ids: chunk })
        case 'file.batch_get_dangling_states':
          return ipcApi.request('file.batch_get_dangling_states', { ids: chunk })
      }
    })
  )
  return Object.assign({}, ...results) as OutputFor<Route>
}

async function requestBatchedFileMutation(
  route: FileBatchMutationRoute,
  ids: readonly string[]
): Promise<FileBatchMutationResult> {
  if (ids.length === 0) return { succeeded: [], failed: [] }

  const chunks: string[][] = []
  for (let i = 0; i < ids.length; i += FILE_IPC_BATCH_SIZE) {
    chunks.push(ids.slice(i, i + FILE_IPC_BATCH_SIZE))
  }

  const results = await Promise.all(
    chunks.map((chunk) => {
      switch (route) {
        case 'file.batch_trash':
          return ipcApi.request('file.batch_trash', { ids: chunk })
        case 'file.batch_permanent_delete':
          return ipcApi.request('file.batch_permanent_delete', { ids: chunk })
      }
    })
  )

  return {
    succeeded: results.flatMap((result) => result.succeeded),
    failed: results.flatMap((result) => result.failed)
  }
}

async function requestBatchedInternalEntryCreates(paths: readonly string[]): Promise<BatchCreateInternalEntriesResult> {
  const chunks: string[][] = []
  for (let i = 0; i < paths.length; i += FILE_IPC_CREATE_BATCH_SIZE) {
    chunks.push(paths.slice(i, i + FILE_IPC_CREATE_BATCH_SIZE))
  }

  const results = await Promise.all(
    chunks.map((chunk) =>
      ipcApi.request('file.batch_create_internal_entries', {
        items: chunk.map((path) => ({ source: 'path' as const, path }))
      })
    )
  )

  return {
    succeeded: results.flatMap((result) => result.succeeded),
    failed: results.flatMap((result) => result.failed)
  }
}

function formatDateTime(timestamp: number): string {
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return '—'

  const pad = (value: number) => value.toString().padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(
    date.getMinutes()
  )}`
}

function displayNameOf(entry: FileEntry): string {
  return entry.ext ? `${entry.name}.${entry.ext}` : entry.name
}

function stripCurrentExtension(name: string, format: string): string {
  if (!format) return name
  const suffix = `.${format}`
  return name.toLowerCase().endsWith(suffix.toLowerCase()) ? name.slice(0, -suffix.length) : name
}

function canStartInlineRename(file: FileItem | undefined): file is FileItem {
  return Boolean(file && !file.trashed && !file.isMissing)
}

function toFileItem(
  entry: FileEntry,
  metadataById: FileMetadataById,
  physicalPathById: PhysicalPathById,
  danglingStateById: DanglingStateById
): FileItem | null {
  const metadata = metadataById[entry.id]
  const format = entry.ext ?? ''
  const type = getFileTypeByExt(format)
  const sizeBytes = entry.origin === 'internal' ? entry.size : (metadata?.size ?? 0)
  const createdAt = metadata?.createdAt ?? entry.createdAt
  const updatedAt = metadata?.modifiedAt ?? entry.updatedAt
  const physicalPath = physicalPathById[entry.id]
  const danglingState = entry.origin === 'external' ? danglingStateById[entry.id] : undefined
  const isMissing = danglingState === 'missing'

  const base = {
    id: entry.id,
    name: displayNameOf(entry),
    format,
    size: metadata == null && entry.origin === 'external' ? '—' : formatFileSize(sizeBytes),
    sizeBytes,
    createdAt: formatDateTime(createdAt),
    updatedAt: formatDateTime(updatedAt),
    trashed: entry.origin === 'internal' && entry.deletedAt !== undefined,
    danglingState,
    isMissing
  }
  const originFields = entry.origin === 'external' ? { origin: 'external' as const } : { origin: 'internal' as const }

  if (type === 'image') {
    if (!physicalPath && !isMissing) return null

    return {
      ...base,
      ...originFields,
      type,
      previewUrl: physicalPath ? toSafeFileUrl(physicalPath as FilePath, entry.ext) : undefined
    }
  }

  return { ...base, ...originFields, type }
}

function warnMutationFailures(
  action: string,
  result: { failed: Array<{ id: string; error: string }> } | null
): boolean {
  if (!result || result.failed.length === 0) return false

  logger.warn(`${action} partially failed`, { failed: result.failed })
  return true
}

function reportImportFailures(result: { failed: Array<{ sourceRef: string; error: string }> }, message: string): void {
  if (result.failed.length > 0) {
    logger.warn('file import partially failed', { failed: result.failed })
    window.toast?.error(message)
  }
}

function shouldIgnoreFileShortcut(event: KeyboardEvent): boolean {
  if (event.defaultPrevented) return true
  const target = event.target
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  if (target.closest('[data-file-selection-checkbox]')) return false

  return Boolean(target.closest('a[href], button, input, select, textarea, [role="button"], [role="menuitem"]'))
}

// ─── Toolbar + Action Bar ───

const FileToolbar = memo(function FileToolbar({
  showSelectionControls,
  selectionControlsDisabled,
  showUpload,
  selectedCount,
  visibleSelectionState,
  batchDeleteLabel,
  onUpload,
  onBatchDelete,
  onSelectAll
}: {
  showSelectionControls: boolean
  selectionControlsDisabled: boolean
  showUpload: boolean
  selectedCount: number
  visibleSelectionState: boolean | 'indeterminate'
  batchDeleteLabel: string
  onUpload: () => void
  onBatchDelete: () => void
  onSelectAll: (checked: boolean) => void
}) {
  const { t } = useTranslation()
  const allSelected = visibleSelectionState === true
  const hasBatchAction = selectedCount > 1

  return (
    <div className="flex min-h-12 items-center gap-2 border-border-muted border-b bg-background px-4">
      {showSelectionControls && (
        <div className="-ml-2 flex h-8 items-center overflow-hidden rounded-md border border-border-muted bg-background">
          <div
            className={`flex h-full items-center gap-2 px-2 ${
              selectionControlsDisabled ? 'text-muted-foreground/35' : 'text-foreground hover:bg-accent/50'
            }`}>
            <div className="flex w-5 shrink-0 items-center justify-center">
              <Checkbox
                size="sm"
                checked={visibleSelectionState}
                disabled={selectionControlsDisabled}
                onCheckedChange={(checked) => onSelectAll(Boolean(checked))}
                aria-label={t('files.select_all_short')}
              />
            </div>
            <button
              type="button"
              disabled={selectionControlsDisabled}
              className="h-full whitespace-nowrap text-sm leading-none disabled:cursor-default"
              onClick={() => onSelectAll(!allSelected)}>
              {t('files.select_all_short')}
            </button>
          </div>
          <div className="h-full w-px bg-border-muted" />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                disabled={selectionControlsDisabled}
                className="h-full w-8 rounded-none p-0 text-muted-foreground hover:text-foreground"
                aria-label={t('files.actions')}>
                <MoreHorizontal size={15} strokeWidth={1.8} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-36">
              {selectedCount > 1 && (
                <DropdownMenuItem variant="destructive" onSelect={onBatchDelete}>
                  {batchDeleteLabel} ({selectedCount})
                </DropdownMenuItem>
              )}
              {!hasBatchAction && <DropdownMenuItem disabled>{t('files.no_actions')}</DropdownMenuItem>}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
      <div className="flex-1" />
      {showUpload ? (
        <Button
          variant="outline"
          size="sm"
          onClick={onUpload}
          className="h-8 gap-1.5 px-2.5 text-muted-foreground text-xs">
          <Upload size={13} />
          <span>{t('files.upload')}</span>
        </Button>
      ) : null}
    </div>
  )
})

// ─── Main FilePage ───

function FilesPage() {
  const { t } = useTranslation()
  const [metadataById, setMetadataById] = useState<FileMetadataById>({})
  const [physicalPathById, setPhysicalPathById] = useState<PhysicalPathById>({})
  const [danglingStateById, setDanglingStateById] = useState<DanglingStateById>({})
  const [filter, setFilter] = useState<SidebarFilter>({ kind: 'library', value: 'all' })
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  const [sortKey, setSortKey] = useState<SortKey>('updatedAt')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [dragOver, setDragOver] = useState(false)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const contentScrollRef = useRef<HTMLDivElement | null>(null)
  const pendingLoadMoreRef = useRef(false)

  // Product copy keeps this as a user-facing "Type" column, but the cell
  // renders a friendly format label derived from `ext` (e.g. `md` → Markdown).
  // Sort by raw `ext` server-side so cursor pagination stays globally stable.
  const serverSortKey: ServerSortKey = sortKey === 'type' ? 'ext' : sortKey
  const activeFilesQuery = useMemo(() => ({ sortBy: serverSortKey, sortOrder: sortDir }), [serverSortKey, sortDir])

  const {
    pages: activeFilePages,
    isLoading: isActiveFilesLoading,
    isRefreshing: isActiveFilesRefreshing,
    error: activeFilesError,
    hasNext: hasMoreActiveFiles,
    loadNext: loadMoreActiveFiles,
    refresh: refreshActiveFiles,
    reset: resetActiveFiles
  } = useInfiniteQuery('/files/entries', {
    query: activeFilesQuery,
    limit: FILES_PAGE_LIMIT,
    swrOptions: { keepPreviousData: true }
  })
  const {
    data: fileStats,
    error: fileStatsError,
    refetch: refetchFileStats
  } = useQuery('/files/entries/stats', {
    swrOptions: { keepPreviousData: true }
  })

  const isFilesLoading = isActiveFilesLoading
  const isFilesRefreshing = isActiveFilesRefreshing
  const activeEntries = useInfiniteFlatItems(activeFilePages)
  const activeFilesTotal = activeFilePages[0]?.total ?? activeEntries.length
  const entries = activeEntries
  const previousNonEmptyEntriesRef = useRef<FileEntry[]>([])
  const isFileQueryPending = isFilesLoading || isFilesRefreshing
  const displayEntryCandidate =
    entries.length === 0 && isFileQueryPending && previousNonEmptyEntriesRef.current.length > 0
      ? previousNonEmptyEntriesRef.current
      : entries
  const displayEntries = useDeferredValue(displayEntryCandidate)

  useEffect(() => {
    if (entries.length > 0) previousNonEmptyEntriesRef.current = entries
  }, [entries])

  useEffect(() => {
    resetActiveFiles()
  }, [resetActiveFiles, serverSortKey, sortDir])

  useEffect(() => {
    if (activeFilesError) logger.error('Failed to load active files', activeFilesError)
  }, [activeFilesError])

  useEffect(() => {
    if (fileStatsError) logger.error('Failed to load file stats', fileStatsError)
  }, [fileStatsError])

  useEffect(() => {
    if (displayEntries.length === 0) {
      if (isFilesLoading || isFilesRefreshing) return
      setMetadataById((prev) => (Object.keys(prev).length === 0 ? prev : {}))
      setPhysicalPathById((prev) => (Object.keys(prev).length === 0 ? prev : {}))
      setDanglingStateById((prev) => (Object.keys(prev).length === 0 ? prev : {}))
      return
    }

    let cancelled = false
    const ids = displayEntries.map((entry) => entry.id)
    const imageIds = displayEntries
      .filter((entry) => getFileTypeByExt(entry.ext ?? '') === 'image')
      .map((entry) => entry.id)
    void Promise.all([
      requestBatchedFileRecords('file.batch_get_metadata', ids),
      requestBatchedFileRecords('file.batch_get_physical_paths', imageIds),
      requestBatchedFileRecords('file.batch_get_dangling_states', ids)
    ])
      .then(([metadata, physicalPaths, danglingStates]) => {
        if (cancelled) return
        setMetadataById(metadata)
        setPhysicalPathById(physicalPaths)
        setDanglingStateById(danglingStates)
      })
      .catch((error) => {
        if (!cancelled) logger.error('Failed to load file IPC metadata', error as Error)
      })

    return () => {
      cancelled = true
    }
  }, [displayEntries, isFilesLoading, isFilesRefreshing])

  const files = useMemo(() => {
    const items = displayEntries.map((entry) => toFileItem(entry, metadataById, physicalPathById, danglingStateById))
    return items.filter((item): item is FileItem => item !== null)
  }, [displayEntries, danglingStateById, metadataById, physicalPathById])

  const refetchFiles = useCallback(async () => {
    resetActiveFiles()
    await Promise.all([refreshActiveFiles(), refetchFileStats()])
  }, [refetchFileStats, refreshActiveFiles, resetActiveFiles])

  const showUploadButton = filter.kind === 'library' && filter.value === 'all'
  const isImageGrid = filter.kind === 'type' && filter.value === 'image'
  const hasMoreCurrentFiles = hasMoreActiveFiles
  const isLoadingMoreActiveFiles = isActiveFilesRefreshing && activeFilePages.length > 0
  const isLoadingMoreCurrentFiles = isLoadingMoreActiveFiles

  useEffect(() => {
    pendingLoadMoreRef.current = false
  }, [hasMoreCurrentFiles, isLoadingMoreCurrentFiles, entries.length])

  const requestLoadMore = useCallback((loadMoreFiles: () => void) => {
    pendingLoadMoreRef.current = true
    queueMicrotask(() => {
      try {
        loadMoreFiles()
      } catch (error) {
        pendingLoadMoreRef.current = false
        logger.error('Failed to load more files', error as Error)
      }
    })
  }, [])

  const handleContentScroll = useCallback(() => {
    const el = contentScrollRef.current
    if (!el) return
    if (
      hasMoreCurrentFiles &&
      !isLoadingMoreCurrentFiles &&
      !pendingLoadMoreRef.current &&
      el.scrollHeight - el.scrollTop - el.clientHeight < 160
    ) {
      requestLoadMore(loadMoreActiveFiles)
    }
  }, [hasMoreCurrentFiles, isLoadingMoreCurrentFiles, loadMoreActiveFiles, requestLoadMore])

  const maybeFillClientFilteredViewport = useCallback(() => {
    // Type filters are applied client-side over the loaded active pages.
    // If the filtered rows do not make the container scrollable, scroll-load
    // cannot fire, so proactively fetch another active page until scrolling can engage.
    if (filter.kind === 'library') return
    const el = contentScrollRef.current
    if (!el || !hasMoreActiveFiles || isLoadingMoreActiveFiles || pendingLoadMoreRef.current) return
    if (el.scrollHeight > el.clientHeight) return

    requestLoadMore(loadMoreActiveFiles)
  }, [filter.kind, hasMoreActiveFiles, isLoadingMoreActiveFiles, loadMoreActiveFiles, requestLoadMore])

  useEffect(() => {
    if (filter.kind === 'library') return
    const el = contentScrollRef.current
    if (!el) return

    maybeFillClientFilteredViewport()
    if (typeof ResizeObserver === 'undefined') return

    const resizeObserver = new ResizeObserver(() => maybeFillClientFilteredViewport())
    resizeObserver.observe(el)
    return () => resizeObserver.disconnect()
  }, [filter.kind, maybeFillClientFilteredViewport])

  const handleOpen = useCallback(
    (file: FileItem) => {
      void safeOpen(createFileEntryHandle(file.id)).catch(() => {
        window.toast?.error(t('files.preview.error'))
      })
    },
    [t]
  )

  const handleShowInFolder = useCallback((id: string) => {
    void ipcApi.request('file.show_in_folder', createFileEntryHandle(id)).catch((error) => {
      logger.error('Failed to show file in folder', error as Error)
    })
  }, [])

  const handleImportPaths = useCallback(
    async (paths: string[]) => {
      if (paths.length === 0) return

      try {
        const result = await requestBatchedInternalEntryCreates(paths)
        reportImportFailures(result, t('files.error.import_partial_failed'))
        await refetchFiles()
      } catch (error) {
        logger.error('Failed to import files', error as Error)
        window.toast?.error(t('files.error.import_failed'))
      }
    },
    [refetchFiles, t]
  )

  const handleUploadClick = useCallback(async () => {
    try {
      const selected = await window.api.file.select({
        properties: ['openFile', 'multiSelections'],
        filters: [{ name: t('files.all'), extensions: ['*'] }]
      })
      if (!selected || selected.length === 0) return

      const paths = selected.map((file) => file.path).filter((path): path is string => Boolean(path))
      await handleImportPaths(paths)
    } catch (error) {
      logger.error('Failed to select files for import', error as Error)
      window.toast?.error(t('files.error.import_failed'))
    }
  }, [handleImportPaths, t])

  const filteredFiles = useMemo(() => {
    if (filter.kind === 'type') return files.filter((f) => f.type === filter.value)
    return files
  }, [files, filter])

  useEffect(() => {
    maybeFillClientFilteredViewport()
  }, [maybeFillClientFilteredViewport, filteredFiles.length, files.length])

  const fileCounts = useMemo(() => {
    const counts: Record<string, number> = {
      all: fileStats?.activeTotal ?? activeFilesTotal
    }

    if (!fileStats) return counts

    for (const type of ['image', 'video', 'audio', 'text', 'document', 'other'] as FileType[]) {
      counts[`type_${type}`] = 0
    }
    for (const { ext, count } of fileStats.extCounts) {
      const type = getFileTypeByExt(ext ?? '')
      counts[`type_${type}`] = (counts[`type_${type}`] ?? 0) + count
    }
    return counts
  }, [activeFilesTotal, fileStats])

  const footerFileCount = useMemo(() => {
    if (filter.kind === 'library') return fileCounts.all
    return fileCounts[`type_${filter.value}`] ?? filteredFiles.length
  }, [fileCounts, filter, filteredFiles.length])

  const selectedFiles = useMemo(() => files.filter((file) => selectedIds.has(file.id)), [files, selectedIds])
  const batchDeleteLabel = useMemo(() => {
    if (selectedFiles.length > 0 && selectedFiles.every((file) => file.origin === 'external')) {
      return t('files.remove_from_library')
    }
    if (selectedFiles.some((file) => file.origin === 'external')) return t('files.delete_or_remove')
    return t('files.delete.label')
  }, [selectedFiles, t])

  const handleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }, [])

  const handleSelectAllVisible = useCallback(
    (checked: boolean) => {
      setSelectedIds((prev) => {
        if (checked) return new Set([...prev, ...filteredFiles.map((file) => file.id)])

        const visibleIds = new Set(filteredFiles.map((file) => file.id))
        return new Set([...prev].filter((id) => !visibleIds.has(id)))
      })
    },
    [filteredFiles]
  )

  const visibleSelectionState = useMemo(() => {
    if (filteredFiles.length === 0) return false
    const selectedVisibleCount = filteredFiles.filter((file) => selectedIds.has(file.id)).length
    if (selectedVisibleCount === 0) return false
    return selectedVisibleCount === filteredFiles.length ? true : 'indeterminate'
  }, [filteredFiles, selectedIds])

  const performDelete = useCallback(
    async (targetIds: Set<string>) => {
      const targets = files.filter((file) => targetIds.has(file.id))
      if (targets.length === 0) return

      try {
        const trashIds = targets.filter((file) => file.origin === 'internal').map((file) => file.id)
        const removeIds = targets.filter((file) => file.origin === 'external').map((file) => file.id)
        const [trashResult, removeResult] = await Promise.all([
          trashIds.length > 0 ? requestBatchedFileMutation('file.batch_trash', trashIds) : Promise.resolve(null),
          removeIds.length > 0
            ? requestBatchedFileMutation('file.batch_permanent_delete', removeIds)
            : Promise.resolve(null)
        ])
        const trashFailed = warnMutationFailures('file trash', trashResult)
        const removeFailed = warnMutationFailures('file remove external entries', removeResult)
        if (trashFailed || removeFailed) {
          window.toast?.error(t('files.error.delete_partial_failed'))
        }

        setSelectedIds(new Set())
        await refetchFiles()
      } catch (error) {
        logger.error('Failed to delete files', error as Error)
        window.toast?.error(t('files.error.delete_failed'))
      }
    },
    [files, refetchFiles, t]
  )

  const handleDelete = useCallback(
    (ids?: Set<string>) => {
      const targetIds = ids ?? selectedIds
      const targets = files.filter((file) => targetIds.has(file.id))
      if (targets.length === 0) return

      void performDelete(new Set(targets.map((file) => file.id)))
    },
    [files, performDelete, selectedIds]
  )

  const handleRename = useCallback(
    async (id: string, newName: string) => {
      const file = files.find((item) => item.id === id)
      if (!file) {
        setRenamingId(null)
        return
      }

      const entryName = stripCurrentExtension(newName.trim(), file.format).trim()
      if (!entryName) {
        setRenamingId(null)
        return
      }
      if (entryName === stripCurrentExtension(file.name, file.format).trim()) {
        setRenamingId(null)
        return
      }

      try {
        await ipcApi.request('file.rename', { id, newName: entryName })
        setRenamingId(null)
        await refetchFiles()
      } catch (error) {
        logger.error('Failed to rename file', error as Error)
        window.toast?.error(t('files.error.rename_failed'))
        setRenamingId(null)
      }
    },
    [files, refetchFiles, t]
  )

  const startInlineRename = useCallback((id: string) => {
    setRenamingId(id)
  }, [])

  const listMenuActions = useMemo<FileContextMenuActions>(
    () => ({
      onRename: startInlineRename,
      onDelete: (id) => handleDelete(new Set([id])),
      onShowInFolder: handleShowInFolder
    }),
    [handleDelete, handleShowInFolder, startInlineRename]
  )

  const handleSort = useCallback(
    (key: SortKey) => {
      if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
      else {
        setSortKey(key)
        setSortDir('asc')
      }
    },
    [sortKey]
  )

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (renamingId || shouldIgnoreFileShortcut(e)) return
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedIds.size > 0) {
        e.preventDefault()
        handleDelete()
      }
      if ((e.key === 'F2' || (isMac && e.key === 'Enter')) && selectedIds.size === 1) {
        e.preventDefault()
        const selectedId = [...selectedIds][0]
        const selectedFile = files.find((file) => file.id === selectedId)
        if (!canStartInlineRename(selectedFile)) return

        startInlineRename(selectedFile.id)
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [files, selectedIds, handleDelete, renamingId, startInlineRename])

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      <FileSidebar
        filter={filter}
        onFilterChange={(f) => {
          setFilter(f)
          setSelectedIds(new Set())
          setRenamingId(null)
        }}
        fileCounts={fileCounts}
      />

      <div
        className={`relative flex min-w-0 flex-1 flex-col transition-colors ${dragOver ? 'bg-accent/25' : ''}`}
        onDragOver={(e) => {
          e.preventDefault()
          setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragOver(false)
          const paths = Array.from(e.dataTransfer.files)
            .map((file) => window.api.file.getPathForFile(file))
            .filter((path): path is string => Boolean(path))
          void handleImportPaths(paths)
        }}>
        {!isImageGrid && (
          <FileToolbar
            showSelectionControls
            selectionControlsDisabled={filteredFiles.length === 0}
            showUpload={showUploadButton}
            selectedCount={selectedIds.size}
            visibleSelectionState={visibleSelectionState}
            batchDeleteLabel={batchDeleteLabel}
            onUpload={() => void handleUploadClick()}
            onBatchDelete={() => handleDelete()}
            onSelectAll={handleSelectAllVisible}
          />
        )}

        {dragOver && (
          <div className="pointer-events-none absolute inset-0 z-50 m-2 flex items-center justify-center rounded-lg border-2 border-border/50 border-dashed bg-accent/25">
            <div className="text-center">
              <Upload size={28} className="mx-auto mb-2 text-muted-foreground/40" />
              <p className="text-muted-foreground/40 text-xs">{t('files.drag_upload')}</p>
            </div>
          </div>
        )}

        <Scrollbar
          data-testid="files-scrollbar"
          ref={contentScrollRef}
          className="relative flex-1"
          onScroll={handleContentScroll}
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setSelectedIds(new Set())
              setRenamingId(null)
            }
          }}>
          {filteredFiles.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center px-6 py-16">
              {!isFilesLoading && files.length === 0 ? (
                <EmptyState preset="no-file" />
              ) : (
                <EmptyState
                  preset="no-result"
                  title={t('files.empty.no_match_title')}
                  description={t('files.empty.no_match_description')}
                />
              )}
            </div>
          ) : (
            <>
              {isImageGrid ? (
                <FileGrid
                  files={filteredFiles}
                  selectedIds={new Set()}
                  onSelect={() => {}}
                  onOpen={handleOpen}
                  onDelete={(id) => handleDelete(new Set([id]))}
                  menuActions={listMenuActions}
                  renamingId={renamingId}
                  onRenameConfirm={(id, name) => void handleRename(id, name)}
                  onRenameCancel={() => setRenamingId(null)}
                />
              ) : (
                <FileList
                  files={filteredFiles}
                  selectedIds={selectedIds}
                  onSelect={handleSelect}
                  onOpen={handleOpen}
                  onSelectAll={handleSelectAllVisible}
                  visibleSelectionState={visibleSelectionState}
                  menuActions={listMenuActions}
                  onDelete={(id) => handleDelete(new Set([id]))}
                  onRename={startInlineRename}
                  onShowInFolder={handleShowInFolder}
                  sortKey={sortKey}
                  sortDir={sortDir}
                  onSort={handleSort}
                  renamingId={renamingId}
                  onRenameConfirm={(id, name) => void handleRename(id, name)}
                  onRenameCancel={() => setRenamingId(null)}
                />
              )}
            </>
          )}
        </Scrollbar>

        <div className="flex items-center gap-3 border-border/15 border-t px-4 py-1">
          <span className="text-muted-foreground/40 text-xs">
            {t('files.footer_count', { count: footerFileCount })}
          </span>
          {!isImageGrid && selectedIds.size > 0 && (
            <span className="text-muted-foreground/40 text-xs">
              {t('files.footer_selected_count', { count: selectedIds.size })}
            </span>
          )}
          <div className="flex-1" />
        </div>
      </div>
    </div>
  )
}

export default FilesPage
