import type { CreateKnowledgeItemDto, KnowledgeItem, KnowledgeRuntimeAddItemInput } from '@shared/data/types/knowledge'

import type { IndexableKnowledgeItem } from '../types/items'

export function isIndexableKnowledgeItem(item: KnowledgeItem): item is IndexableKnowledgeItem {
  return item.type === 'file' || item.type === 'url' || item.type === 'note'
}

export function filterIndexableKnowledgeItems(items: KnowledgeItem[]): IndexableKnowledgeItem[] {
  return items.filter(isIndexableKnowledgeItem)
}

export function normalizeAddItemInput(item: KnowledgeRuntimeAddItemInput): CreateKnowledgeItemDto {
  switch (item.type) {
    case 'file':
      return {
        groupId: item.groupId,
        type: 'file',
        data: {
          source: item.file.path,
          file: item.file
        }
      }
    case 'url': {
      const url = item.url.trim()
      return {
        groupId: item.groupId,
        type: 'url',
        data: {
          source: url,
          url
        }
      }
    }
    case 'sitemap': {
      const url = item.url.trim()
      return {
        groupId: item.groupId,
        type: 'sitemap',
        data: {
          source: url,
          url
        }
      }
    }
    case 'note': {
      const sourceUrl = item.sourceUrl?.trim()
      const source = item.source?.trim() || sourceUrl || item.content.trim()
      return {
        groupId: item.groupId,
        type: 'note',
        data: {
          source,
          content: item.content,
          ...(sourceUrl ? { sourceUrl } : {})
        }
      }
    }
    case 'directory': {
      const directoryPath = item.path.trim()
      return {
        groupId: item.groupId,
        type: 'directory',
        data: {
          source: directoryPath,
          path: directoryPath
        }
      }
    }
  }
}
