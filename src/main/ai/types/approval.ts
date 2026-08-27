import type { ConversationRef } from '@shared/ai/conversation'

export interface ApprovalRequestedEvent {
  conversation: ConversationRef
  approvalId: string
  requestedAt: number
}
