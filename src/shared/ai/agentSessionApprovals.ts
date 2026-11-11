import type { CherryMessagePart } from '../data/types/message'

export type AgentApprovalStatus = 'pending' | 'approved' | 'denied' | 'cancelled' | 'expired'

/** Derived display data. Only Main's live registration can accept a decision. */
export interface AgentSessionApproval {
  registrationId: string
  approvalId: string
  messageId: string
  part: CherryMessagePart
  status: AgentApprovalStatus
  source?: { contextId: string; threadId: string }
  taskPath: { contextId: string; toolCallId: string }[]
  parentMessageId?: string
}

export const AGENT_SESSION_APPROVALS_CACHE_KEY = (sessionId: string) => `agent.session.approvals.${sessionId}` as const
