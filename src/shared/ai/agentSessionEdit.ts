import type { CherryMessagePart } from '../data/types/message'

// Stop aborts the stream before async session teardown ends, so stream status alone misses the closing edit gate.
export const AGENT_SESSION_CLOSING_CACHE_KEY = (sessionId: string) => `agent.session.closing.${sessionId}` as const

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
  'close_failed',
  'checkpoint_unsupported'
] as const

export type AgentSessionEditFailureReason = (typeof agentSessionEditFailureReasons)[number]
