export type KnowledgeV2BaseGroup = 'work' | 'personal' | 'project'

export type KnowledgeV2BaseStatus = 'ready' | 'processing' | 'failed'

export type KnowledgeV2TabKey = 'dataSource' | 'ragConfig' | 'recallTest'

export interface KnowledgeV2Base {
  id: string
  name: string
  group: KnowledgeV2BaseGroup
  itemCount: number
  status: KnowledgeV2BaseStatus
  updatedAt: string
  icon: string
  iconClassName: string
}
