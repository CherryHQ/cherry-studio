import type { CherryMessagePart } from '../data/types/message'

/**
 * Live parented parts emitted by background agents after their spawning turn has settled.
 * Keyed by the persisted assistant message that owns the root agent tool call.
 */
export type AgentSessionFlowParts = Record<string, CherryMessagePart[]>

export const AGENT_SESSION_FLOW_PARTS_CACHE_KEY = (sessionId: string) =>
  `agent.session.flow_parts.${sessionId}` as const
