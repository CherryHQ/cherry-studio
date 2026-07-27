import { useInvalidateCache, useMutation, useQuery } from '@data/hooks/useDataApi'
import { createAgentAndRefresh } from '@renderer/hooks/agent/createAgent'
import type { AgentDetail } from '@renderer/types/resourceCatalog'
import { AGENTS_MAX_LIMIT, type UpdateAgentDto } from '@shared/data/api/schemas/agents'
import type { CreateAgentCommand } from '@shared/ipc/schemas/ai'
import { useCallback, useState } from 'react'

import type { ResourceAdapter, ResourceListQuery, ResourceListResult } from './types'

/**
 * List hook for agent resources — mirrors `assistantAdapter.useAssistantList`.
 *
 * `search` is forwarded to `GET /agents` and evaluated server-side (see
 * `AgentService.listAgents`), so callers don't need to chain a client-side
 * filter on top.
 */
function useAgentList(query?: ResourceListQuery): ResourceListResult<AgentDetail> {
  const { data, isLoading, isRefreshing, error, refetch } = useQuery('/agents', {
    enabled: query?.enabled !== false,
    query: {
      limit: query?.limit ?? AGENTS_MAX_LIMIT,
      ...(query?.search ? { search: query.search } : {})
    }
  })

  const items = data?.items ?? []
  const stableRefetch = useCallback(() => refetch(), [refetch])

  return {
    data: items,
    isLoading,
    isRefreshing,
    error,
    refetch: stableRefetch
  }
}

export const agentAdapter: ResourceAdapter<AgentDetail> = {
  resource: 'agent',
  useList: useAgentList
}

/** List-level write hook — create only. */
export function useAgentMutations() {
  const invalidate = useInvalidateCache()
  const [isCreatingAgent, setIsCreatingAgent] = useState(false)

  const createAgent = useCallback(
    async (dto: CreateAgentCommand): Promise<AgentDetail> => {
      setIsCreatingAgent(true)
      try {
        return await createAgentAndRefresh(dto, () => invalidate('/agents'))
      } finally {
        setIsCreatingAgent(false)
      }
    },
    [invalidate]
  )

  return { createAgent, isCreatingAgent }
}

/**
 * Mutation hook scoped to a single agent id. PATCH accepts any `AgentBase`
 * subset (typed as `UpdateAgentDto`); the backend merges at the row level.
 * Plain DELETE removes the agent only; sessions remain as history.
 */
export function useAgentMutationsById(id: string) {
  const path = `/agents/${id}` as const

  const { trigger: updateTrigger } = useMutation('PATCH', path, {
    // skillUpdates writes the agent_skill join table, which backs `GET /skills?agentId=…`
    // (per-agent isEnabled projection) — refresh it so those lists don't go stale.
    refresh: ({ args }) =>
      args?.body?.skillUpdates !== undefined ? ['/agents', '/agents/*', '/skills'] : ['/agents', '/agents/*']
  })
  const { trigger: deleteTrigger } = useMutation('DELETE', path, {
    refresh: ['/agents', '/agents/*', '/pins']
  })

  const updateAgent = useCallback(
    (dto: UpdateAgentDto): Promise<AgentDetail> => updateTrigger({ body: dto }),
    [updateTrigger]
  )
  const deleteAgent = useCallback((): Promise<void> => deleteTrigger().then(() => undefined), [deleteTrigger])

  return { updateAgent, deleteAgent }
}
