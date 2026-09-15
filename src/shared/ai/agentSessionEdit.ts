import type { CherryMessagePart } from '@shared/data/types/message'

export const AGENT_SESSION_EDIT_REASONS = [
  'source_missing',
  'not_last_user_message',
  'busy',
  'history_changed',
  'invalid_mapping',
  'attachment_unavailable',
  'input_unsupported',
  'operation_conflict',
  'send_uncertain',
  'close_failed'
] as const

export type AgentSessionEditReason = (typeof AGENT_SESSION_EDIT_REASONS)[number]

export const AGENT_SESSION_PENDING_INPUT_COUNT_KEY = (sessionId: string) =>
  `agent.session.pending_input_count.${sessionId}` as const

export interface AgentSessionEditTarget {
  messageId: string
  version: string
  operationId: string
}

export interface AgentSessionEditSnapshotDto {
  version: string
  parts: CherryMessagePart[]
}
