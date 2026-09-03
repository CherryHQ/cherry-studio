import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EmptyState,
  PageHeader,
  Scrollbar
} from '@cherrystudio/ui'
import { dataApiService } from '@data/DataApiService'
import { useInfiniteFlatItems, useInfiniteQuery, useQuery } from '@data/hooks/useDataApi'
import { loggerService } from '@logger'
import { FilePreview } from '@renderer/components/FilePreview'
import { ipcApi } from '@renderer/ipc'
import { requestBatchedFileMutation } from '@renderer/services/fileBatchMutation'
import { ImagePreviewService } from '@renderer/services/ImagePreviewService'
import { popup } from '@renderer/services/popup'
import { showRecycleBinBatchUndo } from '@renderer/services/recycleBinFeedback'
import { toast } from '@renderer/services/toast'
import { normalizeFilePreviewPath } from '@renderer/utils/filePreview'
import { isMac } from '@renderer/utils/platform'
import type { FileEntry, FileEntryId } from '@shared/data/types/file'
import type { OutputFor } from '@shared/ipc/types'
import type { AbsoluteFilePath, FileType } from '@shared/types/file'
import { AbsoluteFilePathSchema } from '@shared/types/file'
import { createFileEntryHandle, getFileTypeByExt, toSafeFileUrl } from '@shared/utils/file'
import { ArrowLeft, MoreHorizontal, Upload } from 'lucide-react'
import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { FileContextMenuActions } from './FileContextMenu'
import type { FileItem } from './fileDisplay'
import { formatFileSize } from './fileDisplay'
import { FileGrid } from './FileGrid'
import type { SortDir, SortKey } from './FileList'
import { FileList, FileListHeader } from './FileList'
import type { SidebarFilter } from './FileSidebar'
import { FileSidebar } from './FileSidebar'

const logger = loggerService.withContext('FilesPage')
const FILES_PAGE_LIMIT = 100

type ServerSortKey = 'name' | 'size' | 'updatedAt' | 'ext'
type FileMetadataById = OutputFor<'file.batch_get_metadata'>
type PhysicalPathById = OutputFor<'file.batch_get_physical_paths'>
type DanglingStateById = OutputFor<'file.batch_get_dangling_states'>
type BatchCreateInternalEntriesResult = OutputFor<'file.batch_create_internal_entries'>
type FileBatchRoute = 'file.batch_get_metadata' | 'file.batch_get_physical_paths' | 'file.batch_get_dangling_states'

interface EmbeddedFilePreview {
  fileName: string
  filePath: AbsoluteFilePath
  refreshKey: number
}

// Renderer-side chunk size for splitting large id lists into multiple IPC calls.
// This is a batching knob, not the schema cap itself; it only needs to stay at
// or below the per-request limit enforced by the shared file IPC schemas.
// Renderer intentionally avoids importing the schema registry here because
// schemas are main/preload IPC runtime contracts, not renderer dependencies.
const FILE_IPC_BATCH_SIZE = 500
// Keep at or below `FILE_IPC_MAX_BATCH_CREATE_ITEMS` from the IPC schema.
const FILE_IPC_CREATE_BATCH_SIZE = 100
const FILE_DETAIL_LOOKUP_CONCURRENCY = 8

async function inspectFailedFileIds(
  failures: readonly { id: FileEntryId }[]
): Promise<{ activeInternalIds: Set<FileEntryId>; trashedInternalIds: Set<FileEntryId> }> {
  const activeInternalIds = new Set<FileEntryId>()
  const trashedInternalIds = new Set<FileEntryId>()
  for (let index = 0; index < failures.length; index += FILE_DETAIL_LOOKUP_CONCURRENCY) {
    const chunk = failures.slice(index, index + FILE_DETAIL_LOOKUP_CONCURRENCY)
    await Promise.all(
      chunk.map(async ({ id }) => {
        try {
          const current = await dataApiService.get(`/files/entries/${id}`)
          if (current.origin !== 'internal') return
          if (current.deletedAt == null) activeInternalIds.add(id)
          else trashedInternalIds.add(id)
        } catch {
          // Missing or inaccessible entries remain real failures.
        }
      })
    )
  }
  return { activeInternalIds, trashedInternalIds }
}

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

async function requestBatchedInternalEntryCreates(
  paths: readonly AbsoluteFilePath[]
): Promise<BatchCreateInternalEntriesResult> {
  const chunks: AbsoluteFilePath[][] = []
  for (let i = 0; i < paths.length; i += FILE_IPC_CREATE_BATCH_SIZE) {
    chunks.push(paths.slice(i, i + FILE_IPC_CREATE_BATCH_SIZE))
  }

  const results = await Promise.all(
    chunks.map((chunk) =>
      ipcApi.request('file.batch_create_internal_entries', {
        items: chunk.map((path) => ({
          source: 'path' as const,
          path,
          // Files-page upload = add-to-library: 'manual' keeps zero-ref uploads out of GC (spec §4.1)
          cleanupPolicy: 'manual' as const
        }))
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

function useStableFileEntries(entries: FileEntry[]): FileEntry[] {
  const stableRef = useRef(entries)
  if (
    stableRef.current.length !== entries.length ||
    stableRef.current.some((entry, index) => entry !== entries[index])
  ) {
    stableRef.current = entries
  }
  return stableRef.current
}

function toFileItem(
  entry: FileEntry,
  metadataById: FileMetadataById,
  physicalPathById: PhysicalPathById,
  danglingStateById: DanglingStateById
): FileItem {
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
    return {
      ...base,
      ...originFields,
      type,
      previewUrl: physicalPath ? toSafeFileUrl(physicalPath, entry.ext) : undefined
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
    toast.error(message)
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
  selectedCount,
  batchDeleteLabel,
  onBatchDelete,
  deleteDisabled
}: {
  selectedCount: number
  batchDeleteLabel: string
  onBatchDelete: () => void
  deleteDisabled: boolean
}) {
  const { t } = useTranslation()

  return (
    <div className="flex h-7 shrink-0 items-center gap-1">
      <span className="text-muted-foreground text-xs">
        {t('files.footer_selected_count', { count: selectedCount })}
      </span>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={deleteDisabled}
            className="!text-muted-foreground hover:!text-foreground size-6 hover:bg-transparent"
            aria-label={t('files.actions')}>
            <MoreHorizontal size={14} />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-36">
          <DropdownMenuItem disabled={deleteDisabled} variant="destructive" onSelect={onBatchDelete}>
            {batchDeleteLabel} ({selectedCount})
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
})

// ─── Main FilePage ───

function FilesPage() {
  const { t } = useTranslation()
  const [embeddedPreview, setEmbeddedPreview] = useState<EmbeddedFilePreview | null>(null)
  // Guards the async open flow: each open bumps the token, and stale physical-path
  // resolutions (success or failure) are ignored so a slower earlier click can never
  // overwrite — or error over — the file the user most recently opened.
  const openRequestTokenRef = useRef(0)
  const [metadataById, setMetadataById] = useState<FileMetadataById>({})
  const [physicalPathById, setPhysicalPathById] = useState<PhysicalPathById>({})
  const [danglingStateById, setDanglingStateById] = useState<DanglingStateById>({})
  const [filter, setFilter] = useState<SidebarFilter>({ kind: 'library', value: 'all' })
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const selectionAnchorIdRef = useRef<string | null>(null)
  const deleteRequestPendingRef = useRef(false)
  const [deleteRequestPending, setDeleteRequestPending] = useState(false)

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
  const activeFileType = filter.kind === 'type' ? filter.value : undefined
  const activeFilesQuery = useMemo(
    () => ({
      sortBy: serverSortKey,
      sortOrder: sortDir,
      ...(activeFileType && { fileType: activeFileType })
    }),
    [activeFileType, serverSortKey, sortDir]
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
    data: fileStats,
    error: fileStatsError,
    refetch: refetchFileStats
  } = useQuery('/files/entries/stats', {
    swrOptions: { keepPreviousData: true }
  })

  const isFilesLoading = isActiveFilesLoading
  const isFilesRefreshing = isActiveFilesRefreshing
  const entries = useStableFileEntries(useInfiniteFlatItems(activeFilePages))
  const activeFilesTotal =
    activeFilePages[0]?.total ?? activeFilePages.reduce((sum, page) => sum + page.items.length, 0)
  const previousNonEmptyEntriesRef = useRef<FileEntry[]>([])
  const displayEntryCandidate =
    entries.length === 0 && (isFilesLoading || isFilesRefreshing) && previousNonEmptyEntriesRef.current.length > 0
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
    return displayEntries.map((entry) => toFileItem(entry, metadataById, physicalPathById, danglingStateById))
  }, [displayEntries, danglingStateById, metadataById, physicalPathById])

  const refetchFiles = useCallback(async () => {
    resetActiveFiles()
    await Promise.all([refreshActiveFiles(), refetchFileStats()])
  }, [refetchFileStats, refreshActiveFiles, resetActiveFiles])

  const isImageGrid = filter.kind === 'type' && filter.value === 'image'
  const activeFilterLabel =
    filter.kind === 'library'
      ? t('files.all')
      : t(
          {
            audio: 'files.audio',
            document: 'files.document',
            image: 'files.image',
            other: 'files.other',
            text: 'files.text',
            video: 'files.video'
          }[filter.value]
        )
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

  const handleOpen = useCallback(
    (file: FileItem) => {
      const requestToken = ++openRequestTokenRef.current
      void requestBatchedFileRecords('file.batch_get_physical_paths', [file.id])
        .then((physicalPaths) => {
          if (openRequestTokenRef.current !== requestToken) return
          const filePath = physicalPaths[file.id]
          if (!filePath) throw new Error(`Physical path is unavailable for file ${file.id}`)
          const normalizedPath = normalizeFilePreviewPath(filePath)
          if (file.type === 'image') {
            void ImagePreviewService.show(toSafeFileUrl(normalizedPath, file.format)).catch((error: unknown) => {
              const normalized = error instanceof Error ? error : new Error(String(error))
              logger.error('Failed to open image preview', normalized)
              toast.error(t('files.preview.error'))
            })
            return
          }
          setEmbeddedPreview((current) => ({
            fileName: file.name,
            filePath: normalizedPath,
            refreshKey: current?.filePath === normalizedPath ? current.refreshKey + 1 : 0
          }))
        })
        .catch((error: unknown) => {
          if (openRequestTokenRef.current !== requestToken) return
          const normalized = error instanceof Error ? error : new Error(String(error))
          logger.error('Failed to open file preview', normalized)
          toast.error(t('files.preview.error'))
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
    async (paths: AbsoluteFilePath[]) => {
      if (paths.length === 0) return

      try {
        const result = await requestBatchedInternalEntryCreates(paths)
        reportImportFailures(result, t('files.error.import_partial_failed'))
        await refetchFiles()
      } catch (error) {
        logger.error('Failed to import files', error as Error)
        toast.error(t('files.error.import_failed'))
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

      const paths = selected
        .map((file) => AbsoluteFilePathSchema.safeParse(file.path).data)
        .filter((path): path is AbsoluteFilePath => Boolean(path))
      await handleImportPaths(paths)
    } catch (error) {
      logger.error('Failed to select files for import', error as Error)
      toast.error(t('files.error.import_failed'))
    }
  }, [handleImportPaths, t])

  const filteredFiles = useMemo(() => {
    let result = files

    if (filter.kind === 'type') {
      result = result.filter((f) => f.type === filter.value)
    }

    return result
  }, [files, filter])

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

  const selectedFiles = useMemo(() => files.filter((file) => selectedIds.has(file.id)), [files, selectedIds])
  const batchDeleteLabel = useMemo(() => {
    if (selectedFiles.length > 0 && selectedFiles.every((file) => file.origin === 'external')) {
      return t('files.remove_from_library')
    }
    if (selectedFiles.some((file) => file.origin === 'external')) return t('files.delete_or_remove')
    return t('files.delete.label')
  }, [selectedFiles, t])

  const handleSelect = useCallback(
    (id: string, isChecked: boolean, shouldSelectRange: boolean) => {
      const anchorIndex = selectionAnchorIdRef.current
        ? filteredFiles.findIndex((file) => file.id === selectionAnchorIdRef.current)
        : -1
      const targetIndex = filteredFiles.findIndex((file) => file.id === id)
      const isRangeSelection = shouldSelectRange && anchorIndex >= 0
      const selectionIds = isRangeSelection
        ? filteredFiles
            .slice(Math.min(anchorIndex, targetIndex), Math.max(anchorIndex, targetIndex) + 1)
            .map((file) => file.id)
        : [id]

      if (!isRangeSelection) selectionAnchorIdRef.current = id
      setSelectedIds((prev) => {
        const next = new Set(prev)
        for (const selectionId of selectionIds) {
          if (isChecked) next.add(selectionId)
          else next.delete(selectionId)
        }
        return next
      })
    },
    [filteredFiles]
  )

  useEffect(() => {
    if (selectedIds.size === 0) selectionAnchorIdRef.current = null
  }, [selectedIds])

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

      const trashIds = targets.filter((file) => file.origin === 'internal').map((file) => file.id)
      const removeIds = targets.filter((file) => file.origin === 'external').map((file) => file.id)
      const [trashResult, removeResult] = await Promise.all([
        requestBatchedFileMutation('file.batch_trash', trashIds),
        requestBatchedFileMutation('file.batch_remove_from_library', removeIds)
      ])
      const requestFailed = trashResult.requestFailed || removeResult.requestFailed

      try {
        await refetchFiles()
      } catch (error) {
        logger.warn('Failed to refresh files after deletion', error as Error)
      }

      const { trashedInternalIds: alreadyTrashedIds } = await inspectFailedFileIds(trashResult.failed)
      const effectiveTrashResult = {
        ...trashResult,
        failed: trashResult.failed.filter(({ id }) => !alreadyTrashedIds.has(id))
      }
      const trashFailed = warnMutationFailures('file trash', effectiveTrashResult)
      const removeFailed = warnMutationFailures('file remove external entries', removeResult)
      const completedIds = new Set([...trashResult.succeeded, ...removeResult.succeeded, ...alreadyTrashedIds])

      if (alreadyTrashedIds.size > 0) toast.info(t('recycle_bin.already_moved'))

      if (trashFailed || removeFailed) {
        toast.error(
          t(
            requestFailed && completedIds.size === 0 ? 'files.error.delete_failed' : 'files.error.delete_partial_failed'
          )
        )
      }
      if (requestFailed) {
        logger.error('Failed to delete files', new Error('One or more file mutation requests failed'))
      }

      setSelectedIds((current) => new Set([...current].filter((id) => !completedIds.has(id))))

      if (trashResult.succeeded.length > 0) {
        const trashedIds = [...trashResult.succeeded]
        showRecycleBinBatchUndo({
          itemCount: trashedIds.length,
          onUndo: async () => {
            const restoreResult = await requestBatchedFileMutation('file.batch_restore', trashedIds)
            try {
              await refetchFiles()
            } catch (error) {
              logger.warn('Failed to refresh files after restore', error as Error)
            }
            const { activeInternalIds } = await inspectFailedFileIds(restoreResult.failed)
            const reconciledResult = {
              restored: [
                ...restoreResult.succeeded,
                ...restoreResult.failed.filter(({ id }) => activeInternalIds.has(id)).map(({ id }) => id)
              ],
              failed: restoreResult.failed.filter(({ id }) => !activeInternalIds.has(id))
            }
            warnMutationFailures('file restore', reconciledResult)
            return reconciledResult
          }
        })
      }
    },
    [files, refetchFiles, t]
  )

  const requestDelete = useCallback(
    (targetIds: Set<string>) => {
      if (deleteRequestPendingRef.current) return
      const targets = files.filter((file) => targetIds.has(file.id))
      if (targets.length === 0) return

      deleteRequestPendingRef.current = true
      setDeleteRequestPending(true)
      void (async () => {
        try {
          const internalCount = targets.filter((file) => file.origin === 'internal').length
          const externalCount = targets.length - internalCount
          const confirmed = await popup.confirm(
            internalCount > 0 && externalCount > 0
              ? {
                  title: t('files.delete_or_remove_confirm.title'),
                  content: (
                    <div className="space-y-1">
                      <p>{t('files.delete_or_remove_confirm.internal_count', { count: internalCount })}</p>
                      <p>{t('files.delete_or_remove_confirm.external_count', { count: externalCount })}</p>
                    </div>
                  ),
                  okText: t('files.delete_or_remove'),
                  cancelText: t('common.cancel'),
                  okButtonProps: { danger: true }
                }
              : externalCount > 0
                ? {
                    title: t('files.remove_from_library_confirm.title'),
                    content: t('files.remove_from_library_confirm.description'),
                    okText: t('files.remove_from_library'),
                    cancelText: t('common.cancel'),
                    okButtonProps: { danger: true }
                  }
                : {
                    title: t('recycle_bin.move.confirm_title'),
                    okText: t('recycle_bin.move.confirm_action'),
                    cancelText: t('common.cancel'),
                    okButtonProps: { danger: true }
                  }
          )
          if (confirmed) await performDelete(new Set(targets.map((file) => file.id)))
        } catch (error) {
          logger.error('Failed to confirm file deletion', error as Error)
          toast.error(t('files.error.delete_failed'))
        } finally {
          deleteRequestPendingRef.current = false
          setDeleteRequestPending(false)
        }
      })()
    },
    [files, performDelete, t]
  )

  const handleDelete = useCallback(
    (ids?: Set<string>) => requestDelete(ids ?? selectedIds),
    [requestDelete, selectedIds]
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
        toast.error(t('files.error.rename_failed'))
        setRenamingId(null)
      }
    },
    [files, refetchFiles, t]
  )

  const startInlineRename = useCallback((id: string) => {
    setRenamingId(id)
  }, [])

  const handleDeleteOne = useCallback((id: string) => requestDelete(new Set([id])), [requestDelete])
  const handleRenameConfirm = useCallback((id: string, name: string) => void handleRename(id, name), [handleRename])
  const handleRenameCancel = useCallback(() => setRenamingId(null), [])

  const listMenuActions = useMemo<FileContextMenuActions>(
    () => ({
      onRename: startInlineRename,
      onDelete: handleDeleteOne,
      onShowInFolder: handleShowInFolder
    }),
    [handleDeleteOne, handleShowInFolder, startInlineRename]
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
      if (embeddedPreview || renamingId || shouldIgnoreFileShortcut(e)) return
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedIds.size > 0) {
        e.preventDefault()
        if (deleteRequestPending) return
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
  }, [deleteRequestPending, embeddedPreview, files, selectedIds, handleDelete, renamingId, startInlineRename])

  return (
    <div data-ui="files.view" className="relative flex min-h-0 flex-1 overflow-hidden">
      <div className={`flex min-h-0 min-w-0 flex-1 overflow-hidden ${embeddedPreview ? 'invisible' : ''}`}>
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
          data-ui="files.content"
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
              .map((file) => AbsoluteFilePathSchema.safeParse(window.api.file.getPathForFile(file)).data)
              .filter((path): path is AbsoluteFilePath => Boolean(path))
            void handleImportPaths(paths)
          }}>
          <PageHeader
            title={activeFilterLabel}
            className="relative mb-0 h-9 pb-1 after:pointer-events-none after:absolute after:right-3 after:bottom-0 after:left-3 after:border-border after:border-b after:content-['']"
            action={
              <div className="flex shrink-0 items-center gap-2">
                {!isImageGrid && selectedIds.size > 0 && (
                  <FileToolbar
                    selectedCount={selectedIds.size}
                    batchDeleteLabel={batchDeleteLabel}
                    deleteDisabled={deleteRequestPending}
                    onBatchDelete={() => handleDelete()}
                  />
                )}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void handleUploadClick()}
                  className="-translate-y-px h-7 gap-1.5 rounded-md px-2.5 text-muted-foreground text-xs hover:text-foreground">
                  <Upload className="size-3.5 translate-y-px" />
                  <span>{t('files.upload')}</span>
                </Button>
              </div>
            }
          />

          {dragOver && (
            <div className="pointer-events-none absolute inset-0 z-50 m-2 flex items-center justify-center rounded-lg border-2 border-border-strong border-dashed bg-accent/25">
              <div className="text-center">
                <Upload size={28} className="mx-auto mb-2 text-muted-foreground" />
                <p className="text-muted-foreground text-xs">{t('files.drag_upload')}</p>
              </div>
            </div>
          )}

          {!isImageGrid && filteredFiles.length > 0 && (
            <FileListHeader
              visibleSelectionState={visibleSelectionState}
              onSelectAll={handleSelectAllVisible}
              sortKey={sortKey}
              sortDir={sortDir}
              onSort={handleSort}
            />
          )}

          <Scrollbar
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
              // While the first load is in flight, show loading feedback instead of
              // an empty state — otherwise the no-result state flashes before the
              // list arrives.
              isFilesLoading ? (
                <div className="flex h-full flex-1 items-center justify-center text-muted-foreground text-sm">
                  {t('common.loading')}
                </div>
              ) : (
                <div className="flex h-full flex-1 flex-col items-center justify-center px-6">
                  {files.length === 0 ? (
                    <EmptyState title={t('files.empty.title')} />
                  ) : (
                    <EmptyState preset="no-result" title={t('files.empty.no_match_title')} />
                  )}
                </div>
              )
            ) : (
              <>
                {isImageGrid ? (
                  <FileGrid
                    files={filteredFiles}
                    scrollRef={contentScrollRef}
                    onOpen={handleOpen}
                    onDelete={handleDeleteOne}
                    menuActions={listMenuActions}
                    renamingId={renamingId}
                    onRenameConfirm={handleRenameConfirm}
                    onRenameCancel={handleRenameCancel}
                    deleteDisabled={deleteRequestPending}
                  />
                ) : (
                  <FileList
                    files={filteredFiles}
                    scrollRef={contentScrollRef}
                    selectedIds={selectedIds}
                    onSelect={handleSelect}
                    onOpen={handleOpen}
                    menuActions={listMenuActions}
                    onDelete={handleDeleteOne}
                    onRename={startInlineRename}
                    onShowInFolder={handleShowInFolder}
                    renamingId={renamingId}
                    onRenameConfirm={handleRenameConfirm}
                    onRenameCancel={handleRenameCancel}
                    deleteDisabled={deleteRequestPending}
                  />
                )}
              </>
            )}
          </Scrollbar>
        </div>
      </div>

      {embeddedPreview && (
        <section
          aria-label={embeddedPreview.fileName}
          className="absolute inset-0 z-20 flex min-h-0 min-w-0 flex-col overflow-hidden">
          <FilePreview
            filePath={embeddedPreview.filePath}
            refreshKey={embeddedPreview.refreshKey}
            header={
              <>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t('common.back')}
                  className="size-6 min-h-6 min-w-6 rounded p-0 text-muted-foreground shadow-none hover:bg-accent hover:text-foreground"
                  onClick={() => setEmbeddedPreview(null)}>
                  <ArrowLeft className="size-3.5" />
                </Button>
                <span className="min-w-0 flex-1 truncate text-foreground text-sm">{embeddedPreview.fileName}</span>
              </>
            }
          />
        </section>
      )}
    </div>
  )
}

export default FilesPage
