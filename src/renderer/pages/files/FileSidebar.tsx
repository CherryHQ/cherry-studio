import { Button } from '@cherrystudio/ui'
import {
  FileCode,
  FileQuestion,
  Files,
  FileText,
  FolderClosed,
  Image as ImageIcon,
  Music,
  Trash2,
  Video
} from 'lucide-react'
import type { FC } from 'react'

export type SidebarFilter =
  | { kind: 'library'; value: 'all' | 'trash' }
  | { kind: 'type'; value: 'image' | 'video' | 'audio' | 'text' | 'document' | 'other' }
  | { kind: 'folder'; value: string }

type SidebarEntry = {
  kind: string
  value: string
  label: string
  icon: FC<{ size?: number; strokeWidth?: number; className?: string }>
  countKey: string
}

const TYPE_ENTRIES: SidebarEntry[] = [
  { kind: 'type', value: 'image', label: '图片', icon: ImageIcon, countKey: 'type_image' },
  { kind: 'type', value: 'video', label: '视频', icon: Video, countKey: 'type_video' },
  { kind: 'type', value: 'audio', label: '音频', icon: Music, countKey: 'type_audio' },
  { kind: 'type', value: 'text', label: '文本', icon: FileCode, countKey: 'type_text' },
  { kind: 'type', value: 'document', label: '文档', icon: FileText, countKey: 'type_document' },
  { kind: 'type', value: 'other', label: '其他', icon: FileQuestion, countKey: 'type_other' }
]

const LIBRARY_ENTRIES: SidebarEntry[] = [
  { kind: 'library', value: 'all', label: '全部文件', icon: Files, countKey: 'all' },
  { kind: 'library', value: 'trash', label: '回收站', icon: Trash2, countKey: 'trash' }
]

export function FileSidebar({
  filter,
  onFilterChange,
  fileCounts,
  folders
}: {
  filter: SidebarFilter
  onFilterChange: (f: SidebarFilter) => void
  fileCounts: Record<string, number>
  folders: string[]
}) {
  const isActive = (kind: string, value: string) => filter.kind === kind && filter.value === value

  const renderEntry = (entry: SidebarEntry) => {
    const active = isActive(entry.kind, entry.value)
    const Icon = entry.icon
    const count = fileCounts[entry.countKey]
    return (
      <Button
        key={`${entry.kind}-${entry.value}`}
        variant="ghost"
        size="sm"
        onClick={() => onFilterChange({ kind: entry.kind, value: entry.value } as SidebarFilter)}
        className={`w-full justify-start gap-2 px-2.5 py-[5px] ${
          active ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
        }`}>
        <Icon size={13} strokeWidth={1.5} className="shrink-0 text-muted-foreground/60" />
        <span className="flex-1 truncate text-left">{entry.label}</span>
        {count !== undefined && count > 0 && <span className="text-xs text-muted-foreground/40">{count}</span>}
      </Button>
    )
  }

  return (
    <div className="flex w-[180px] shrink-0 select-none flex-col overflow-y-auto border-r border-border/30">
      <div className="space-y-[1px] px-1.5 pt-2 pb-1">{TYPE_ENTRIES.map(renderEntry)}</div>
      {folders.length > 0 && (
        <>
          <div className="mx-2.5 border-t border-border/20" />
          <div className="space-y-[1px] px-1.5 pt-1 pb-1">
            {folders.map((folder) => {
              const active = isActive('folder', folder)
              const count = fileCounts[`folder:${folder}`]
              const displayName = folder.split('/').pop() || folder
              return (
                <Button
                  key={folder}
                  variant="ghost"
                  size="sm"
                  onClick={() => onFilterChange({ kind: 'folder', value: folder })}
                  className={`w-full justify-start gap-2 px-2.5 py-[5px] ${
                    active
                      ? 'bg-accent text-foreground'
                      : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
                  }`}>
                  <FolderClosed size={13} strokeWidth={1.5} className="shrink-0 text-muted-foreground/60" />
                  <span className="flex-1 truncate text-left">{displayName}</span>
                  {count !== undefined && count > 0 && (
                    <span className="text-xs text-muted-foreground/40">{count}</span>
                  )}
                </Button>
              )
            })}
          </div>
        </>
      )}
      <div className="mx-2.5 border-t border-border/20" />
      <div className="space-y-[1px] px-1.5 pt-1 pb-2">{LIBRARY_ENTRIES.map(renderEntry)}</div>
    </div>
  )
}
