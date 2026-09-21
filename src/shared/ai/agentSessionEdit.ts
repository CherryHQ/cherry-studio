import type { CherryMessagePart } from '../data/types/message'

export interface AgentSessionEditTarget {
  messageId: string
  version: string
}

export interface AgentSessionEditDraft extends AgentSessionEditTarget {
  parts: CherryMessagePart[]
}

export const agentSessionEditFailureReasons = [
  'busy',
  'history_changed',
  'invalid_target',
  'input_unsupported',
  'attachment_unavailable',
  'close_failed'
] as const

export type AgentSessionEditFailureReason = (typeof agentSessionEditFailureReasons)[number]
