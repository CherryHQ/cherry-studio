import { Button, Input } from '@cherrystudio/ui'
import {
  ChevronDown,
  ChevronsUpDown,
  ChevronUp,
  File,
  FileCode,
  FileText,
  Image as ImageIcon,
  Music,
  Video
} from 'lucide-react'
import type { FC } from 'react'
import { memo, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { FileItem } from './fileDisplay'
import { getFormatLabel } from './fileDisplay'

const typeIcons: Record<string, FC<{ size?: number; strokeWidth?: number; className?: string }>> = {
  image: ImageIcon,
  video: Video,
  audio: Music,
  text: FileCode,
  document: FileText,
  other: File
}

const typeIconColors: Record<string, string> = {
  image: 'text-pink-500/50',
  video: 'text-violet-500/50',
  audio: 'text-amber-500/50',
  text: 'text-cyan-500/50',
  document: 'text-blue-500/50',
  other: 'text-muted-foreground/40'
}

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
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={() => onSort(field)}
      className={`inline-flex w-fit items-center justify-start gap-0.5 p-0 text-xs uppercase tracking-wider transition-colors ${
        active ? 'text-muted-foreground' : 'text-muted-foreground/40 hover:text-foreground'
      } ${cn || ''}`}>
      <span>{label}</span>
      {active ? (
        sortDir === 'asc' ? (
          <ChevronUp size={9} className="shrink-0" />
        ) : (
          <ChevronDown size={9} className="shrink-0" />
        )
      ) : (
        <ChevronsUpDown size={9} className="shrink-0 text-muted-foreground/30" />
      )}
    </Button>
  )
}

export const FileList = memo(function FileList({
  files,
  selectedIds,
  onSelect,
  onContextMenu,
  onOpen,
  sortKey,
  sortDir,
  onSort,
  renamingId,
  onRenameConfirm,
  onRenameCancel
}: {
  files: FileItem[]
  selectedIds: Set<string>
  onSelect: (id: string, multi: boolean) => void
  onContextMenu: (e: React.MouseEvent, id: string) => void
  onOpen: (file: FileItem) => void
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
      </div>
      {files.map((file) => {
        const selected = selectedIds.has(file.id)
        const Icon = typeIcons[file.type] || File
        const isRenaming = renamingId === file.id
        return (
          <div
            key={file.id}
            onClick={(e) => {
              if (!isRenaming) onSelect(file.id, e.metaKey || e.ctrlKey)
            }}
            onContextMenu={(e) => onContextMenu(e, file.id)}
            onDoubleClick={() => {
              if (!isRenaming) onOpen(file)
            }}
            className={`flex cursor-pointer items-center gap-2 border-border/15 border-b px-4 py-[6px] transition-colors ${
              selected ? 'bg-accent/50' : 'hover:bg-accent/50'
            }`}>
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <Icon
                size={13}
                strokeWidth={1.4}
                className={`shrink-0 ${typeIconColors[file.type] || typeIconColors.other}`}
              />
              {isRenaming ? (
                <InlineRename
                  value={file.name}
                  onConfirm={(v) => onRenameConfirm(file.id, v)}
                  onCancel={onRenameCancel}
                />
              ) : (
                <span className="truncate text-foreground text-sm">{file.name}</span>
              )}
            </div>
            <span className="w-[70px] shrink-0 text-muted-foreground/50 text-xs">{file.size}</span>
            <span className="w-[55px] shrink-0 text-muted-foreground/50 text-xs">{getFormatLabel(file.format)}</span>
            <span className="w-[110px] shrink-0 text-muted-foreground/50 text-xs">{file.updatedAt}</span>
          </div>
        )
      })}
    </div>
  )
})

function InlineRename({
  value,
  onConfirm,
  onCancel
}: {
  value: string
  onConfirm: (v: string) => void
  onCancel: () => void
}) {
  const [text, setText] = useState(value)
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (ref.current) {
      ref.current.focus()
      const dotIdx = value.lastIndexOf('.')
      ref.current.setSelectionRange(0, dotIdx > 0 ? dotIdx : value.length)
    }
  }, [value])
  return (
    <Input
      ref={ref}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && text.trim()) onConfirm(text.trim())
        if (e.key === 'Escape') onCancel()
      }}
      onBlur={() => {
        if (text.trim()) onConfirm(text.trim())
        else onCancel()
      }}
      className="h-auto flex-1 rounded-md border border-border bg-background px-2 py-0.5 text-foreground text-xs shadow-sm focus-visible:border-primary/60 focus-visible:ring-2 focus-visible:ring-primary/15"
      onClick={(e) => e.stopPropagation()}
    />
  )
}
