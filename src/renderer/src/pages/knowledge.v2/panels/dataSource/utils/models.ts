import { formatRelativeTime } from '@renderer/pages/knowledge.v2/utils'
import { formatFileSize } from '@renderer/utils'
import type { KnowledgeItem, KnowledgeItemOf, KnowledgeItemType } from '@shared/data/types/knowledge'
import type { LucideIcon } from 'lucide-react'
import { FileText, Folder, Globe, Link2, StickyNote } from 'lucide-react'

export type DataSourceFilter = 'all' | KnowledgeItemType
export type DataSourceStatus = 'completed' | 'processing' | 'failed'
export type DataSourceStatusIcon = 'check' | 'loader' | 'alert'

export interface DataSourceDisplayContext {
  language: string
}

export interface DataSourceIconMeta {
  icon: LucideIcon
  iconClassName: string
}

export interface DataSourceFilterDefinition {
  value: DataSourceFilter
  labelKey: string
}

export interface DataSourceStatusViewModel {
  kind: DataSourceStatus
  labelKey: string
  textClassName: string
  icon: DataSourceStatusIcon
}

export interface KnowledgeItemRowViewModel {
  title: string
  suffix: string
  metaParts: string[]
  icon: DataSourceIconMeta
  status: DataSourceStatusViewModel
}

export interface DataSourceTypeDisplayConfig<T extends KnowledgeItemType> {
  filterLabelKey: string
  icon: DataSourceIconMeta
  getTitle: (item: KnowledgeItemOf<T>) => string
  getSuffix: (item: KnowledgeItemOf<T>) => string
  getMetaParts: (item: KnowledgeItemOf<T>, context: DataSourceDisplayContext) => string[]
  getStatus: (item: KnowledgeItemOf<T>) => DataSourceStatusViewModel
}

type DataSourceTypeDisplayConfigMap = {
  [K in KnowledgeItemType]: DataSourceTypeDisplayConfig<K>
}

const getRelativeMetaParts = (updatedAt: string, language: string, extraParts: Array<string | undefined> = []) =>
  [...extraParts, formatRelativeTime(updatedAt, language)].filter((part): part is string => Boolean(part))

const getNoteTitle = (content: string) => {
  const firstLine = content
    .split('\n')
    .map((line) => line.trim())
    .find(Boolean)

  return firstLine || ''
}

export const resolveDataSourceStatusViewModel = (
  item: Pick<KnowledgeItem, 'phase' | 'status'>
): DataSourceStatusViewModel => {
  if (item.status === 'completed') {
    return {
      kind: 'completed',
      labelKey: 'knowledge_v2.data_source.status.ready',
      textClassName: 'text-emerald-500/70',
      icon: 'check'
    }
  }

  if (item.status === 'failed') {
    return {
      kind: 'failed',
      labelKey: 'knowledge_v2.data_source.status.error',
      textClassName: 'text-red-500/60',
      icon: 'alert'
    }
  }

  if (item.status === 'processing' && item.phase === 'embedding') {
    return {
      kind: 'processing',
      labelKey: 'knowledge_v2.data_source.status.embedding',
      textClassName: 'text-amber-500/70',
      icon: 'loader'
    }
  }

  if (item.status === 'processing' && item.phase === 'reading') {
    return {
      kind: 'processing',
      labelKey: 'knowledge_v2.rag.file_processing',
      textClassName: 'text-blue-500/70',
      icon: 'loader'
    }
  }

  if (item.status === 'processing' && item.phase === null) {
    return {
      kind: 'processing',
      labelKey: 'knowledge_v2.status_processing',
      textClassName: 'text-yellow-500/70',
      icon: 'loader'
    }
  }

  if (item.status === 'idle' || item.phase === 'preparing') {
    return {
      kind: 'processing',
      labelKey: 'knowledge_v2.data_source.status.pending',
      textClassName: 'text-zinc-500/70',
      icon: 'loader'
    }
  }

  return {
    kind: 'processing',
    labelKey: 'knowledge_v2.data_source.status.chunking',
    textClassName: 'text-violet-500/70',
    icon: 'loader'
  }
}

export const dataSourceTypeDisplayConfig = {
  file: {
    filterLabelKey: 'knowledge_v2.data_source.filters.file',
    icon: {
      icon: FileText,
      iconClassName: 'text-blue-500'
    },
    getTitle: (item) => item.data.file.origin_name || item.data.file.name,
    getSuffix: (item) => (item.data.file.ext || 'FILE').toLowerCase(),
    getMetaParts: (item, { language }) =>
      getRelativeMetaParts(item.updatedAt, language, [formatFileSize(item.data.file.size)]),
    getStatus: resolveDataSourceStatusViewModel
  },
  note: {
    filterLabelKey: 'knowledge_v2.data_source.filters.note',
    icon: {
      icon: StickyNote,
      iconClassName: 'text-amber-500'
    },
    getTitle: (item) => getNoteTitle(item.data.content),
    getSuffix: () => '',
    getMetaParts: (item, { language }) => getRelativeMetaParts(item.updatedAt, language),
    getStatus: resolveDataSourceStatusViewModel
  },
  directory: {
    filterLabelKey: 'knowledge_v2.data_source.filters.directory',
    icon: {
      icon: Folder,
      iconClassName: 'text-violet-500'
    },
    getTitle: (item) => item.data.source,
    getSuffix: () => '',
    getMetaParts: (item, { language }) => getRelativeMetaParts(item.updatedAt, language),
    getStatus: resolveDataSourceStatusViewModel
  },
  url: {
    filterLabelKey: 'knowledge_v2.data_source.filters.url',
    icon: {
      icon: Link2,
      iconClassName: 'text-cyan-500'
    },
    getTitle: (item) => item.data.source,
    getSuffix: () => '',
    getMetaParts: (item, { language }) => getRelativeMetaParts(item.updatedAt, language),
    getStatus: resolveDataSourceStatusViewModel
  },
  sitemap: {
    filterLabelKey: 'knowledge_v2.data_source.filters.sitemap',
    icon: {
      icon: Globe,
      iconClassName: 'text-emerald-500'
    },
    getTitle: (item) => item.data.source,
    getSuffix: () => '',
    getMetaParts: (item, { language }) => getRelativeMetaParts(item.updatedAt, language),
    getStatus: resolveDataSourceStatusViewModel
  }
} satisfies DataSourceTypeDisplayConfigMap

const dataSourceTypeDisplayEntries = Object.entries(dataSourceTypeDisplayConfig) as Array<
  [KnowledgeItemType, DataSourceTypeDisplayConfigMap[KnowledgeItemType]]
>

export const dataSourceFilterDefinitions: DataSourceFilterDefinition[] = [
  {
    value: 'all',
    labelKey: 'knowledge_v2.data_source.filters.all'
  },
  ...dataSourceTypeDisplayEntries.map(([value, config]) => ({
    value,
    labelKey: config.filterLabelKey
  }))
]
