import type { UIMessageChunk } from 'ai'

import type { CherryMessagePart } from '../data/types/message'

/** Live parented parts for one persisted assistant message. */
export type AgentSessionFlowParts = CherryMessagePart[]

export const AGENT_SESSION_FLOW_PARTS_CACHE_KEY = (sessionId: string, messageId: string) =>
  `agent.session.flow_parts.${sessionId}.${messageId}` as const

/**
 * Detached chunks whose host row had not committed when the session closed. Persisted (restart-safe)
 * so a reopen that finds the row can still deliver them; `orphannedAt` lets stale entries expire.
 */
export interface AgentSessionFlowRecoveryOrphan {
  sessionId: string
  rootToolCallId: string
  /** Epoch ms of the teardown that orphaned the batch. */
  orphannedAt: number
  chunks: UIMessageChunk[]
}
