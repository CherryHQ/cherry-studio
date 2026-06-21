import { Button, EmptyState } from '@cherrystudio/ui'
import { useQuery } from '@data/hooks/useDataApi'
import { loggerService } from '@logger'
import { ipcApi } from '@renderer/ipc'
import type { FileEntry } from '@shared/data/types/file'
import type { OutputFor } from '@shared/ipc/types'
import type { FilePath } from '@shared/types/file'
import type { FileType } from '@shared/types/file'
import { getFileTypeByExt } from '@shared/utils/file'
import { toSafeFileUrl } from '@shared/utils/file/urlUtil'
import { FolderClosed, Pencil, RotateCcw, Trash2, Upload, X } from 'lucide-react'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { FileItem } from './fileDisplay'
import { formatFileSize } from './fileDisplay'
import { FileGrid } from './FileGrid'
import type { SortDir, SortKey } from './FileList'
import { FileList } from './FileList'
import type { SidebarFilter } from './FileSidebar'
import { FileSidebar } from './FileSidebar'

const logger = loggerService.withContext('FilesPage')
const FILES_PAGE_LIMIT = 100

type FileMetadataById = OutputFor<'file.batch_get_metadata'>
type PhysicalPathById = OutputFor<'file.batch_get_physical_paths'>
type DanglingStateById = OutputFor<'file.batch_get_dangling_states'>

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

function compareFiles(a: FileItem, b: FileItem, sortKey: SortKey): number {
  switch (sortKey) {
    case 'name':
      return a.name.localeCompare(b.name)
    case 'size':
      return a.sizeBytes - b.sizeBytes
    case 'updatedAt':
      return a.updatedAt.localeCompare(b.updatedAt)
    case 'type':
      return a.type.localeCompare(b.type)
    default:
      return 0
  }
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

function logMutationFailures(action: string, result: { failed: Array<{ id: string; error: string }> } | null): void {
  if (result && result.failed.length > 0) {
    logger.warn(`${action} partially failed`, { failed: result.failed })
  }
}

function logImportFailures(result: { failed: Array<{ sourceRef: string; error: string }> }): void {
  if (result.failed.length > 0) {
    logger.warn('file import partially failed', { failed: result.failed })
  }
}

// ─── Popover (click-outside dismiss) ───

function Popover({
  x,
  y,
  children,
  onClose,
  width
}: {
  x: number
  y: number
  children: React.ReactNode
  onClose: () => void
  width?: number
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', h)
    document.addEventListener('keydown', k)
    return () => {
      document.removeEventListener('mousedown', h)
      document.removeEventListener('keydown', k)
    }
  }, [onClose])

  const [pos, setPos] = useState({ left: x, top: y })
  useEffect(() => {
    if (!ref.current) return
    const rect = ref.current.getBoundingClientRect()
    const nl = rect.right > window.innerWidth ? x - rect.width : x
    const nt = rect.bottom > window.innerHeight ? y - rect.height : y
    setPos({ left: Math.max(4, nl), top: Math.max(4, nt) })
  }, [x, y])

  return (
    <div
      ref={ref}
      className="fade-in zoom-in-95 fixed z-50 animate-in rounded-lg border border-border bg-popover shadow-xl duration-100"
      style={{ ...pos, width: width || undefined }}>
      {children}
    </div>
  )
}

// ─── Context Menu Item ───

function CMenuItem({
  icon: Icon,
  label,
  danger,
  onClick,
  disabled
}: {
  icon: React.ElementType
  label: string
  danger?: boolean
  onClick: () => void
  disabled?: boolean
}) {
  const colorClasses = disabled
    ? 'cursor-not-allowed text-muted-foreground/30'
    : danger
      ? 'text-destructive/70 hover:bg-destructive/[0.08]'
      : 'text-popover-foreground/70 hover:bg-accent'
  return (
    <Button
      size="sm"
      variant="ghost"
      onClick={onClick}
      disabled={disabled}
      className={`flex w-full items-center justify-start gap-1.5 rounded-md px-2 py-[5px] text-left text-xs transition-colors ${colorClasses}`}>
      <Icon size={11} className={disabled ? 'opacity-30' : ''} />
      <span>{label}</span>
    </Button>
  )
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
  const {
    data: activeFilesPage,
    isLoading: isActiveFilesLoading,
    error: activeFilesError,
    refetch: refetchActiveFiles
  } = useQuery('/files/entries', { query: { limit: FILES_PAGE_LIMIT } })
  const {
    data: trashedFilesPage,
    isLoading: isTrashedFilesLoading,
    error: trashedFilesError,
    refetch: refetchTrashedFiles
  } = useQuery('/files/entries', { query: { inTrash: true, limit: FILES_PAGE_LIMIT } })

  const [metadataById, setMetadataById] = useState<FileMetadataById>({})
  const [physicalPathById, setPhysicalPathById] = useState<PhysicalPathById>({})
  const [danglingStateById, setDanglingStateById] = useState<DanglingStateById>({})
  const [filter, setFilter] = useState<SidebarFilter>({ kind: 'library', value: 'all' })
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  const [sortKey, setSortKey] = useState<SortKey>('updatedAt')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; fileId: string } | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [renamingId, setRenamingId] = useState<string | null>(null)

  const entries = useMemo(
    () => [...(activeFilesPage?.items ?? []), ...(trashedFilesPage?.items ?? [])],
    [activeFilesPage?.items, trashedFilesPage?.items]
  )

  useEffect(() => {
    if (activeFilesError) logger.error('Failed to load active files', activeFilesError)
  }, [activeFilesError])

  useEffect(() => {
    if (trashedFilesError) logger.error('Failed to load trashed files', trashedFilesError)
  }, [trashedFilesError])

  useEffect(() => {
    if (entries.length === 0) {
      setMetadataById({})
      setPhysicalPathById({})
      setDanglingStateById({})
      return
    }

    let cancelled = false
    const ids = entries.map((entry) => entry.id)
    const imageIds = entries.filter((entry) => getFileTypeByExt(entry.ext ?? '') === 'image').map((entry) => entry.id)
    void Promise.all([
      ipcApi.request('file.batch_get_metadata', { ids }),
      imageIds.length > 0 ? ipcApi.request('file.batch_get_physical_paths', { ids: imageIds }) : Promise.resolve({}),
      ipcApi.request('file.batch_get_dangling_states', { ids })
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
  }, [entries])

  const files = useMemo(
    () =>
      entries.flatMap((entry) => {
        if (entry.origin === 'external' && danglingStateById[entry.id] === 'missing') return []
        const file = toFileItem(entry, metadataById, physicalPathById)
        return file ? [file] : []
      }),
    [entries, metadataById, physicalPathById, danglingStateById]
  )

  const refetchFiles = useCallback(async () => {
    await Promise.all([refetchActiveFiles(), refetchTrashedFiles()])
  }, [refetchActiveFiles, refetchTrashedFiles])

  const isTrash = filter.kind === 'library' && filter.value === 'trash'

  const handleOpen = useCallback((file: FileItem) => {
    void ipcApi.request('file.open', { id: file.id }).catch((error) => {
      logger.error('Failed to open file', error as Error)
    })
  }, [])

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
        logImportFailures(result)
        await refetchFiles()
      } catch (error) {
        logger.error('Failed to import files', error as Error)
      }
    },
    [refetchFiles]
  )

  const folderList = useMemo(() => {
    const set = new Set<string>()
    for (const f of files) {
      if (!f.trashed && f.origin === 'external' && f.folder) set.add(f.folder)
    }
    return [...set].sort()
  }, [files])

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

    result = [...result].sort((a, b) => {
      const cmp = compareFiles(a, b, sortKey)
      return sortDir === 'asc' ? cmp : -cmp
    })

    return result
  }, [files, filter, sortKey, sortDir])

  const fileCounts = useMemo(() => {
    const active = files.filter((f) => !f.trashed)
    const counts: Record<string, number> = {
      all: active.length,
      trash: files.filter((f) => f.trashed).length
    }
    for (const type of ['image', 'video', 'audio', 'text', 'document', 'other'] as FileType[]) {
      counts[`type_${type}`] = active.filter((f) => f.type === type).length
    }
    for (const f of active) {
      if (f.origin === 'external' && f.folder) {
        const key = `folder:${f.folder}`
        counts[key] = (counts[key] || 0) + 1
      }
    }
    return counts
  }, [files])

  const selectedFiles = useMemo(() => files.filter((file) => selectedIds.has(file.id)), [files, selectedIds])
  const batchDeleteLabel = (() => {
    if (isTrash) return t('files.permanent_delete')
    if (selectedFiles.length > 0 && selectedFiles.every((file) => file.origin === 'external')) {
      return t('files.remove_from_library')
    }
    if (selectedFiles.some((file) => file.origin === 'external')) return t('files.delete_or_remove')
    return t('files.delete.label')
  })()

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

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, id: string) => {
      e.preventDefault()
      if (!selectedIds.has(id)) setSelectedIds(new Set([id]))
      setContextMenu({ x: e.clientX, y: e.clientY, fileId: id })
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
          logMutationFailures('file permanent delete', result)
        } else {
          const trashIds = targets.filter((file) => file.origin === 'internal').map((file) => file.id)
          const removeIds = targets.filter((file) => file.origin === 'external').map((file) => file.id)
          const [trashResult, removeResult] = await Promise.all([
            trashIds.length > 0 ? ipcApi.request('file.batch_trash', { ids: trashIds }) : Promise.resolve(null),
            removeIds.length > 0
              ? ipcApi.request('file.batch_permanent_delete', { ids: removeIds })
              : Promise.resolve(null)
          ])
          logMutationFailures('file trash', trashResult)
          logMutationFailures('file remove external entries', removeResult)
        }

        setSelectedIds(new Set())
        await refetchFiles()
      } catch (error) {
        logger.error('Failed to delete files', error as Error)
      }
    },
    [files, isTrash, refetchFiles, selectedIds]
  )

  const handleRestore = useCallback(
    async (ids: Set<string>) => {
      try {
        const result = await ipcApi.request('file.batch_restore', { ids: [...ids] })
        logMutationFailures('file restore', result)
        setSelectedIds(new Set())
        await refetchFiles()
      } catch (error) {
        logger.error('Failed to restore files', error as Error)
      }
    },
    [refetchFiles]
  )

  const handleRename = useCallback(
    async (id: string, newName: string) => {
      const file = files.find((item) => item.id === id)
      if (!file) {
        setRenamingId(null)
        return
      }

      const entryName = stripCurrentExtension(newName, file.format).trim()
      if (!entryName) {
        setRenamingId(null)
        return
      }

      try {
        await ipcApi.request('file.rename', { id, newName: entryName })
        setRenamingId(null)
        await refetchFiles()
      } catch (error) {
        logger.error('Failed to rename file', error as Error)
        setRenamingId(null)
      }
    },
    [files, refetchFiles]
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
      if (renamingId) return
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedIds.size > 0) {
        void handleDelete()
      }
      if (e.key === 'F2' && selectedIds.size === 1) {
        e.preventDefault()
        setRenamingId([...selectedIds][0])
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [selectedIds, handleDelete, renamingId])

  const contextFile = contextMenu ? files.find((f) => f.id === contextMenu.fileId) : null
  const isFilesLoading = isActiveFilesLoading || isTrashedFilesLoading

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
        folders={folderList}
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
          className="relative flex-1 overflow-y-auto"
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
              onContextMenu={handleContextMenu}
              onOpen={handleOpen}
              onDelete={(id) => void handleDelete(new Set([id]))}
              renamingId={renamingId}
              onRenameConfirm={(id, name) => void handleRename(id, name)}
              onRenameCancel={() => setRenamingId(null)}
            />
          ) : (
            <FileList
              files={filteredFiles}
              selectedIds={selectedIds}
              onSelect={handleSelect}
              onContextMenu={handleContextMenu}
              onOpen={handleOpen}
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
            {t('files.footer_count', { count: filteredFiles.length })}
          </span>
          {selectedIds.size > 0 && (
            <span className="text-muted-foreground/40 text-xs">
              {t('files.footer_selected_count', { count: selectedIds.size })}
            </span>
          )}
          <div className="flex-1" />
        </div>
      </div>

      {/* Context Menu */}
      {contextMenu && contextFile && (
        <Popover x={contextMenu.x} y={contextMenu.y} onClose={() => setContextMenu(null)}>
          <div className="min-w-[130px] p-0.5">
            {isTrash ? (
              <div>
                <CMenuItem
                  icon={RotateCcw}
                  label={t('files.restore')}
                  onClick={() => {
                    void handleRestore(new Set([contextMenu.fileId]))
                    setContextMenu(null)
                  }}
                />
                <div className="mx-1.5 my-0.5 border-border/30 border-t" />
                <CMenuItem
                  icon={Trash2}
                  label={t('files.permanent_delete')}
                  danger
                  onClick={() => {
                    void handleDelete(new Set([contextMenu.fileId]))
                    setContextMenu(null)
                  }}
                />
              </div>
            ) : (
              <div>
                <CMenuItem
                  icon={Pencil}
                  label={t('files.rename')}
                  onClick={() => {
                    setRenamingId(contextMenu.fileId)
                    setContextMenu(null)
                  }}
                />
                {contextFile.origin === 'external' && contextFile.folder && (
                  <CMenuItem
                    icon={FolderClosed}
                    label={t('files.show_in_folder')}
                    onClick={() => {
                      handleShowInFolder(contextMenu.fileId)
                      setContextMenu(null)
                    }}
                  />
                )}
                <div className="mx-1.5 my-0.5 border-border/30 border-t" />
                <CMenuItem
                  icon={Trash2}
                  label={contextFile.origin === 'external' ? t('files.remove_from_library') : t('files.delete.label')}
                  danger
                  onClick={() => {
                    void handleDelete(new Set([contextMenu.fileId]))
                    setContextMenu(null)
                  }}
                />
              </div>
            )}
          </div>
        </Popover>
      )}
    </div>
  )
}

export default FilesPage
