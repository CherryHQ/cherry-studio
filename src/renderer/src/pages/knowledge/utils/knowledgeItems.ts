import type { KnowledgeItem } from '@shared/data/types/knowledge'

export interface KnowledgeItemsByType {
  files: KnowledgeItem[]
  notes: KnowledgeItem[]
  directories: KnowledgeItem[]
  urls: KnowledgeItem[]
  sitemaps: KnowledgeItem[]
}

export const groupKnowledgeItemsByType = (items: KnowledgeItem[]): KnowledgeItemsByType => {
  return {
    files: items.filter((item) => item.type === 'file' && !item.parentId),
    notes: items.filter((item) => item.type === 'note'),
    directories: items.filter((item) => item.type === 'directory'),
    urls: items.filter((item) => item.type === 'url'),
    sitemaps: items.filter((item) => item.type === 'sitemap')
  }
}
