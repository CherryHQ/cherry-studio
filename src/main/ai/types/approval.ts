import type { AgentApprovalStatus } from '@shared/ai/agentSessionApprovals'

export interface ApprovalRequestedEvent {
  topicId: string
  approvalId: string
  requestedAt: number
  registration?: { id: string; messageId: string; taskToolCallId?: string }
}

export interface ApprovalSettledEvent {
  registrationId: string
  status: Exclude<AgentApprovalStatus, 'pending'>
}
