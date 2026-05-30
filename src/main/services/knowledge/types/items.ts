import type { KnowledgeItemOf } from '@shared/data/types/knowledge'

export type IndexableKnowledgeItem = KnowledgeItemOf<'file' | 'url' | 'note'>

export type ContainerKnowledgeItem = KnowledgeItemOf<'directory' | 'sitemap'>
export type ContainerKnowledgeItemType = ContainerKnowledgeItem['type']
