import type { CherryMessagePart } from '../data/types/message'

/** Live parented parts for one persisted assistant message. */
export type AgentSessionFlowParts = CherryMessagePart[]

export const AGENT_SESSION_FLOW_PARTS_CACHE_KEY = (sessionId: string, messageId: string) =>
  `agent.session.flow_parts.${sessionId}.${messageId}` as const
