import type { CherryUIMessage, MessageStats, MessageStatus, ModelSnapshot } from '@shared/data/types/message'

export interface MessageListItem {
  id: string
  role: CherryUIMessage['role']
  assistantId?: string
  topicId: string
  parentId?: string | null
  createdAt: string
  updatedAt?: string
  status: MessageStatus
  modelId?: string
  modelSnapshot?: ModelSnapshot
  siblingsGroupId?: number
  isActiveBranch?: boolean
  stats?: MessageStats
}
