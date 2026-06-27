import { Button, Checkbox, type CheckedState } from '@cherrystudio/ui'
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
  const iconClass = active ? 'shrink-0' : 'shrink-0 text-muted-foreground/30'
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={() => onSort(field)}
      className={`inline-flex h-6 w-fit items-center justify-start gap-0.5 rounded-md px-1.5 py-0 text-xs uppercase tracking-wider transition-colors ${
        active ? 'text-muted-foreground' : 'text-muted-foreground/40 hover:text-foreground'
      } ${cn || ''}`}>
      <span>{label}</span>
      <SortIcon size={9} className={iconClass} />
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
      <div className="sticky top-0 z-10 flex items-center gap-2 border-border/30 border-b bg-background px-4 py-1.5">
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
        <div className="w-[55px]">
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
        <div className="w-[104px] text-right text-muted-foreground/40 text-xs uppercase tracking-wider">
          {t('files.actions')}
        </div>
      </div>
      {files.map((file) => {
        const selected = selectedIds.has(file.id)
        const Icon = typeIcons[file.type]
        const isRenaming = renamingId === file.id
        return (
          <FileContextMenu key={file.id} file={file} isTrash={isTrash} actions={menuActions}>
            <div
              onDoubleClick={() => {
                if (!isRenaming && !file.isMissing) onOpen(file)
              }}
              className={`group flex cursor-default items-center gap-2 border-border/15 border-b px-4 py-[6px] transition-colors ${
                selected ? 'bg-accent/50' : 'hover:bg-accent/50'
              }`}>
              <div className="flex w-5 shrink-0 items-center justify-center">
                <Checkbox
                  size="sm"
                  checked={selected}
                  onCheckedChange={() => onSelect(file.id)}
                  onClick={(e) => e.stopPropagation()}
                  aria-label={t('files.select_file', { name: file.name })}
                />
              </div>
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <Icon size={13} strokeWidth={1.4} className={`shrink-0 ${typeIconColors[file.type]}`} />
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
              <span className="w-[70px] shrink-0 text-muted-foreground/50 text-xs">{file.size}</span>
              <span className="w-[55px] shrink-0 text-muted-foreground/50 text-xs">{getFormatLabel(file.format)}</span>
              <span className="w-[110px] shrink-0 text-muted-foreground/50 text-xs">{file.updatedAt}</span>
              <div className="flex w-[104px] shrink-0 items-center justify-end gap-0.5">
                {isTrash ? (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t('files.restore')}
                    title={t('files.restore')}
                    className="text-muted-foreground/55 hover:text-foreground"
                    onClick={(e) => {
                      e.stopPropagation()
                      onRestore(file.id)
                    }}>
                    <RotateCcw size={12} />
                  </Button>
                ) : (
                  <>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t('files.open')}
                      title={t('files.open')}
                      className="text-muted-foreground/55 hover:text-foreground"
                      disabled={file.isMissing}
                      onClick={(e) => {
                        e.stopPropagation()
                        onOpen(file)
                      }}>
                      <SquareArrowOutUpRight size={12} />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t('files.rename')}
                      title={t('files.rename')}
                      className="text-muted-foreground/55 hover:text-foreground"
                      onClick={(e) => {
                        e.stopPropagation()
                        onRename(file.id)
                      }}>
                      <Pencil size={12} />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t('files.show_in_folder')}
                      title={t('files.show_in_folder')}
                      className="text-muted-foreground/55 hover:text-foreground"
                      onClick={(e) => {
                        e.stopPropagation()
                        onShowInFolder(file.id)
                      }}>
                      <FolderOpen size={12} />
                    </Button>
                  </>
                )}
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={isTrash ? t('files.permanent_delete') : t('files.delete.label')}
                  title={isTrash ? t('files.permanent_delete') : t('files.delete.label')}
                  className="text-muted-foreground/55 hover:text-destructive"
                  onClick={(e) => {
                    e.stopPropagation()
                    onDelete(file.id)
                  }}>
                  <Trash2 size={12} />
                </Button>
              </div>
            </div>
          </FileContextMenu>
        )
      })}
    </div>
  )
})
