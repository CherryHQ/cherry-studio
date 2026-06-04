import type { FileEntry } from '@shared/data/types/file'
import type { KnowledgeItem } from '@shared/data/types/knowledge'

import { dataSourceTypeDisplayConfig, type KnowledgeItemRowViewModel } from './models'

export const getItemStatus = (item: KnowledgeItem) => {
  switch (item.type) {
    case 'file':
      return dataSourceTypeDisplayConfig.file.getStatus(item.status)
    case 'note':
      return dataSourceTypeDisplayConfig.note.getStatus(item.status)
    case 'directory':
      return dataSourceTypeDisplayConfig.directory.getStatus(item.status)
    case 'url':
      return dataSourceTypeDisplayConfig.url.getStatus(item.status)
    case 'sitemap':
      return dataSourceTypeDisplayConfig.sitemap.getStatus(item.status)
  }
}

export const getItemTitle = (item: KnowledgeItem, fileEntry?: FileEntry): string => {
  switch (item.type) {
    case 'file':
      return dataSourceTypeDisplayConfig.file.getTitle(item, { fileEntry, language: '' })
    case 'note':
      return dataSourceTypeDisplayConfig.note.getTitle(item, { language: '' })
    case 'directory':
      return dataSourceTypeDisplayConfig.directory.getTitle(item, { language: '' })
    case 'url':
      return dataSourceTypeDisplayConfig.url.getTitle(item, { language: '' })
    case 'sitemap':
      return dataSourceTypeDisplayConfig.sitemap.getTitle(item, { language: '' })
  }
}

export const getReadyCount = (items: KnowledgeItem[]) =>
  items.reduce((readyCount, item) => readyCount + (item.status === 'completed' ? 1 : 0), 0)

export const toKnowledgeItemRowViewModel = (
  item: KnowledgeItem,
  language: string,
  fileEntry?: FileEntry
): KnowledgeItemRowViewModel => {
  switch (item.type) {
    case 'file': {
      const config = dataSourceTypeDisplayConfig.file
      const context = { fileEntry, language }

      return {
        title: config.getTitle(item, context),
        suffix: config.getSuffix(item, context),
        metaParts: config.getMetaParts(item, context),
        icon: config.icon,
        status: config.getStatus(item.status)
      }
    }
    case 'note': {
      const config = dataSourceTypeDisplayConfig.note

      return {
        title: config.getTitle(item, { language }),
        suffix: config.getSuffix(item, { language }),
        metaParts: config.getMetaParts(item, { language }),
        icon: config.icon,
        status: config.getStatus(item.status)
      }
    }
    case 'directory': {
      const config = dataSourceTypeDisplayConfig.directory

      return {
        title: config.getTitle(item, { language }),
        suffix: config.getSuffix(item, { language }),
        metaParts: config.getMetaParts(item, { language }),
        icon: config.icon,
        status: config.getStatus(item.status)
      }
    }
    case 'url': {
      const config = dataSourceTypeDisplayConfig.url

      return {
        title: config.getTitle(item, { language }),
        suffix: config.getSuffix(item, { language }),
        metaParts: config.getMetaParts(item, { language }),
        icon: config.icon,
        status: config.getStatus(item.status)
      }
    }
    case 'sitemap': {
      const config = dataSourceTypeDisplayConfig.sitemap

      return {
        title: config.getTitle(item, { language }),
        suffix: config.getSuffix(item, { language }),
        metaParts: config.getMetaParts(item, { language }),
        icon: config.icon,
        status: config.getStatus(item.status)
      }
    }
  }
}
