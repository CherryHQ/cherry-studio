import { Button, Checkbox, type CheckedState } from '@cherrystudio/ui'
import { useVirtualizer } from '@tanstack/react-virtual'
import {
  ChevronDown,
  ChevronsUpDown,
  ChevronUp,
  FolderOpen,
  Pencil,
  RotateCcw,
  SquareArrowOutUpRight,
  Trash2
} from 'lucide-react'
import { memo, type RefObject, useCallback, useEffect } from 'react'
import { useTranslation } from 'react-i18next'

import { FileContextMenu, type FileContextMenuActions } from './FileContextMenu'
import type { FileItem } from './fileDisplay'
import { getFormatLabel, typeIconColors, typeIcons } from './fileDisplay'
import { InlineRename } from './InlineRename'

export type SortKey = 'name' | 'size' | 'updatedAt' | 'type'
export type SortDir = 'asc' | 'desc'

const FILE_ROW_HEIGHT_PX = 44
const FILE_LIST_GRID = 'grid grid-cols-[2.5rem_minmax(0,1fr)_4.5rem_4rem_7rem_6.5rem] items-center gap-2'
const FILE_LIST_CHECKBOX_CLASS_NAME =
  'inline-flex items-center justify-center align-middle text-foreground hover:bg-accent data-[state=checked]:border-border-selected data-[state=checked]:bg-background-subtle data-[state=checked]:text-foreground focus-visible:border-ring'

function SortHeader({
  label,
  field,
  sortKey,
  sortDir,
  onSort
}: {
  label: string
  field: SortKey
  sortKey: SortKey
  sortDir: SortDir
  onSort: (key: SortKey) => void
}) {
  const active = sortKey === field
  const SortIcon = active ? (sortDir === 'asc' ? ChevronUp : ChevronDown) : ChevronsUpDown
  const iconClass = active ? 'shrink-0 opacity-70' : 'shrink-0 opacity-40'
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={() => onSort(field)}
      className="!text-muted-foreground hover:!text-foreground h-full min-h-0 w-full justify-start gap-1 rounded-none px-0 py-0 font-medium text-xs shadow-none hover:bg-transparent">
      <span>{label}</span>
      <SortIcon size={9} className={iconClass} />
    </Button>
  )
}

export const FileListHeader = memo(function FileListHeader({
  visibleSelectionState,
  onSelectAll,
  sortKey,
  sortDir,
  onSort
}: {
  visibleSelectionState: CheckedState
  onSelectAll: (checked: boolean) => void
  sortKey: SortKey
  sortDir: SortDir
  onSort: (key: SortKey) => void
}) {
  const { t } = useTranslation()

  return (
    <div className={`${FILE_LIST_GRID} mx-3 mb-2 h-10 shrink-0 border-border border-b px-2.5`}>
      <div className="flex items-center self-stretch">
        <label className="flex size-full cursor-pointer items-center">
          <Checkbox
            size="sm"
            className={FILE_LIST_CHECKBOX_CLASS_NAME}
            checked={visibleSelectionState}
            onCheckedChange={(checked) => onSelectAll(Boolean(checked))}
            aria-label={t('files.select_all')}
          />
        </label>
      </div>
      <div className="min-w-0 self-stretch">
        <SortHeader label={t('files.name')} field="name" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
      </div>
      <div className="self-stretch">
        <SortHeader label={t('files.size')} field="size" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
      </div>
      <div className="self-stretch">
        <SortHeader label={t('files.type')} field="type" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
      </div>
      <div className="self-stretch">
        <SortHeader
          label={t('files.modified_at')}
          field="updatedAt"
          sortKey={sortKey}
          sortDir={sortDir}
          onSort={onSort}
        />
      </div>
      <div aria-label={t('files.actions')} />
    </div>
  )
})

export const FileList = memo(function FileList({
  files,
  selectedIds,
  onSelect,
  onOpen,
  onDelete,
  onRestore,
  onRename,
  onShowInFolder,
  isTrash,
  menuActions,
  scrollRef,
  renamingId,
  onRenameConfirm,
  onRenameCancel
}: {
  files: FileItem[]
  selectedIds: Set<string>
  onSelect: (id: string, isChecked: boolean, shouldSelectRange: boolean) => void
  onOpen: (file: FileItem) => void
  onDelete: (id: string) => void
  onRestore: (id: string) => void
  onRename: (id: string) => void
  onShowInFolder: (id: string) => void
  isTrash: boolean
  menuActions: FileContextMenuActions
  scrollRef: RefObject<HTMLDivElement | null>
  renamingId: string | null
  onRenameConfirm: (id: string, name: string) => void
  onRenameCancel: () => void
}) {
  const { t } = useTranslation()
  const getItemKey = useCallback((index: number) => files[index]?.id ?? index, [files])
  const rowVirtualizer = useVirtualizer({
    count: files.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => FILE_ROW_HEIGHT_PX,
    getItemKey,
    overscan: 8
  })

  useEffect(() => {
    if (!renamingId) return
    const index = files.findIndex((file) => file.id === renamingId)
    if (index >= 0) rowVirtualizer.scrollToIndex(index, { align: 'auto' })
  }, [files, renamingId, rowVirtualizer])

  return (
    <div className="relative flex flex-col" style={{ height: rowVirtualizer.getTotalSize() }}>
      {rowVirtualizer.getVirtualItems().map((virtualRow) => {
        const file = files[virtualRow.index]
        if (!file) return null
        const selected = selectedIds.has(file.id)
        const Icon = typeIcons[file.type]
        const isRenaming = renamingId === file.id
        const canUseFileActions = !file.isMissing
        const canRestore = isTrash && canUseFileActions
        const canOpen = !isTrash && canUseFileActions
        const canRename = !isTrash && canUseFileActions
        const canShowInFolder = !isTrash && canUseFileActions
        const deleteLabel = isTrash
          ? t('files.permanent_delete')
          : file.origin === 'external'
            ? t('files.remove_from_library')
            : t('files.delete.label')
        const renderActionPlaceholder = (key: string) => <div key={key} className="size-6" aria-hidden="true" />

        return (
          <FileContextMenu key={file.id} file={file} isTrash={isTrash} actions={menuActions}>
            <div
              onClick={() => {
                if (!isRenaming && !file.isMissing) onOpen(file)
              }}
              className={`${FILE_LIST_GRID} group absolute top-0 right-3 left-3 h-10 cursor-default rounded-md px-2.5 transition-colors ${
                selected ? 'bg-accent ring-1 ring-border-subtle ring-inset' : 'hover:bg-accent'
              }`}
              style={{ transform: `translateY(${virtualRow.start}px)` }}>
              <div className="flex items-center self-stretch" onClick={(e) => e.stopPropagation()}>
                <label className="flex size-full cursor-pointer items-center">
                  <Checkbox
                    size="sm"
                    className={FILE_LIST_CHECKBOX_CLASS_NAME}
                    checked={selected}
                    onClick={(e) => {
                      e.stopPropagation()
                      onSelect(file.id, !selected, e.shiftKey)
                    }}
                    data-file-selection-checkbox
                    aria-label={
                      file.sourcePath
                        ? t('files.select_file_with_path', { name: file.name, path: file.sourcePath })
                        : t('files.select_file', { name: file.name })
                    }
                  />
                </label>
              </div>
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <span className="flex size-6 shrink-0 items-center justify-center rounded-md border border-border-subtle bg-background-subtle">
                  <Icon size={14} strokeWidth={1.4} className={`shrink-0 ${typeIconColors[file.type]}`} />
                </span>
                {isRenaming ? (
                  <InlineRename
                    value={file.name}
                    onConfirm={(v) => onRenameConfirm(file.id, v)}
                    onCancel={onRenameCancel}
                    className="flex-1 px-2"
                  />
                ) : (
                  <>
                    <span className="truncate text-foreground text-sm" title={file.sourcePath ?? file.name}>
                      {file.name}
                    </span>
                    {file.isMissing && (
                      <span className="shrink-0 rounded border border-error-border bg-error-subtle px-1.5 py-0.5 text-[10px] text-error-subtle-foreground">
                        {t('files.missing')}
                      </span>
                    )}
                  </>
                )}
              </div>
              <span className="truncate text-muted-foreground text-xs">{file.size}</span>
              <span className="truncate text-muted-foreground text-xs">{getFormatLabel(file.format)}</span>
              <span className="truncate text-foreground-tertiary text-xs">{file.updatedAt}</span>
              <div className="grid grid-cols-4 justify-items-center gap-0.5 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
                {canOpen ? (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t('files.open')}
                    title={t('files.open')}
                    className="!text-muted-foreground hover:!text-foreground size-6 hover:bg-transparent"
                    onClick={(e) => {
                      e.stopPropagation()
                      onOpen(file)
                    }}>
                    <SquareArrowOutUpRight size={13} />
                  </Button>
                ) : (
                  renderActionPlaceholder('open')
                )}
                {canRename ? (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t('files.rename')}
                    title={t('files.rename')}
                    className="!text-muted-foreground hover:!text-foreground size-6 hover:bg-transparent"
                    onClick={(e) => {
                      e.stopPropagation()
                      onRename(file.id)
                    }}>
                    <Pencil size={13} />
                  </Button>
                ) : (
                  renderActionPlaceholder('rename')
                )}
                {canRestore ? (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t('files.restore')}
                    title={t('files.restore')}
                    className="!text-muted-foreground hover:!text-foreground size-6 hover:bg-transparent"
                    onClick={(e) => {
                      e.stopPropagation()
                      onRestore(file.id)
                    }}>
                    <RotateCcw size={13} />
                  </Button>
                ) : canShowInFolder ? (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t('files.show_in_folder')}
                    title={t('files.show_in_folder')}
                    className="!text-muted-foreground hover:!text-foreground size-6 hover:bg-transparent"
                    onClick={(e) => {
                      e.stopPropagation()
                      onShowInFolder(file.id)
                    }}>
                    <FolderOpen size={14} />
                  </Button>
                ) : (
                  renderActionPlaceholder('location')
                )}
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={deleteLabel}
                  title={deleteLabel}
                  className="!text-muted-foreground hover:!text-destructive size-6 hover:bg-transparent"
                  onClick={(e) => {
                    e.stopPropagation()
                    onDelete(file.id)
                  }}>
                  <Trash2 size={13} />
                </Button>
              </div>
            </div>
          </FileContextMenu>
        )
      })}
    </div>
  )
})
