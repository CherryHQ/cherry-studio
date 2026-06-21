import { Button } from '@cherrystudio/ui'
import type { TFunction } from 'i18next'
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
import { useTranslation } from 'react-i18next'

export type SidebarFilter =
  | { kind: 'library'; value: 'all' | 'trash' }
  | { kind: 'type'; value: 'image' | 'video' | 'audio' | 'text' | 'document' | 'other' }
  | { kind: 'folder'; value: string }

type SidebarEntry = {
  kind: string
  value: string
  label: (t: TFunction) => string
  icon: FC<{ size?: number; strokeWidth?: number; className?: string }>
  countKey: string
}

const TYPE_ENTRIES: SidebarEntry[] = [
  { kind: 'type', value: 'image', label: (t) => t('files.image'), icon: ImageIcon, countKey: 'type_image' },
  { kind: 'type', value: 'video', label: (t) => t('files.video'), icon: Video, countKey: 'type_video' },
  { kind: 'type', value: 'audio', label: (t) => t('files.audio'), icon: Music, countKey: 'type_audio' },
  { kind: 'type', value: 'text', label: (t) => t('files.text'), icon: FileCode, countKey: 'type_text' },
  { kind: 'type', value: 'document', label: (t) => t('files.document'), icon: FileText, countKey: 'type_document' },
  { kind: 'type', value: 'other', label: (t) => t('files.other'), icon: FileQuestion, countKey: 'type_other' }
]

const LIBRARY_ENTRIES: SidebarEntry[] = [
  { kind: 'library', value: 'all', label: (t) => t('files.all'), icon: Files, countKey: 'all' },
  { kind: 'library', value: 'trash', label: (t) => t('files.trash'), icon: Trash2, countKey: 'trash' }
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
  const { t } = useTranslation()
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
        <span className="flex-1 truncate text-left">{entry.label(t)}</span>
        {count !== undefined && count > 0 && <span className="text-muted-foreground/40 text-xs">{count}</span>}
      </Button>
    )
  }

  return (
    <div className="flex w-[180px] shrink-0 select-none flex-col overflow-y-auto border-border/30 border-r">
      <div className="space-y-[1px] px-1.5 pt-2 pb-1">{TYPE_ENTRIES.map(renderEntry)}</div>
      {folders.length > 0 && (
        <>
          <div className="mx-2.5 border-border/20 border-t" />
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
                    <span className="text-muted-foreground/40 text-xs">{count}</span>
                  )}
                </Button>
              )
            })}
          </div>
        </>
      )}
      <div className="mx-2.5 border-border/20 border-t" />
      <div className="space-y-[1px] px-1.5 pt-1 pb-2">{LIBRARY_ENTRIES.map(renderEntry)}</div>
    </div>
  )
}
