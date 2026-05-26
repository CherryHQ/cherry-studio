import { Button, EmptyState } from '@cherrystudio/ui'
import { Copy, Download, Eye, FolderClosed, Pencil, RotateCcw, Share2, Trash2, Upload, X } from 'lucide-react'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { FileGrid } from './FileGrid'
import type { SortDir, SortKey } from './FileList'
import { FileList } from './FileList'
import { FilePreview } from './FilePreview'
import type { SidebarFilter } from './FileSidebar'
import { FileSidebar } from './FileSidebar'
import type { FileItem } from './mockData'
import { MOCK_FILES } from './mockData'

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
      className="animate-in fade-in zoom-in-95 fixed z-50 rounded-lg border border-border bg-popover shadow-xl duration-100"
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
  return (
    <Button
      size="sm"
      variant="ghost"
      onClick={onClick}
      disabled={disabled}
      className={`flex w-full items-center justify-start gap-1.5 rounded-md px-2 py-[5px] text-left text-xs transition-colors ${
        disabled
          ? 'cursor-not-allowed text-muted-foreground/30'
          : danger
            ? 'text-destructive/70 hover:bg-destructive/[0.08]'
            : 'text-popover-foreground/70 hover:bg-accent'
      }`}>
      <Icon size={11} className={disabled ? 'opacity-30' : ''} />
      <span>{label}</span>
    </Button>
  )
}

// ─── Batch Action Bar ───

const BatchBar = memo(function BatchBar({
  count,
  onDelete,
  onDownload,
  onClear
}: {
  count: number
  onDelete: () => void
  onDownload: () => void
  onClear: () => void
}) {
  return (
    <div className="flex items-center gap-2 border-b border-border/30 bg-accent/50 px-4 py-1.5">
      <span className="text-xs font-medium text-muted-foreground">已选择 {count} 个文件</span>
      <div className="flex-1" />
      <Button
        variant="ghost"
        size="sm"
        onClick={onDownload}
        className="flex items-center gap-1 rounded-md px-2 py-[3px] text-xs text-muted-foreground/60 transition-colors hover:bg-accent">
        <Download size={10} />
        <span>下载</span>
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={onDelete}
        className="flex items-center gap-1 rounded-md px-2 py-[3px] text-xs text-destructive/60 transition-colors hover:bg-destructive/[0.08]">
        <Trash2 size={10} />
        <span>删除</span>
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

const RE_EXT_SUFFIX = new RegExp('(' + String.fromCharCode(92) + '.' + String.fromCharCode(92) + 'w+)$')

// ─── Main FilePage ───

function FilesPage() {
  const [files, setFiles] = useState<FileItem[]>(MOCK_FILES)
  const [filter, setFilter] = useState<SidebarFilter>({ kind: 'library', value: 'all' })
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [previewFile, setPreviewFile] = useState<FileItem | null>(null)
  const [sortKey, setSortKey] = useState<SortKey>('updatedAt')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; fileId: string } | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [renamingId, setRenamingId] = useState<string | null>(null)

  const folderList = useMemo(() => {
    const set = new Set<string>()
    for (const f of files) {
      if (!f.trashed && f.folder) set.add(f.folder)
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
      result = result.filter((f) => !f.trashed && f.folder === filter.value)
    }

    result = [...result].sort((a, b) => {
      let cmp = 0
      if (sortKey === 'name') cmp = a.name.localeCompare(b.name)
      else if (sortKey === 'size') cmp = a.sizeBytes - b.sizeBytes
      else if (sortKey === 'updatedAt') cmp = a.updatedAt.localeCompare(b.updatedAt)
      else if (sortKey === 'type') cmp = a.type.localeCompare(b.type)
      return sortDir === 'asc' ? cmp : -cmp
    })

    return result
  }, [files, filter, sortKey, sortDir])

  const fileCounts = useMemo(() => {
    const active = files.filter((f) => !f.trashed)
    const counts: Record<string, number> = {
      all: active.length,
      trash: files.filter((f) => f.trashed).length,
      type_image: active.filter((f) => f.type === 'image').length,
      type_video: active.filter((f) => f.type === 'video').length,
      type_audio: active.filter((f) => f.type === 'audio').length,
      type_text: active.filter((f) => f.type === 'text').length,
      type_document: active.filter((f) => f.type === 'document').length,
      type_other: active.filter((f) => f.type === 'other').length
    }
    for (const f of active) {
      if (f.folder) {
        const key = `folder:${f.folder}`
        counts[key] = (counts[key] || 0) + 1
      }
    }
    return counts
  }, [files])

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
    (ids?: Set<string>) => {
      const targets = ids || selectedIds
      if (filter.kind === 'library' && filter.value === 'trash') {
        setFiles((prev) => prev.filter((f) => !targets.has(f.id)))
      } else {
        setFiles((prev) => prev.map((f) => (targets.has(f.id) ? { ...f, trashed: true } : f)))
      }
      setSelectedIds(new Set())
    },
    [selectedIds, filter]
  )

  const handleRestore = useCallback((ids: Set<string>) => {
    setFiles((prev) => prev.map((f) => (ids.has(f.id) ? { ...f, trashed: false } : f)))
    setSelectedIds(new Set())
  }, [])

  const handleRename = useCallback((id: string, newName: string) => {
    setFiles((prev) => prev.map((f) => (f.id === id ? { ...f, name: newName } : f)))
    setRenamingId(null)
  }, [])

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
      if (e.key === ' ' && selectedIds.size === 1 && !previewFile) {
        e.preventDefault()
        const file = files.find((f) => selectedIds.has(f.id))
        if (file) setPreviewFile(file)
      }
      if (e.key === 'Escape' && previewFile) setPreviewFile(null)
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedIds.size > 0 && !previewFile) {
        handleDelete()
      }
      if (e.key === 'F2' && selectedIds.size === 1) {
        e.preventDefault()
        setRenamingId([...selectedIds][0])
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [selectedIds, files, previewFile, handleDelete, renamingId])

  const isTrash = filter.kind === 'library' && filter.value === 'trash'
  const contextFile = contextMenu ? files.find((f) => f.id === contextMenu.fileId) : null

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
        }}>
        {selectedIds.size > 1 && (
          <BatchBar
            count={selectedIds.size}
            onDelete={() => handleDelete()}
            onDownload={() => {}}
            onClear={() => setSelectedIds(new Set())}
          />
        )}

        {dragOver && (
          <div className="pointer-events-none absolute inset-0 z-50 m-2 flex items-center justify-center rounded-lg border-2 border-dashed border-border/50 bg-accent/25">
            <div className="text-center">
              <Upload size={28} className="mx-auto mb-2 text-muted-foreground/40" />
              <p className="text-xs text-muted-foreground/40">拖拽文件到此处上传</p>
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
              {files.filter((f) => !f.trashed).length === 0 ? (
                <EmptyState preset="no-file" />
              ) : (
                <EmptyState preset="no-result" title="没有找到匹配的文件" description="当前筛选条件下没有文件" />
              )}
            </div>
          ) : filter.kind === 'type' && filter.value === 'image' ? (
            <FileGrid
              files={filteredFiles}
              selectedIds={selectedIds}
              onSelect={handleSelect}
              onContextMenu={handleContextMenu}
              onPreview={setPreviewFile}
              onDelete={(id) => handleDelete(new Set([id]))}
              renamingId={renamingId}
              onRenameConfirm={handleRename}
              onRenameCancel={() => setRenamingId(null)}
            />
          ) : (
            <FileList
              files={filteredFiles}
              selectedIds={selectedIds}
              onSelect={handleSelect}
              onContextMenu={handleContextMenu}
              onPreview={setPreviewFile}
              sortKey={sortKey}
              sortDir={sortDir}
              onSort={handleSort}
              renamingId={renamingId}
              onRenameConfirm={handleRename}
              onRenameCancel={() => setRenamingId(null)}
            />
          )}
        </div>

        <div className="flex items-center gap-3 border-t border-border/15 px-4 py-1">
          <span className="text-xs text-muted-foreground/40">{filteredFiles.length} 个文件</span>
          {selectedIds.size > 0 && <span className="text-xs text-muted-foreground/40">{selectedIds.size} 个已选</span>}
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
                  label="恢复"
                  onClick={() => {
                    handleRestore(new Set([contextMenu.fileId]))
                    setContextMenu(null)
                  }}
                />
                <div className="mx-1.5 my-0.5 border-t border-border/30" />
                <CMenuItem
                  icon={Trash2}
                  label="永久删除"
                  danger
                  onClick={() => {
                    handleDelete(new Set([contextMenu.fileId]))
                    setContextMenu(null)
                  }}
                />
              </div>
            ) : (
              <div>
                <CMenuItem
                  icon={Eye}
                  label="预览"
                  onClick={() => {
                    setPreviewFile(contextFile)
                    setContextMenu(null)
                  }}
                />
                <CMenuItem icon={Download} label="下载" onClick={() => setContextMenu(null)} />
                <CMenuItem icon={Share2} label="分享" onClick={() => setContextMenu(null)} />
                <div className="mx-1.5 my-0.5 border-t border-border/30" />
                <CMenuItem
                  icon={Pencil}
                  label="重命名"
                  onClick={() => {
                    setRenamingId(contextMenu.fileId)
                    setContextMenu(null)
                  }}
                />
                <CMenuItem
                  icon={Copy}
                  label="复制"
                  onClick={() => {
                    const orig = files.find((f) => f.id === contextMenu.fileId)
                    if (orig) {
                      const copy: FileItem = {
                        ...orig,
                        id: `${orig.id}_copy_${Date.now()}`,
                        name: `${orig.name.replace(RE_EXT_SUFFIX, ' (副本)$1')}`
                      }
                      setFiles((prev) => [...prev, copy])
                    }
                    setContextMenu(null)
                  }}
                />
                {contextFile.folder && (
                  <CMenuItem icon={FolderClosed} label="打开所在文件夹" onClick={() => setContextMenu(null)} />
                )}
                <div className="mx-1.5 my-0.5 border-t border-border/30" />
                <CMenuItem
                  icon={Trash2}
                  label="删除"
                  danger
                  onClick={() => {
                    handleDelete(new Set([contextMenu.fileId]))
                    setContextMenu(null)
                  }}
                />
              </div>
            )}
          </div>
        </Popover>
      )}

      {/* Preview Modal */}
      {previewFile && <FilePreview file={previewFile} onClose={() => setPreviewFile(null)} />}
    </div>
  )
}

export default FilesPage
