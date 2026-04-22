import { Button, Scrollbar } from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import { formatRelativeTime } from '@renderer/pages/knowledge.v2/utils'
import { formatFileSize } from '@renderer/utils'
import type { KnowledgeItem } from '@shared/data/types/knowledge'
import { Check, CircleAlert, FileText, Folder, Globe, Link2, LoaderCircle, Plus, StickyNote } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

type DataSourceFilter = 'all' | KnowledgeItem['type']
type DataSourceStatus = 'completed' | 'processing' | 'failed'
type DataSourceProgressTone = 'amber' | 'violet'

interface DataSourceItem {
  id: string
  title: string
  type: KnowledgeItem['type']
  icon: typeof FileText
  iconWrapClassName: string
  iconClassName: string
  suffix: string
  sizeLabel?: string
  updatedAt: string
  status: DataSourceStatus
  statusLabelKey?: string
  progressTone?: DataSourceProgressTone
}

const filterLabels = [
  'all',
  'file',
  'note',
  'directory',
  'url',
  'sitemap'
] as const satisfies readonly DataSourceFilter[]

const statusClassNames = {
  completed: 'text-emerald-500/70',
  failed: 'text-red-500/60'
} satisfies Record<Exclude<DataSourceStatus, 'processing'>, string>

const processingTextClassNames = {
  amber: 'text-amber-500/70',
  violet: 'text-violet-500/70'
} satisfies Record<DataSourceProgressTone, string>

const processingDotClassNames = {
  amber: ['bg-emerald-500', 'bg-emerald-500', 'animate-pulse bg-amber-500'],
  violet: ['bg-emerald-500', 'animate-pulse bg-current text-violet-500', 'bg-border/40']
} satisfies Record<DataSourceProgressTone, [string, string, string]>

const itemIconByType = {
  file: {
    icon: FileText,
    iconWrapClassName: 'bg-accent/40',
    iconClassName: 'text-blue-500'
  },
  note: {
    icon: StickyNote,
    iconWrapClassName: 'bg-accent/40',
    iconClassName: 'text-amber-500'
  },
  directory: {
    icon: Folder,
    iconWrapClassName: 'bg-accent/40',
    iconClassName: 'text-violet-500'
  },
  url: {
    icon: Link2,
    iconWrapClassName: 'bg-accent/40',
    iconClassName: 'text-cyan-500'
  },
  sitemap: {
    icon: Globe,
    iconWrapClassName: 'bg-accent/40',
    iconClassName: 'text-emerald-500'
  }
} satisfies Record<KnowledgeItem['type'], Pick<DataSourceItem, 'icon' | 'iconWrapClassName' | 'iconClassName'>>

const getItemStatus = (item: KnowledgeItem): Pick<DataSourceItem, 'status' | 'statusLabelKey' | 'progressTone'> => {
  if (item.status === 'completed') {
    return { status: 'completed' }
  }

  if (item.status === 'failed') {
    return { status: 'failed' }
  }

  if (item.status === 'embed') {
    return {
      status: 'processing',
      progressTone: 'amber',
      statusLabelKey: 'knowledge_v2.data_source.status.embedding'
    }
  }

  return {
    status: 'processing',
    progressTone: 'violet',
    statusLabelKey: 'knowledge_v2.data_source.status.chunking'
  }
}

const getItemSuffix = (item: KnowledgeItem) => {
  switch (item.type) {
    case 'file':
      return item.data.file.ext || 'FILE'
    case 'note':
      return 'TXT'
    case 'directory':
      return 'DIR'
    case 'url':
      return 'URL'
    case 'sitemap':
      return 'SITE'
    default:
      return ''
  }
}

const getItemTitle = (item: KnowledgeItem, noteFallbackLabel: string) => {
  switch (item.type) {
    case 'file':
      return item.data.file.origin_name || item.data.file.name
    case 'url':
    case 'sitemap':
      return item.data.name || item.data.url
    case 'directory':
      return item.data.name
    case 'note': {
      const firstLine = item.data.content
        .split('\n')
        .map((line) => line.trim())
        .find(Boolean)

      return firstLine || noteFallbackLabel
    }
  }
}

const toDataSourceItem = (item: KnowledgeItem, noteFallbackLabel: string): DataSourceItem => ({
  id: item.id,
  title: getItemTitle(item, noteFallbackLabel),
  type: item.type,
  suffix: getItemSuffix(item),
  sizeLabel: item.type === 'file' ? formatFileSize(item.data.file.size) : undefined,
  updatedAt: item.updatedAt,
  ...itemIconByType[item.type],
  ...getItemStatus(item)
})

interface DataSourcePanelProps {
  items?: KnowledgeItem[]
  isLoading?: boolean
}

const DataSourcePanel = ({ items = [], isLoading = false }: DataSourcePanelProps) => {
  const { t, i18n } = useTranslation()
  const [activeFilter, setActiveFilter] = useState<DataSourceFilter>('all')
  const dataSourceItems = useMemo(() => items.map((item) => toDataSourceItem(item, t('knowledge.notes'))), [items, t])

  const visibleItems = useMemo(() => {
    if (activeFilter === 'all') {
      return dataSourceItems
    }

    return dataSourceItems.filter((item) => item.type === activeFilter)
  }, [activeFilter, dataSourceItems])

  const readyCount = useMemo(
    () => dataSourceItems.filter((item) => item.status === 'completed').length,
    [dataSourceItems]
  )

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center justify-between px-3 py-2">
        <div className="flex items-center gap-2">
          {filterLabels.map((filterKey) => (
            <Button
              key={filterKey}
              type="button"
              variant="ghost"
              className={cn(
                'h-auto min-h-0 rounded px-1.5 py-px font-normal text-[0.625rem] leading-3.75 shadow-none transition-colors',
                activeFilter === filterKey
                  ? 'bg-accent text-foreground hover:bg-accent hover:text-foreground'
                  : 'text-muted-foreground/50 hover:text-foreground'
              )}
              onClick={() => setActiveFilter(filterKey)}>
              {filterKey === 'all' && t('knowledge_v2.data_source.filters.all')}
              {filterKey === 'file' && t('files.title')}
              {filterKey === 'note' && t('knowledge.notes')}
              {filterKey === 'directory' && t('knowledge.directories')}
              {filterKey === 'url' && t('knowledge.urls')}
              {filterKey === 'sitemap' && t('knowledge.sitemaps')}
            </Button>
          ))}
        </div>

        <div className="flex items-center gap-1.5">
          <span className="mr-0.5 text-[0.5625rem] text-muted-foreground/35 leading-3.375">
            {t('knowledge_v2.data_source.ready_summary', { ready: readyCount, total: dataSourceItems.length })}
          </span>
          <Button
            type="button"
            className="h-5 min-h-5 rounded bg-primary px-2 text-[0.625rem] text-primary-foreground leading-3.75 shadow-none hover:bg-primary/90"
            onClick={() => undefined}>
            <Plus className="size-2.5" />
            {t('common.add')}
          </Button>
        </div>
      </div>

      <Scrollbar className={cn('mx-2.5 mb-2.5 min-h-0 flex-1 rounded-lg border border-border/25')}>
        {isLoading ? (
          <div className="flex h-full items-center justify-center px-4 text-center text-[0.6875rem] text-muted-foreground/60">
            {t('common.loading')}
          </div>
        ) : visibleItems.length === 0 ? (
          <div className="flex h-full items-center justify-center px-4 text-center text-[0.6875rem] text-muted-foreground/60">
            {t('common.no_results')}
          </div>
        ) : (
          <div className="divide-y divide-border/15">
            {visibleItems.map((item) => {
              const Icon = item.icon
              const metaParts = [item.sizeLabel, formatRelativeTime(item.updatedAt, i18n.language)].filter(
                (part): part is string => Boolean(part)
              )

              return (
                <div
                  key={item.id}
                  className="group/row relative flex h-11 cursor-pointer items-center gap-2.5 px-2.5 py-1.5 transition-colors hover:bg-accent/25">
                  <div
                    className={cn('flex size-6 shrink-0 items-center justify-center rounded', item.iconWrapClassName)}>
                    <Icon className={cn('size-3.5', item.iconClassName)} />
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <div className="truncate text-[0.6875rem] text-foreground leading-4.125">{item.title}</div>
                      {item.suffix ? (
                        <span className="shrink-0 text-[0.5rem] text-muted-foreground/30 uppercase leading-3">
                          {item.suffix.toLowerCase()}
                        </span>
                      ) : null}
                    </div>

                    <div className="mt-px flex items-center gap-1.5 text-[0.5625rem] text-muted-foreground/35 leading-3.375">
                      {metaParts.map((part) => (
                        <span key={`${item.id}-${part}`}>{part}</span>
                      ))}
                    </div>
                  </div>

                  {item.status === 'processing' ? (
                    <div className="flex shrink-0 items-center gap-1.5">
                      <div className="flex items-center gap-0.5">
                        {processingDotClassNames[item.progressTone ?? 'violet'].map((className, index) => (
                          <span
                            key={`${item.id}-dot-${index}`}
                            className={cn('size-[0.3125rem] rounded-full transition-colors', className)}
                          />
                        ))}
                      </div>

                      <span
                        className={cn(
                          'inline-flex items-center gap-0.5 text-[0.5625rem] leading-3.375',
                          processingTextClassNames[item.progressTone ?? 'violet']
                        )}>
                        <LoaderCircle className="size-[0.4375rem] animate-spin" />
                        <span>{t(item.statusLabelKey ?? 'knowledge_v2.data_source.status.chunking')}</span>
                      </span>
                    </div>
                  ) : (
                    <span
                      className={cn(
                        'inline-flex shrink-0 items-center gap-0.5 text-[0.5625rem] leading-3.375',
                        statusClassNames[item.status]
                      )}>
                      {item.status === 'completed' && <Check className="size-[0.4375rem]" />}
                      {item.status === 'failed' && <CircleAlert className="size-2" />}
                      <span>
                        {item.status === 'completed'
                          ? t('knowledge_v2.data_source.status.ready')
                          : t('knowledge_v2.data_source.status.error')}
                      </span>
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </Scrollbar>
    </div>
  )
}

export default DataSourcePanel
