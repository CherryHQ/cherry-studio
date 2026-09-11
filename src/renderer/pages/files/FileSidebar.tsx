import type { TFunction } from 'i18next'
import { FileCode, FileQuestion, Files, FileText, Image as ImageIcon, Music, Trash2, Video } from 'lucide-react'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'

import { MenuDivider, MenuItem, MenuList, PageHeader, Scrollbar } from '@cherrystudio/ui'

export type SidebarFilter =
  | { kind: 'library'; value: 'all' | 'trash' }
  | { kind: 'type'; value: 'image' | 'video' | 'audio' | 'text' | 'document' | 'other' }

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
  fileCounts
}: {
  filter: SidebarFilter
  onFilterChange: (f: SidebarFilter) => void
  fileCounts: Record<string, number>
}) {
  const { t } = useTranslation()
  const isActive = (kind: string, value: string) => filter.kind === kind && filter.value === value

  const renderEntry = (entry: SidebarEntry) => {
    const active = isActive(entry.kind, entry.value)
    const Icon = entry.icon
    const count = fileCounts[entry.countKey]
    return (
      <MenuItem
        key={`${entry.kind}-${entry.value}`}
        icon={<Icon />}
        label={entry.label(t)}
        suffix={
          count !== undefined && count > 0 ? <span className="text-xs text-muted-foreground">{count}</span> : null
        }
        active={active}
        onClick={() => onFilterChange({ kind: entry.kind, value: entry.value } as SidebarFilter)}
        labelClassName="group-data-[active=true]:font-medium"
        className="h-8 rounded-[10px] border-transparent px-2.5 text-sm font-normal text-foreground hover:!bg-muted data-[active=true]:!border-transparent data-[active=true]:!bg-muted data-[active=true]:!font-medium data-[active=true]:!text-foreground [&_svg]:size-4 [&_svg]:text-foreground"
      />
    )
  }

  return (
    <aside
      data-ui="files.navigation"
      className="flex w-(--settings-width) min-w-(--settings-width) shrink-0 flex-col border-r-[0.5px] border-border select-none">
      <PageHeader title={t('files.title')} />
      <Scrollbar className="min-h-0 flex-1">
        <MenuList className="gap-0.5 px-2.5 pb-2.5">
          <div className="px-2.5 pb-0.5 text-xs text-muted-foreground">{t('files.type')}</div>
          {TYPE_ENTRIES.map(renderEntry)}
          <MenuDivider className="my-1 bg-transparent" />
          {LIBRARY_ENTRIES.map(renderEntry)}
        </MenuList>
      </Scrollbar>
    </aside>
  )
}
