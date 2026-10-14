import type { KnowledgeItem } from '@shared/data/types/knowledge'

import { dataSourceTypeDisplayConfig, type KnowledgeItemRowViewModel } from './models'

/**
 * Whether reindexing this item would be admitted by the main process. Mirrors
 * `REINDEX_ALLOWED_STATUSES` in `KnowledgeIngestionService`, which rejects the whole
 * batch when any selected subtree is still active — so the bulk action must filter
 * with the same predicate the row menu uses, or one in-flight item blocks the rest.
 */
export const canReindexKnowledgeItem = (item: KnowledgeItem): boolean =>
  item.status === 'completed' || item.status === 'failed'

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
  }
}

export const getItemTitle = (item: KnowledgeItem): string => {
  switch (item.type) {
    case 'file':
      return dataSourceTypeDisplayConfig.file.getTitle(item, { language: '' })
    case 'note':
      return dataSourceTypeDisplayConfig.note.getTitle(item, { language: '' })
    case 'directory':
      return dataSourceTypeDisplayConfig.directory.getTitle(item, { language: '' })
    case 'url':
      return dataSourceTypeDisplayConfig.url.getTitle(item, { language: '' })
  }
}

export const toKnowledgeItemRowViewModel = (item: KnowledgeItem, language: string): KnowledgeItemRowViewModel => {
  switch (item.type) {
    case 'file': {
      const config = dataSourceTypeDisplayConfig.file
      const context = { language }

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
  }
}
