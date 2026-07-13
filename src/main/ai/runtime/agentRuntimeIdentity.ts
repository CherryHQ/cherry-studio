import { AGENT_RUNTIME_CAPABILITIES } from '@shared/ai/agentRuntimeCapabilities'
import type { AgentEntity } from '@shared/data/api/schemas/agents'
import type { UniqueModelId } from '@shared/data/types/model'

/**
 * AiStreamManager still keys every dispatch through its model-shaped slot. Agent-session runtimes
 * without a Cherry model use a local, non-persisted agent identity until that older boundary is
 * generalized. Concrete drivers and remote ids never leak into the host.
 */
export function getAgentRuntimeExecutionId(
  agent: Pick<AgentEntity, 'id' | 'type' | 'model'>
): UniqueModelId | undefined {
  if (agent.model) return agent.model
  if (requiresLocalModel(agent.type)) return undefined
  return `agent-runtime::${agent.id}` as UniqueModelId
}

export function requiresLocalModel(type: string): boolean {
  return AGENT_RUNTIME_CAPABILITIES[type as keyof typeof AGENT_RUNTIME_CAPABILITIES]?.requiresModel ?? true
}
