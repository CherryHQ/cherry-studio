import type { KnowledgeItem as KnowledgeItemV2 } from '@shared/data/types/knowledge'

export interface KnowledgeItemsByType {
  files: KnowledgeItemV2[]
  notes: KnowledgeItemV2[]
  directories: KnowledgeItemV2[]
  urls: KnowledgeItemV2[]
  sitemaps: KnowledgeItemV2[]
}

export const groupKnowledgeItemsByType = (items: KnowledgeItemV2[]): KnowledgeItemsByType => {
  return {
    files: items.filter((item) => item.type === 'file' && !item.parentId),
    notes: items.filter((item) => item.type === 'note'),
    directories: items.filter((item) => item.type === 'directory'),
    urls: items.filter((item) => item.type === 'url'),
    sitemaps: items.filter((item) => item.type === 'sitemap')
  }
}
