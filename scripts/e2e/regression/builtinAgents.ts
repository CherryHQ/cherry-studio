import type { AgentEntity } from '../../../src/shared/data/api/schemas/agents'
import type { OffsetPaginationResponse } from '../../../src/shared/data/api/types'

export type BuiltinAssistantAgentIdentity = Pick<AgentEntity, 'id' | 'name' | 'configuration'>
export type BuiltinAssistantAgent = Pick<AgentEntity, 'id' | 'name'>

export const BUILTIN_ASSISTANT_AGENT_ROLE = 'assistant'

export function resolveBuiltinAssistantAgent(
  list: OffsetPaginationResponse<BuiltinAssistantAgentIdentity>
): BuiltinAssistantAgent {
  const { page, total, items } = list
  if (page !== 1 || total > 500 || items.length !== total) {
    throw new Error(
      `Expected complete GET /agents page 1 (limit 500); received page ${page}, ${items.length}/${total} agents`
    )
  }

  const assistants = items.filter((agent) => agent.configuration?.builtin_role === BUILTIN_ASSISTANT_AGENT_ROLE)
  if (assistants.length !== 1) {
    throw new Error(
      `Expected exactly one built-in assistant agent (builtin_role=assistant); found ${assistants.length}`
    )
  }

  const { id, name } = assistants[0]
  if (typeof id !== 'string' || id.length === 0 || typeof name !== 'string' || name.length === 0) {
    throw new Error('Built-in assistant agent must have non-empty id and name')
  }
  return { id, name }
}
