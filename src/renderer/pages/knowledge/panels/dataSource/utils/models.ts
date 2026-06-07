import { formatRelativeTime } from '@renderer/pages/knowledge/utils'
import type { FileEntry } from '@shared/data/types/file'
import type { KnowledgeItemOf, KnowledgeItemStatus, KnowledgeItemType } from '@shared/data/types/knowledge'
import type { LucideIcon } from 'lucide-react'
import { FileText, Folder, Link2, StickyNote } from 'lucide-react'

export type DataSourceStatus = 'completed' | 'processing' | 'failed'
export type DataSourceStatusIcon = 'check' | 'loader' | 'alert'

export interface DataSourceDisplayContext {
  fileEntry?: FileEntry
  language: string
}

export interface DataSourceIconMeta {
  icon: LucideIcon
  iconClassName: string
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
  getTitle: (item: KnowledgeItemOf<T>, context: DataSourceDisplayContext) => string
  getSuffix: (item: KnowledgeItemOf<T>, context: DataSourceDisplayContext) => string
  getMetaParts: (item: KnowledgeItemOf<T>, context: DataSourceDisplayContext) => string[]
  getStatus: (status: KnowledgeItemStatus) => DataSourceStatusViewModel
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

const getPathName = (source: string) => {
  const normalizedSource = source.replace(/[/\\]+$/, '')
  const name = normalizedSource.split(/[/\\]/).pop()?.trim()

  return name || normalizedSource || source
}

const getFileTitle = (item: KnowledgeItemOf<'file'>, fileEntry?: FileEntry) => {
  if (!fileEntry) {
    return getPathName(item.data.source)
  }

  return fileEntry.ext ? `${fileEntry.name}.${fileEntry.ext}` : fileEntry.name
}

const getFileSuffix = (item: KnowledgeItemOf<'file'>, fileEntry?: FileEntry) => {
  const fallbackName = getPathName(item.data.source)
  const fallbackExt = fallbackName.includes('.') ? fallbackName.split('.').pop() : undefined
  const ext = fileEntry?.ext ?? fallbackExt

  return (ext || 'FILE').toLowerCase()
}

export const resolveDataSourceStatusViewModel = (status: KnowledgeItemStatus): DataSourceStatusViewModel => {
  if (status === 'completed') {
    return {
      kind: 'completed',
      labelKey: 'knowledge.data_source.status.ready',
      textClassName: 'text-success',
      icon: 'check'
    }
  }

  if (status === 'failed') {
    return {
      kind: 'failed',
      labelKey: 'knowledge.data_source.status.error',
      textClassName: 'text-red-500/60',
      icon: 'alert'
    }
  }

  if (status === 'embedding') {
    return {
      kind: 'processing',
      labelKey: 'knowledge.data_source.status.embedding',
      textClassName: 'text-amber-500/70',
      icon: 'loader'
    }
  }

  if (status === 'reading') {
    return {
      kind: 'processing',
      labelKey: 'knowledge.rag.file_processing',
      textClassName: 'text-blue-500/70',
      icon: 'loader'
    }
  }

  if (status === 'processing') {
    return {
      kind: 'processing',
      labelKey: 'knowledge.status.processing',
      textClassName: 'text-yellow-500/70',
      icon: 'loader'
    }
  }

  if (status === 'idle' || status === 'preparing') {
    return {
      kind: 'processing',
      labelKey: 'knowledge.data_source.status.pending',
      textClassName: 'text-zinc-500/70',
      icon: 'loader'
    }
  }

  return {
    kind: 'processing',
    labelKey: 'knowledge.data_source.status.chunking',
    textClassName: 'text-violet-500/70',
    icon: 'loader'
  }
}

export const dataSourceTypeDisplayConfig: DataSourceTypeDisplayConfigMap = {
  file: {
    filterLabelKey: 'knowledge.data_source.filters.file',
    icon: {
      icon: FileText,
      iconClassName: 'text-blue-500'
    },
    getTitle: (item, { fileEntry }) => getFileTitle(item, fileEntry),
    getSuffix: (item, { fileEntry }) => getFileSuffix(item, fileEntry),
    getMetaParts: (item, { language }) => getRelativeMetaParts(item.updatedAt, language),
    getStatus: resolveDataSourceStatusViewModel
  },
  note: {
    filterLabelKey: 'knowledge.data_source.filters.note',
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
    filterLabelKey: 'knowledge.data_source.filters.directory',
    icon: {
      icon: Folder,
      iconClassName: 'text-violet-500'
    },
    getTitle: (item) => getPathName(item.data.source),
    getSuffix: () => '',
    getMetaParts: (item, { language }) => getRelativeMetaParts(item.updatedAt, language),
    getStatus: resolveDataSourceStatusViewModel
  },
  url: {
    filterLabelKey: 'knowledge.data_source.filters.url',
    icon: {
      icon: Link2,
      iconClassName: 'text-cyan-500'
    },
    getTitle: (item) => item.data.source,
    getSuffix: () => '',
    getMetaParts: (item, { language }) => getRelativeMetaParts(item.updatedAt, language),
    getStatus: resolveDataSourceStatusViewModel
  }
}
