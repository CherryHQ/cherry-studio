import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Input
} from '@cherrystudio/ui'
import { useInfiniteFlatItems, useInfiniteQuery, useQuery } from '@data/hooks/useDataApi'
import { loggerService } from '@logger'
import { isMac } from '@renderer/config/constant'
import { ipcApi } from '@renderer/ipc'
import type { FileEntry, FileEntryId } from '@shared/data/types/file'
import { IpcError, IpcErrorCode } from '@shared/ipc/errors'
import type { OutputFor } from '@shared/ipc/types'
import type { FilePath, FileType } from '@shared/types/file'
import { getFileTypeByExt } from '@shared/utils/file'
import { toSafeFileUrl } from '@shared/utils/file/urlUtil'
import { Trash2, Upload, X } from 'lucide-react'
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
type FileBatchRoute = 'file.batch_get_metadata' | 'file.batch_get_physical_paths' | 'file.batch_get_dangling_states'

// Renderer-side chunk size for splitting large id lists into multiple IPC calls.
// This is a batching knob, not the schema cap itself; it only needs to stay at
// or below the per-request limit enforced by the shared file IPC schemas.
// Renderer intentionally avoids importing the schema registry here because
// schemas are main/preload IPC runtime contracts, not renderer dependencies.
const FILE_IPC_BATCH_SIZE = 500

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
          return ipcApi.request('file.batch_get_metadata', { ids: chunk })
        case 'file.batch_get_physical_paths':
          return ipcApi.request('file.batch_get_physical_paths', { ids: chunk })
        case 'file.batch_get_dangling_states':
          return ipcApi.request('file.batch_get_dangling_states', { ids: chunk })
      }
    })
  )
  return Object.assign({}, ...results) as OutputFor<Route>
}

function formatDateTime(timestamp: number): string {
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return '—'

  const pad = (value: number) => value.toString().padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(
    date.getMinutes()
  )}`
}

function dirname(path: string): string | undefined {
  const index = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  if (index <= 0) return undefined
  return path.slice(0, index)
}

function displayNameOf(entry: FileEntry): string {
  return entry.ext ? `${entry.name}.${entry.ext}` : entry.name
}

function stripCurrentExtension(name: string, format: string): string {
  if (!format) return name
  const suffix = `.${format}`
  return name.toLowerCase().endsWith(suffix.toLowerCase()) ? name.slice(0, -suffix.length) : name
}

function toFileItem(
  entry: FileEntry,
  metadataById: FileMetadataById,
  physicalPathById: PhysicalPathById
): FileItem | null {
  const metadata = metadataById[entry.id]
  const format = entry.ext ?? ''
  const type = getFileTypeByExt(format)
  const sizeBytes = entry.origin === 'internal' ? entry.size : (metadata?.size ?? 0)
  const createdAt = metadata?.createdAt ?? entry.createdAt
  const updatedAt = metadata?.modifiedAt ?? entry.updatedAt
  const physicalPath = physicalPathById[entry.id]

  const base = {
    id: entry.id,
    name: displayNameOf(entry),
    format,
    size: metadata == null && entry.origin === 'external' ? '—' : formatFileSize(sizeBytes),
    sizeBytes,
    createdAt: formatDateTime(createdAt),
    updatedAt: formatDateTime(updatedAt),
    trashed: entry.origin === 'internal' && entry.deletedAt !== undefined
  }
  const originFields =
    entry.origin === 'external'
      ? { origin: entry.origin, folder: dirname(entry.externalPath) }
      : { origin: entry.origin }

  if (type === 'image') {
    if (!physicalPath) return null

    return {
      ...base,
      ...originFields,
      type,
      previewUrl: toSafeFileUrl(physicalPath as FilePath, entry.ext)
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

function reportMutationFailures(
  action: string,
  result: { failed: Array<{ id: string; error: string }> } | null,
  message: string
): void {
  if (warnMutationFailures(action, result)) {
    window.toast?.error(message)
  }
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

  return Boolean(target.closest('a[href], button, input, select, textarea, [role="button"], [role="menuitem"]'))
}

// ─── Batch Action Bar ───

const BatchBar = memo(function BatchBar({
  selectedLabel,
  deleteLabel,
  onDelete,
  onClear
}: {
  selectedLabel: string
  deleteLabel: string
  onDelete: () => void
  onClear: () => void
}) {
  return (
    <div className="flex items-center gap-2 border-border/30 border-b bg-accent/50 px-4 py-1.5">
      <span className="font-medium text-muted-foreground text-xs">{selectedLabel}</span>
      <div className="flex-1" />
      <Button
        variant="ghost"
        size="sm"
        onClick={onDelete}
        className="flex items-center gap-1 rounded-md px-2 py-[3px] text-destructive/60 text-xs transition-colors hover:bg-destructive/[0.08]">
        <Trash2 size={10} />
        <span>{deleteLabel}</span>
      </Button>
      <Button
        variant="ghost"
        onClick={onClear}
        className="flex h-5 w-5 items-center justify-center rounded-md p-0 text-muted-foreground/40 transition-colors hover:bg-accent hover:text-foreground">
        <X size={10} />
      </Button>
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
  const [renameDialogFile, setRenameDialogFile] = useState<FileItem | null>(null)
  const [renameDialogText, setRenameDialogText] = useState('')
  const contentScrollRef = useRef<HTMLDivElement | null>(null)
  const pendingLoadMoreRef = useRef(false)

  // Product copy keeps this as a user-facing "Type" column, but the cell
  // renders a friendly format label derived from `ext` (e.g. `md` → Markdown).
  // Sort by raw `ext` server-side so cursor pagination stays globally stable.
  const serverSortKey: ServerSortKey = sortKey === 'type' ? 'ext' : sortKey
  const activeFilesQuery = useMemo(() => ({ sortBy: serverSortKey, sortOrder: sortDir }), [serverSortKey, sortDir])
  const trashedFilesQuery = useMemo(
    () => ({ inTrash: true, sortBy: serverSortKey, sortOrder: sortDir }),
    [serverSortKey, sortDir]
  )

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
    pages: trashedFilePages,
    isLoading: isTrashedFilesLoading,
    isRefreshing: isTrashedFilesRefreshing,
    error: trashedFilesError,
    hasNext: hasMoreTrashedFiles,
    loadNext: loadMoreTrashedFiles,
    refresh: refreshTrashedFiles,
    reset: resetTrashedFiles
  } = useInfiniteQuery('/files/entries', {
    query: trashedFilesQuery,
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

  const isFilesLoading = isActiveFilesLoading || isTrashedFilesLoading
  const isFilesRefreshing = isActiveFilesRefreshing || isTrashedFilesRefreshing
  const activeEntries = useInfiniteFlatItems(activeFilePages)
  const trashedEntries = useInfiniteFlatItems(trashedFilePages)
  const activeFilesTotal = activeFilePages[0]?.total ?? activeEntries.length
  const trashedFilesTotal = trashedFilePages[0]?.total ?? trashedEntries.length
  const entries = useMemo(() => [...activeEntries, ...trashedEntries], [activeEntries, trashedEntries])
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
    resetTrashedFiles()
  }, [resetActiveFiles, resetTrashedFiles, serverSortKey, sortDir])

  useEffect(() => {
    if (activeFilesError) logger.error('Failed to load active files', activeFilesError)
  }, [activeFilesError])

  useEffect(() => {
    if (trashedFilesError) logger.error('Failed to load trashed files', trashedFilesError)
  }, [trashedFilesError])

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

  const files = useMemo(
    () =>
      displayEntries.flatMap((entry) => {
        if (entry.origin === 'external' && danglingStateById[entry.id] === 'missing') return []
        const file = toFileItem(entry, metadataById, physicalPathById)
        return file ? [file] : []
      }),
    [displayEntries, metadataById, physicalPathById, danglingStateById]
  )

  const refetchFiles = useCallback(async () => {
    resetActiveFiles()
    resetTrashedFiles()
    await Promise.all([refreshActiveFiles(), refreshTrashedFiles(), refetchFileStats()])
  }, [refetchFileStats, refreshActiveFiles, refreshTrashedFiles, resetActiveFiles, resetTrashedFiles])

  const isTrash = filter.kind === 'library' && filter.value === 'trash'
  const hasMoreCurrentFiles = isTrash ? hasMoreTrashedFiles : hasMoreActiveFiles
  const isLoadingMoreActiveFiles = isActiveFilesRefreshing && activeFilePages.length > 0
  const isLoadingMoreTrashedFiles = isTrashedFilesRefreshing && trashedFilePages.length > 0
  const isLoadingMoreCurrentFiles = isTrash ? isLoadingMoreTrashedFiles : isLoadingMoreActiveFiles

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

  const handleContentScroll = useCallback(
    (e: React.UIEvent<HTMLDivElement>) => {
      const el = e.currentTarget
      if (
        hasMoreCurrentFiles &&
        !isLoadingMoreCurrentFiles &&
        !pendingLoadMoreRef.current &&
        el.scrollHeight - el.scrollTop - el.clientHeight < 160
      ) {
        const loadMoreFiles = isTrash ? loadMoreTrashedFiles : loadMoreActiveFiles
        requestLoadMore(loadMoreFiles)
      }
    },
    [
      hasMoreCurrentFiles,
      isLoadingMoreCurrentFiles,
      isTrash,
      loadMoreActiveFiles,
      loadMoreTrashedFiles,
      requestLoadMore
    ]
  )

  const maybeFillClientFilteredViewport = useCallback(() => {
    // Type/folder filters are applied client-side over the loaded active pages.
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
      void ipcApi.request('file.open', { id: file.id }).catch((error) => {
        if (error instanceof IpcError && error.code === IpcErrorCode.FILE_OPEN_BLOCKED_UNSAFE_TYPE) {
          logger.warn('Blocked unsafe default-open; falling back to show in folder', { id: file.id })
          void ipcApi
            .request('file.show_in_folder', { id: file.id })
            .catch((showError) => logger.error('Failed to show blocked file in folder', showError as Error))
          return
        }
        logger.error('Failed to open file', error as Error)
        window.toast?.error(t('files.preview.error'))
      })
    },
    [t]
  )

  const handleShowInFolder = useCallback((id: string) => {
    void ipcApi.request('file.show_in_folder', { id }).catch((error) => {
      logger.error('Failed to show file in folder', error as Error)
    })
  }, [])

  const handleImportPaths = useCallback(
    async (paths: string[]) => {
      if (paths.length === 0) return

      try {
        const result = await ipcApi.request('file.import_paths', { paths })
        reportImportFailures(result, t('files.error.import_partial_failed'))
        await refetchFiles()
      } catch (error) {
        logger.error('Failed to import files', error as Error)
        window.toast?.error(t('files.error.import_failed'))
      }
    },
    [refetchFiles, t]
  )

  const folderList = useMemo(() => fileStats?.folderCounts.map((row) => row.folder).sort() ?? [], [fileStats])

  const filteredFiles = useMemo(() => {
    let result = files

    if (filter.kind === 'library') {
      if (filter.value === 'trash') result = result.filter((f) => f.trashed)
      else result = result.filter((f) => !f.trashed)
    } else if (filter.kind === 'type') {
      result = result.filter((f) => !f.trashed && f.type === filter.value)
    } else if (filter.kind === 'folder') {
      result = result.filter((f) => !f.trashed && f.origin === 'external' && f.folder === filter.value)
    }

    return result
  }, [files, filter])

  useEffect(() => {
    maybeFillClientFilteredViewport()
  }, [maybeFillClientFilteredViewport, filteredFiles.length, files.length])

  const fileCounts = useMemo(() => {
    const counts: Record<string, number> = {
      all: fileStats?.activeTotal ?? activeFilesTotal,
      trash: fileStats?.trashTotal ?? trashedFilesTotal
    }

    if (!fileStats) return counts

    for (const type of ['image', 'video', 'audio', 'text', 'document', 'other'] as FileType[]) {
      counts[`type_${type}`] = 0
    }
    for (const { ext, count } of fileStats.extCounts) {
      const type = getFileTypeByExt(ext ?? '')
      counts[`type_${type}`] = (counts[`type_${type}`] ?? 0) + count
    }
    for (const { folder, count } of fileStats.folderCounts) {
      counts[`folder:${folder}`] = count
    }
    return counts
  }, [activeFilesTotal, fileStats, trashedFilesTotal])

  const footerFileCount = useMemo(() => {
    if (filter.kind === 'library') return filter.value === 'trash' ? fileCounts.trash : fileCounts.all
    if (filter.kind === 'type') return fileCounts[`type_${filter.value}`] ?? filteredFiles.length
    return fileCounts[`folder:${filter.value}`] ?? filteredFiles.length
  }, [fileCounts, filter, filteredFiles.length])

  const selectedFiles = useMemo(() => files.filter((file) => selectedIds.has(file.id)), [files, selectedIds])
  const batchDeleteLabel = useMemo(() => {
    if (isTrash) return t('files.permanent_delete')
    if (selectedFiles.length > 0 && selectedFiles.every((file) => file.origin === 'external')) {
      return t('files.remove_from_library')
    }
    if (selectedFiles.some((file) => file.origin === 'external')) return t('files.delete_or_remove')
    return t('files.delete.label')
  }, [isTrash, selectedFiles, t])

  const handleSelect = useCallback((id: string, multi: boolean) => {
    setSelectedIds((prev) => {
      if (multi) {
        const next = new Set(prev)
        next.has(id) ? next.delete(id) : next.add(id)
        return next
      }
      return prev.has(id) && prev.size === 1 ? new Set() : new Set([id])
    })
  }, [])

  const handleContextMenuOpen = useCallback(
    (id: string) => {
      // Right-click selects the item if it isn't already selected; an already-
      // selected item (including one in a multi-selection) is left untouched.
      if (!selectedIds.has(id)) setSelectedIds(new Set([id]))
    },
    [selectedIds]
  )

  const handleDelete = useCallback(
    async (ids?: Set<string>) => {
      const targets = files.filter((file) => (ids ?? selectedIds).has(file.id))
      if (targets.length === 0) return

      try {
        if (isTrash) {
          const result = await ipcApi.request('file.batch_permanent_delete', { ids: targets.map((file) => file.id) })
          reportMutationFailures('file permanent delete', result, t('files.error.delete_partial_failed'))
        } else {
          const trashIds = targets.filter((file) => file.origin === 'internal').map((file) => file.id)
          const removeIds = targets.filter((file) => file.origin === 'external').map((file) => file.id)
          const [trashResult, removeResult] = await Promise.all([
            trashIds.length > 0 ? ipcApi.request('file.batch_trash', { ids: trashIds }) : Promise.resolve(null),
            removeIds.length > 0
              ? ipcApi.request('file.batch_permanent_delete', { ids: removeIds })
              : Promise.resolve(null)
          ])
          const trashFailed = warnMutationFailures('file trash', trashResult)
          const removeFailed = warnMutationFailures('file remove external entries', removeResult)
          if (trashFailed || removeFailed) {
            window.toast?.error(t('files.error.delete_partial_failed'))
          }
        }

        setSelectedIds(new Set())
        await refetchFiles()
      } catch (error) {
        logger.error('Failed to delete files', error as Error)
        window.toast?.error(t('files.error.delete_failed'))
      }
    },
    [files, isTrash, refetchFiles, selectedIds, t]
  )

  const handleRestore = useCallback(
    async (ids: Set<string>) => {
      try {
        const result = await ipcApi.request('file.batch_restore', { ids: [...ids] })
        reportMutationFailures('file restore', result, t('files.error.restore_partial_failed'))
        setSelectedIds(new Set())
        await refetchFiles()
      } catch (error) {
        logger.error('Failed to restore files', error as Error)
        window.toast?.error(t('files.error.restore_failed'))
      }
    },
    [refetchFiles, t]
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
    setRenameDialogFile(null)
    setRenamingId(id)
  }, [])

  const startGridRename = useCallback(
    (id: string) => {
      const file = files.find((item) => item.id === id)
      if (!file) return

      setRenamingId(null)
      setRenameDialogFile(file)
      setRenameDialogText(file.name)
    },
    [files]
  )

  const renameDialogBaseName = renameDialogFile
    ? stripCurrentExtension(renameDialogText, renameDialogFile.format).trim()
    : ''

  const handleRenameDialogConfirm = useCallback(() => {
    const file = renameDialogFile
    const name = renameDialogText.trim()
    if (!file || !renameDialogBaseName) return

    setRenameDialogFile(null)
    void handleRename(file.id, name)
  }, [handleRename, renameDialogBaseName, renameDialogFile, renameDialogText])

  const listMenuActions = useMemo<FileContextMenuActions>(
    () => ({
      onRename: startInlineRename,
      onDelete: (id) => void handleDelete(new Set([id])),
      onRestore: (id) => void handleRestore(new Set([id])),
      onShowInFolder: handleShowInFolder
    }),
    [handleDelete, handleRestore, handleShowInFolder, startInlineRename]
  )

  const gridMenuActions = useMemo<FileContextMenuActions>(
    () => ({
      onRename: startGridRename,
      onDelete: (id) => void handleDelete(new Set([id])),
      onRestore: (id) => void handleRestore(new Set([id])),
      onShowInFolder: handleShowInFolder
    }),
    [handleDelete, handleRestore, handleShowInFolder, startGridRename]
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
        void handleDelete()
      }
      if ((e.key === 'F2' || (isMac && e.key === 'Enter')) && selectedIds.size === 1) {
        e.preventDefault()
        if (filter.kind === 'type' && filter.value === 'image') startGridRename([...selectedIds][0])
        else startInlineRename([...selectedIds][0])
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [selectedIds, filter, handleDelete, renamingId, startGridRename, startInlineRename])

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      <FileSidebar
        filter={filter}
        onFilterChange={(f) => {
          setFilter(f)
          setSelectedIds(new Set())
          setRenamingId(null)
          setRenameDialogFile(null)
        }}
        fileCounts={fileCounts}
        folders={folderList}
      />

      <Dialog
        open={renameDialogFile !== null}
        onOpenChange={(open) => {
          if (!open) setRenameDialogFile(null)
        }}>
        <DialogContent aria-describedby={undefined} className="max-w-sm rounded-xl">
          <DialogHeader>
            <DialogTitle>{t('common.rename')}</DialogTitle>
          </DialogHeader>
          <Input
            autoFocus
            aria-label={t('common.rename')}
            value={renameDialogText}
            onChange={(event) => setRenameDialogText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') handleRenameDialogConfirm()
              if (event.key === 'Escape') setRenameDialogFile(null)
            }}
            className="h-9 rounded-md border-input bg-background"
          />
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setRenameDialogFile(null)}>
              {t('common.cancel')}
            </Button>
            <Button size="sm" disabled={!renameDialogBaseName} onClick={handleRenameDialogConfirm}>
              {t('common.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
        {selectedIds.size > 1 && (
          <BatchBar
            selectedLabel={t('files.selected_count', { count: selectedIds.size })}
            deleteLabel={batchDeleteLabel}
            onDelete={() => void handleDelete()}
            onClear={() => setSelectedIds(new Set())}
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

        <div
          ref={contentScrollRef}
          className="relative flex-1 overflow-y-auto"
          onScroll={handleContentScroll}
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setSelectedIds(new Set())
              setRenamingId(null)
            }
          }}>
          {filteredFiles.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center px-6 py-16">
              {!isFilesLoading && files.filter((f) => !f.trashed).length === 0 ? (
                <EmptyState preset="no-file" />
              ) : (
                <EmptyState
                  preset="no-result"
                  title={t('files.empty.no_match_title')}
                  description={t('files.empty.no_match_description')}
                />
              )}
            </div>
          ) : filter.kind === 'type' && filter.value === 'image' ? (
            <FileGrid
              files={filteredFiles}
              selectedIds={selectedIds}
              onSelect={handleSelect}
              onContextMenuOpen={handleContextMenuOpen}
              onOpen={handleOpen}
              onDelete={(id) => void handleDelete(new Set([id]))}
              isTrash={isTrash}
              menuActions={gridMenuActions}
              renamingId={renamingId}
              onRenameConfirm={(id, name) => void handleRename(id, name)}
              onRenameCancel={() => setRenamingId(null)}
            />
          ) : (
            <FileList
              files={filteredFiles}
              selectedIds={selectedIds}
              onSelect={handleSelect}
              onContextMenuOpen={handleContextMenuOpen}
              onOpen={handleOpen}
              isTrash={isTrash}
              menuActions={listMenuActions}
              sortKey={sortKey}
              sortDir={sortDir}
              onSort={handleSort}
              renamingId={renamingId}
              onRenameConfirm={(id, name) => void handleRename(id, name)}
              onRenameCancel={() => setRenamingId(null)}
            />
          )}
        </div>

        <div className="flex items-center gap-3 border-border/15 border-t px-4 py-1">
          <span className="text-muted-foreground/40 text-xs">
            {t('files.footer_count', { count: footerFileCount })}
          </span>
          {selectedIds.size > 0 && (
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
