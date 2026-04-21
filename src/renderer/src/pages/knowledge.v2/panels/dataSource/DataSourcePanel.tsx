import { Button, Scrollbar } from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import {
  Check,
  CircleAlert,
  FileCode,
  FileSpreadsheet,
  FileText,
  Folder,
  Globe,
  Link2,
  LoaderCircle,
  Plus,
  StickyNote
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

type DataSourceFilter = 'all' | 'file' | 'note' | 'directory' | 'url' | 'sitemap'
type DataSourceStatus = 'completed' | 'processing' | 'failed'
type DataSourceProgressTone = 'amber' | 'violet'

interface DataSourceItem {
  id: string
  title: string
  type: Exclude<DataSourceFilter, 'all'>
  icon: typeof FileText
  iconWrapClassName: string
  iconClassName: string
  suffix: string
  sizeLabel?: string
  chunkCount: number
  updatedAt: string
  status: DataSourceStatus
  statusLabelKey?: string
  progressTone?: DataSourceProgressTone
}

const dataSourceItems: DataSourceItem[] = [
  {
    id: 'rag-guide',
    title: 'RAG 技术指南',
    type: 'file',
    icon: FileText,
    iconWrapClassName: 'bg-accent/40',
    iconClassName: 'text-blue-500',
    suffix: 'PDF',
    sizeLabel: '2.4 MB',
    chunkCount: 48,
    updatedAt: '2026-04-21T09:10:00+08:00',
    status: 'completed'
  },
  {
    id: 'vector-db',
    title: '向量数据库原理',
    type: 'note',
    icon: FileCode,
    iconWrapClassName: 'bg-accent/40',
    iconClassName: 'text-blue-500',
    suffix: 'MD',
    sizeLabel: '156 KB',
    chunkCount: 12,
    updatedAt: '2026-04-21T08:35:00+08:00',
    status: 'completed'
  },
  {
    id: 'strategy',
    title: '检索策略对比分析',
    type: 'file',
    icon: FileText,
    iconWrapClassName: 'bg-accent/40',
    iconClassName: 'text-blue-500',
    suffix: 'DOCX',
    sizeLabel: '890 KB',
    chunkCount: 24,
    updatedAt: '2026-04-20T16:20:00+08:00',
    status: 'completed'
  },
  {
    id: 'deployment',
    title: 'LLM 部署手册',
    type: 'file',
    icon: FileText,
    iconWrapClassName: 'bg-accent/40',
    iconClassName: 'text-blue-500',
    suffix: 'PDF',
    sizeLabel: '5.1 MB',
    chunkCount: 30,
    updatedAt: '2026-04-21T10:20:00+08:00',
    status: 'processing',
    progressTone: 'violet',
    statusLabelKey: 'knowledge_v2.data_source.status.chunking'
  },
  {
    id: 'best-practice',
    title: '知识库最佳实践',
    type: 'note',
    icon: StickyNote,
    iconWrapClassName: 'bg-accent/40',
    iconClassName: 'text-amber-500',
    suffix: 'TXT',
    sizeLabel: '45 KB',
    chunkCount: 8,
    updatedAt: '2026-04-19T19:15:00+08:00',
    status: 'completed'
  },
  {
    id: 'paper-dir',
    title: 'AI 研究论文目录',
    type: 'directory',
    icon: Folder,
    iconWrapClassName: 'bg-accent/40',
    iconClassName: 'text-violet-500',
    suffix: 'DIR',
    sizeLabel: '12.3 MB',
    chunkCount: 156,
    updatedAt: '2026-04-18T13:10:00+08:00',
    status: 'completed'
  },
  {
    id: 'anthropic',
    title: 'https://docs.anthropic.com',
    type: 'url',
    icon: Link2,
    iconWrapClassName: 'bg-accent/40',
    iconClassName: 'text-cyan-500',
    suffix: 'URL',
    chunkCount: 34,
    updatedAt: '2026-04-18T11:00:00+08:00',
    status: 'completed'
  },
  {
    id: 'openai-site',
    title: 'OpenAI 文档站',
    type: 'sitemap',
    icon: Globe,
    iconWrapClassName: 'bg-accent/40',
    iconClassName: 'text-emerald-500',
    suffix: 'SITE',
    chunkCount: 42,
    updatedAt: '2026-04-21T10:40:00+08:00',
    status: 'processing',
    progressTone: 'amber',
    statusLabelKey: 'knowledge_v2.data_source.status.embedding'
  },
  {
    id: 'embedding-report',
    title: 'Embedding 模型评测',
    type: 'file',
    icon: FileSpreadsheet,
    iconWrapClassName: 'bg-accent/40',
    iconClassName: 'text-blue-500',
    suffix: 'XLSX',
    sizeLabel: '340 KB',
    chunkCount: 6,
    updatedAt: '2026-04-17T09:30:00+08:00',
    status: 'completed'
  },
  {
    id: 'multimodal',
    title: '多模态 AI 综述',
    type: 'file',
    icon: FileText,
    iconWrapClassName: 'bg-accent/40',
    iconClassName: 'text-blue-500',
    suffix: 'PDF',
    sizeLabel: '3.8 MB',
    chunkCount: 52,
    updatedAt: '2026-04-16T14:20:00+08:00',
    status: 'failed'
  }
]

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

const DataSourcePanel = () => {
  const { t, i18n } = useTranslation()
  const [activeFilter, setActiveFilter] = useState<DataSourceFilter>('all')

  const visibleItems = useMemo(() => {
    if (activeFilter === 'all') {
      return dataSourceItems
    }

    return dataSourceItems.filter((item) => item.type === activeFilter)
  }, [activeFilter])

  const readyCount = useMemo(() => dataSourceItems.filter((item) => item.status === 'completed').length, [])

  const formatRelativeTime = (value: string) => {
    const diffMs = new Date(value).getTime() - Date.now()
    const absMs = Math.abs(diffMs)
    const formatter = new Intl.RelativeTimeFormat(i18n.language, { numeric: 'auto' })

    if (absMs < 60 * 60 * 1000) {
      return formatter.format(Math.round(diffMs / (60 * 1000)), 'minute')
    }

    if (absMs < 24 * 60 * 60 * 1000) {
      return formatter.format(Math.round(diffMs / (60 * 60 * 1000)), 'hour')
    }

    return formatter.format(Math.round(diffMs / (24 * 60 * 60 * 1000)), 'day')
  }

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
        <div className="divide-y divide-border/15">
          {visibleItems.map((item) => {
            const Icon = item.icon
            const metaParts = [
              item.sizeLabel,
              item.status === 'completed'
                ? t('knowledge_v2.data_source.chunks_count', { count: item.chunkCount })
                : null,
              formatRelativeTime(item.updatedAt)
            ].filter((part): part is string => Boolean(part))

            return (
              <div
                key={item.id}
                className="group/row relative flex h-11 cursor-pointer items-center gap-2.5 px-2.5 py-1.5 transition-colors hover:bg-accent/25">
                <div className={cn('flex size-6 shrink-0 items-center justify-center rounded', item.iconWrapClassName)}>
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
      </Scrollbar>
    </div>
  )
}

export default DataSourcePanel
