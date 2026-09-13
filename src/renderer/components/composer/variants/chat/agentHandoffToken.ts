import type { ComposerDraftToken, ComposerSerializedToken } from '../../tokens'

export const AGENT_HANDOFF_TOKEN_ID_PREFIX = 'agent-handoff:'

export interface AgentHandoffTokenPayload {
  kind: 'agent-handoff'
  agentId: string
  name: string
  description?: string
}

export type AgentHandoffToken = ComposerDraftToken & {
  kind: 'reference'
  payload: AgentHandoffTokenPayload
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isAgentHandoffToken(token: Pick<ComposerDraftToken, 'kind' | 'payload'>): boolean {
  return token.kind === 'reference' && isRecord(token.payload) && token.payload.kind === 'agent-handoff'
}

export function getAgentHandoffTokenPayload(
  token: Pick<ComposerDraftToken, 'kind' | 'payload'>
): AgentHandoffTokenPayload | null {
  if (!isAgentHandoffToken(token)) return null
  const payload = token.payload as Record<string, unknown>
  if (typeof payload.agentId !== 'string' || typeof payload.name !== 'string') return null
  return {
    kind: 'agent-handoff',
    agentId: payload.agentId,
    name: payload.name,
    ...(typeof payload.description === 'string' ? { description: payload.description } : {})
  }
}

export function createAgentHandoffToken(agent: { id: string; name: string; description?: string }): AgentHandoffToken {
  return {
    id: `${AGENT_HANDOFF_TOKEN_ID_PREFIX}${agent.id}`,
    kind: 'reference',
    label: agent.name,
    description: agent.description,
    payload: {
      kind: 'agent-handoff',
      agentId: agent.id,
      name: agent.name,
      ...(agent.description ? { description: agent.description } : {})
    }
  }
}

export function findAgentHandoffToken(tokens: readonly ComposerSerializedToken[]): ComposerSerializedToken | null {
  return tokens.find((token) => isAgentHandoffToken(token)) ?? null
}
