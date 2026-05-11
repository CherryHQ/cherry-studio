import type { KnowledgeItemOf } from '@shared/data/types/knowledge'

export type IndexableKnowledgeItem = KnowledgeItemOf<'file' | 'url' | 'note'>
