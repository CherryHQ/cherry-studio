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
}

// `Message` (v1) is still produced only by the v1-block-based export/copy test
// fixtures; all live producers now yield `MessageExportView`. Dropping the arm
// is gated on migrating `export.test.ts` / `copy.test.ts` off the v1 block model.
export type ExportableMessage = Message | MessageExportView
