import type { CherryMessagePart, CherryUIMessage, MessageStats, MessageStatus } from '@shared/data/types/message'

import type { Model } from './index'
import type { Message } from './newMessage'

export interface MessageExportView {
  id: string
  role: CherryUIMessage['role']
  assistantId?: string
  topicId: string
  createdAt: string
  updatedAt?: string
  status: MessageStatus
  modelId?: string
  model?: Model
  parentId?: string | null
  siblingsGroupId?: number
  stats?: MessageStats
  parts: CherryMessagePart[]
  traceId?: string
}

export type ExportableMessage = Message | MessageExportView
