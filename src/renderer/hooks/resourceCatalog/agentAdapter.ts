import { useInvalidateCache, useMutation, useQuery } from '@data/hooks/useDataApi'
import { useBuiltinAgentListVisibility } from '@renderer/hooks/agent/useBuiltinAgentListVisibility'
import { createAgentAndRefresh } from '@renderer/services/createAgent'
import { deleteAgentAndRefresh } from '@renderer/services/deleteAgent'
import type { AgentDetail } from '@renderer/types/resourceCatalog'
import { PROTECTED_BUILTIN_AGENT_ROLES } from '@shared/ai/builtinAgent'
import { AGENTS_MAX_LIMIT, type UpdateAgentDto } from '@shared/data/api/schemas/agents'
import type { CreateAgentCommand } from '@shared/ipc/schemas/ai'
import { useCallback, useMemo, useState } from 'react'

import type { ResourceAdapter, ResourceListQuery, ResourceListResult } from './types'

/**
 * List hook for agent resources — mirrors `assistantAdapter.useAssistantList`.
 *
 * `search` is forwarded to `GET /agents` and evaluated server-side (see
 * `AgentService.listAgents`), so callers don't need to chain a client-side
 * filter on top.
 */
function useAgentList(query?: ResourceListQuery): ResourceListResult<AgentDetail> {
  const enabled = query?.enabled !== false
  const {
    filterHiddenBuiltinAgents,
    hasHiddenBuiltinAgents,
    isLoading: isVisibilityLoading
  } = useBuiltinAgentListVisibility()
  const primary = useQuery('/agents', {
    enabled,
    query: {
      limit: query?.limit ?? AGENTS_MAX_LIMIT,
      ...(query?.search ? { search: query.search } : {})
    }
  })
  const hiddenBuiltin = useQuery('/agents', {
    enabled: enabled && hasHiddenBuiltinAgents,
    query: {
      builtinRoles: [...PROTECTED_BUILTIN_AGENT_ROLES],
      limit: PROTECTED_BUILTIN_AGENT_ROLES.length,
      ...(query?.search ? { search: query.search } : {})
    }
  })

  const items = useMemo(() => {
    const primaryItems = primary.data?.items ?? []
    const primaryIds = new Set(primaryItems.map((agent) => agent.id))
    const missingHiddenBuiltins = filterHiddenBuiltinAgents(hiddenBuiltin.data?.items ?? []).filter(
      (agent) => !primaryIds.has(agent.id)
    )
    return [...primaryItems, ...missingHiddenBuiltins]
  }, [filterHiddenBuiltinAgents, hiddenBuiltin.data?.items, primary.data?.items])
  const primaryRefetch = primary.refetch
  const hiddenBuiltinRefetch = hiddenBuiltin.refetch
  const stableRefetch = useCallback(() => {
    void primaryRefetch()
    if (hasHiddenBuiltinAgents) void hiddenBuiltinRefetch()
  }, [hasHiddenBuiltinAgents, hiddenBuiltinRefetch, primaryRefetch])

  return {
    data: items,
    isLoading: primary.isLoading || isVisibilityLoading,
    isRefreshing: primary.isRefreshing || hiddenBuiltin.isRefreshing,
    error: primary.error,
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
  const invalidate = useInvalidateCache()

  const { trigger: updateTrigger } = useMutation('PATCH', path, {
    // skillUpdates writes the agent_skill join table, which backs `GET /skills?agentId=…`
    // (per-agent isEnabled projection) — refresh it so those lists don't go stale.
    refresh: ({ args }) =>
      args?.body?.skillUpdates !== undefined ? ['/agents', '/agents/*', '/skills'] : ['/agents', '/agents/*']
  })
  const updateAgent = useCallback(
    (dto: UpdateAgentDto): Promise<AgentDetail> => updateTrigger({ body: dto }),
    [updateTrigger]
  )
  const deleteAgent = useCallback(async (): Promise<void> => {
    await deleteAgentAndRefresh(id, invalidate)
  }, [id, invalidate])

  return { updateAgent, deleteAgent }
}
