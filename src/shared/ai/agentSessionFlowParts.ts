import type { UIMessageChunk } from 'ai'

import type { CherryMessagePart } from '../data/types/message'

/** Live parented parts for one persisted assistant message. */
export type AgentSessionFlowParts = CherryMessagePart[]

export const AGENT_SESSION_FLOW_PARTS_CACHE_KEY = (sessionId: string, messageId: string) =>
  `agent.session.flow_parts.${sessionId}.${messageId}` as const

/**
 * Detached chunks whose host row had not committed when the session closed. Kept per root briefly
 * so a reopen that finds the row can still deliver them instead of dropping the output.
 */
export type AgentSessionFlowRecoveryOrphan = UIMessageChunk[]

export const AGENT_SESSION_FLOW_RECOVERY_ORPHAN_CACHE_KEY = (sessionId: string, rootToolCallId: string) =>
  `agent.session.flow_recovery_orphan.${sessionId}.${rootToolCallId}` as const
