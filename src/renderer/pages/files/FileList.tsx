import {
  Button,
  Checkbox,
  type CheckedState,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@cherrystudio/ui'
import {
  ChevronDown,
  ChevronsUpDown,
  ChevronUp,
  FolderOpen,
  MoreHorizontal,
  Pencil,
  RotateCcw,
  SquareArrowOutUpRight,
  Trash2
} from 'lucide-react'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'

import { FileContextMenu, type FileContextMenuActions } from './FileContextMenu'
import type { FileItem } from './fileDisplay'
import { getFormatLabel, typeIconColors, typeIcons } from './fileDisplay'
import { InlineRename } from './InlineRename'

export type SortKey = 'name' | 'size' | 'updatedAt' | 'type'
export type SortDir = 'asc' | 'desc'

function SortHeader({
  label,
  field,
  sortKey,
  sortDir,
  onSort,
  className: cn
}: {
  label: string
  field: SortKey
  sortKey: SortKey
  sortDir: SortDir
  onSort: (key: SortKey) => void
  className?: string
}) {
  const active = sortKey === field
  const SortIcon = active ? (sortDir === 'asc' ? ChevronUp : ChevronDown) : ChevronsUpDown
  const iconClass = active ? 'shrink-0' : 'shrink-0 opacity-0 transition-opacity group-hover:opacity-100'
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={() => onSort(field)}
      className={`group inline-flex h-6 w-fit items-center justify-start gap-0.5 rounded-md px-1.5 py-0 text-xs uppercase tracking-wider transition-colors ${
        active ? 'text-foreground/80' : 'text-muted-foreground hover:text-foreground'
      } ${cn || ''}`}>
      <span>{label}</span>
      <SortIcon size={12} className={iconClass} />
    </Button>
  )
}

export const FileList = memo(function FileList({
  files,
  selectedIds,
  onSelect,
  onOpen,
  onSelectAll,
  visibleSelectionState,
  onDelete,
  onRestore,
  onRename,
  onShowInFolder,
  isTrash,
  menuActions,
  sortKey,
  sortDir,
  onSort,
  renamingId,
  onRenameConfirm,
  onRenameCancel
}: {
  files: FileItem[]
  selectedIds: Set<string>
  onSelect: (id: string) => void
  onOpen: (file: FileItem) => void
  onSelectAll: (checked: boolean) => void
  visibleSelectionState: CheckedState
  onDelete: (id: string) => void
  onRestore: (id: string) => void
  onRename: (id: string) => void
  onShowInFolder: (id: string) => void
  isTrash: boolean
  menuActions: FileContextMenuActions
  sortKey: SortKey
  sortDir: SortDir
  onSort: (key: SortKey) => void
  renamingId: string | null
  onRenameConfirm: (id: string, name: string) => void
  onRenameCancel: () => void
}) {
  const { t } = useTranslation()

  return (
    <div className="flex flex-col">
      <div className="sticky top-0 z-10 flex items-center gap-3 border-border/30 border-b bg-background px-4 py-1.5">
        <div className="flex w-5 shrink-0 items-center justify-center">
          <Checkbox
            size="sm"
            checked={visibleSelectionState}
            onCheckedChange={(checked) => onSelectAll(Boolean(checked))}
            aria-label={t('files.select_all')}
          />
        </div>
        <div className="min-w-0 flex-1">
          <SortHeader label={t('files.name')} field="name" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
        </div>
        <div className="w-[70px]">
          <SortHeader label={t('files.size')} field="size" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
        </div>
        <div className="w-[72px]">
          <SortHeader label={t('files.type')} field="type" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
        </div>
        <div className="w-[110px]">
          <SortHeader
            label={t('files.modified_at')}
            field="updatedAt"
            sortKey={sortKey}
            sortDir={sortDir}
            onSort={onSort}
          />
        </div>
        <div className="w-10 text-right text-muted-foreground text-xs uppercase tracking-wider">
          {t('files.actions')}
        </div>
      </div>
      {files.map((file) => {
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

        return (
          <FileContextMenu key={file.id} file={file} isTrash={isTrash} actions={menuActions}>
            <div
              onDoubleClick={() => {
                if (!isRenaming && !file.isMissing) onOpen(file)
              }}
              className={`group flex cursor-default items-center gap-3 border-border/15 border-b px-4 py-[6px] transition-colors ${
                selected ? 'bg-accent/50' : 'hover:bg-accent/50'
              }`}>
              <div className="flex w-5 shrink-0 items-center justify-center">
                <Checkbox
                  size="sm"
                  checked={selected}
                  onCheckedChange={() => onSelect(file.id)}
                  onClick={(e) => e.stopPropagation()}
                  data-file-selection-checkbox
                  aria-label={t('files.select_file', { name: file.name })}
                />
              </div>
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <Icon size={13} className={`shrink-0 ${typeIconColors[file.type]}`} />
                {isRenaming ? (
                  <InlineRename
                    value={file.name}
                    onConfirm={(v) => onRenameConfirm(file.id, v)}
                    onCancel={onRenameCancel}
                    className="flex-1 px-2"
                  />
                ) : (
                  <>
                    <span className="truncate text-foreground text-sm">{file.name}</span>
                    {file.isMissing && (
                      <span className="shrink-0 rounded bg-destructive/10 px-1.5 py-0.5 text-[10px] text-destructive/70">
                        {t('files.missing')}
                      </span>
                    )}
                  </>
                )}
              </div>
              <span className="w-[70px] shrink-0 text-muted-foreground text-xs">{file.size}</span>
              <span className="w-[72px] shrink-0 text-muted-foreground text-xs">{getFormatLabel(file.format)}</span>
              <span className="w-[110px] shrink-0 text-muted-foreground text-xs">{file.updatedAt}</span>
              <div className="flex w-10 shrink-0 items-center justify-end">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t('common.more')}
                      title={t('common.more')}
                      className="text-muted-foreground/55 hover:text-foreground"
                      onClick={(e) => e.stopPropagation()}>
                      <MoreHorizontal size={14} />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                    {canOpen && (
                      <DropdownMenuItem onSelect={() => onOpen(file)}>
                        <SquareArrowOutUpRight size={12} />
                        {t('files.open')}
                      </DropdownMenuItem>
                    )}
                    {canRename && (
                      <DropdownMenuItem onSelect={() => onRename(file.id)}>
                        <Pencil size={12} />
                        {t('files.rename')}
                      </DropdownMenuItem>
                    )}
                    {canRestore ? (
                      <DropdownMenuItem onSelect={() => onRestore(file.id)}>
                        <RotateCcw size={12} />
                        {t('files.restore')}
                      </DropdownMenuItem>
                    ) : canShowInFolder ? (
                      <DropdownMenuItem onSelect={() => onShowInFolder(file.id)}>
                        <FolderOpen size={14} />
                        {t('files.show_in_folder')}
                      </DropdownMenuItem>
                    ) : null}
                    <DropdownMenuItem variant="destructive" onSelect={() => onDelete(file.id)}>
                      <Trash2 size={12} />
                      {deleteLabel}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          </FileContextMenu>
        )
      })}
    </div>
  )
})
