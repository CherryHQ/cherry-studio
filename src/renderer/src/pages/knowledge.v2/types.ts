import type { KnowledgeBase, KnowledgeItem } from '@shared/data/types/knowledge'

export type KnowledgeV2TabKey = 'dataSource' | 'ragConfig' | 'recallTest'

export type KnowledgeV2BaseListStatus = 'completed' | 'processing' | 'failed'
export type KnowledgeV2Item = KnowledgeItem & { parentId?: string | null }

export interface KnowledgeV2BaseListItem {
  base: KnowledgeBase
  itemCount: number
  status: KnowledgeV2BaseListStatus
}
