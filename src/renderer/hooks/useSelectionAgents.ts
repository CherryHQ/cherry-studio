import { useMemo } from 'react'

import { useDataChange, useQuery } from '@renderer/data/hooks/useDataApi'
import { BUILTIN_AGENT_ROLE } from '@shared/ai/builtinAgent'
import type { AgentEntity } from '@shared/data/api/schemas/agents'

const NO_AGENTS: AgentEntity[] = []

/**
 * Reads only the agents selection actions run on, so a large library cannot page one out.
 * A null ID stands for Cherry Assistant, which is found by its role. Undefined until every read has loaded.
 */
export function useSelectionAgents(agentIds: readonly (string | null)[]): AgentEntity[] | undefined {
  const ids = [...new Set(agentIds.filter((id): id is string => id !== null))]
  const withAssistant = agentIds.includes(null)
  const bound = useQuery('/agents', { query: { ids }, enabled: ids.length > 0 })
  const assistant = useQuery('/agents', {
    query: { builtinRole: BUILTIN_AGENT_ROLE.ASSISTANT },
    enabled: withAssistant
  })
  useDataChange('/agents', () => {
    if (ids.length > 0) void bound.refetch()
    if (withAssistant) void assistant.refetch()
  })

  const boundAgents = ids.length > 0 ? bound.data?.items : NO_AGENTS
  const assistantAgents = withAssistant ? assistant.data?.items : NO_AGENTS
  return useMemo(
    () => (boundAgents && assistantAgents ? [...boundAgents, ...assistantAgents] : undefined),
    [boundAgents, assistantAgents]
  )
}
