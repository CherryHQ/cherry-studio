import type { KnowledgeItem } from '@shared/data/types/knowledge'

import { type DataSourceFilter, dataSourceTypeDisplayConfig, type KnowledgeItemRowViewModel } from './models'

export const getItemStatus = (item: KnowledgeItem) => {
  switch (item.type) {
    case 'file':
      return dataSourceTypeDisplayConfig.file.getStatus(item)
    case 'note':
      return dataSourceTypeDisplayConfig.note.getStatus(item)
    case 'directory':
      return dataSourceTypeDisplayConfig.directory.getStatus(item)
    case 'url':
      return dataSourceTypeDisplayConfig.url.getStatus(item)
    case 'sitemap':
      return dataSourceTypeDisplayConfig.sitemap.getStatus(item)
  }
}

export const getItemTitle = (item: KnowledgeItem): string => {
  switch (item.type) {
    case 'file':
      return dataSourceTypeDisplayConfig.file.getTitle(item)
    case 'note':
      return dataSourceTypeDisplayConfig.note.getTitle(item)
    case 'directory':
      return dataSourceTypeDisplayConfig.directory.getTitle(item)
    case 'url':
      return dataSourceTypeDisplayConfig.url.getTitle(item)
    case 'sitemap':
      return dataSourceTypeDisplayConfig.sitemap.getTitle(item)
  }
}

export const getVisibleItems = (items: KnowledgeItem[], activeFilter: DataSourceFilter) => {
  if (activeFilter === 'all') {
    return items
  }

  return items.filter((item) => item.type === activeFilter)
}

export const getReadyCount = (items: KnowledgeItem[]) =>
  items.reduce((readyCount, item) => readyCount + (item.status === 'completed' ? 1 : 0), 0)

export const toKnowledgeItemRowViewModel = (item: KnowledgeItem, language: string): KnowledgeItemRowViewModel => {
  switch (item.type) {
    case 'file': {
      const config = dataSourceTypeDisplayConfig.file

      return {
        title: config.getTitle(item),
        suffix: config.getSuffix(item),
        metaParts: config.getMetaParts(item, { language }),
        icon: config.icon,
        status: config.getStatus(item)
      }
    }
    case 'note': {
      const config = dataSourceTypeDisplayConfig.note

      return {
        title: config.getTitle(item),
        suffix: config.getSuffix(),
        metaParts: config.getMetaParts(item, { language }),
        icon: config.icon,
        status: config.getStatus(item)
      }
    }
    case 'directory': {
      const config = dataSourceTypeDisplayConfig.directory

      return {
        title: config.getTitle(item),
        suffix: config.getSuffix(),
        metaParts: config.getMetaParts(item, { language }),
        icon: config.icon,
        status: config.getStatus(item)
      }
    }
    case 'url': {
      const config = dataSourceTypeDisplayConfig.url

      return {
        title: config.getTitle(item),
        suffix: config.getSuffix(),
        metaParts: config.getMetaParts(item, { language }),
        icon: config.icon,
        status: config.getStatus(item)
      }
    }
    case 'sitemap': {
      const config = dataSourceTypeDisplayConfig.sitemap

      return {
        title: config.getTitle(item),
        suffix: config.getSuffix(),
        metaParts: config.getMetaParts(item, { language }),
        icon: config.icon,
        status: config.getStatus(item)
      }
    }
  }
}
