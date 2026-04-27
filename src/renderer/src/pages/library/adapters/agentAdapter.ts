import { useMutation, useQuery } from '@data/hooks/useDataApi'
import type { CreateAgentDto, UpdateAgentDto } from '@shared/data/api/schemas/agents'
import type { AgentDetail } from '@shared/data/types/agent'
import { useCallback } from 'react'

import type { ResourceAdapter, ResourceListQuery, ResourceListResult } from './types'

/**
 * Default page size for the library list view. Matches the backend schema's
 * `limit` max (`packages/shared/data/api/schemas/agents.ts`'s `AGENTS_MAX_LIMIT`)
 * so the library grid surfaces every agent without a pagination UI.
 */
const DEFAULT_LIST_LIMIT = 500

/**
 * List hook for agent resources — mirrors `assistantAdapter.useAssistantList`.
 *
 * `search` and `tagIds` are forwarded to `GET /agents` query params and
 * evaluated server-side (see `AgentService.listAgents`), so callers don't
 * need to chain a client-side filter on top.
 */
function useAgentList(query?: ResourceListQuery): ResourceListResult<AgentDetail> {
  const { data, isLoading, isRefreshing, error, refetch } = useQuery('/agents', {
    query: {
      limit: query?.limit ?? DEFAULT_LIST_LIMIT,
      ...(query?.search ? { search: query.search } : {}),
      ...(query?.tagIds && query.tagIds.length > 0 ? { tagIds: query.tagIds } : {})
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
  const { trigger: createTrigger } = useMutation('POST', '/agents', {
    refresh: ['/agents']
  })

  const createAgent = useCallback(
    (dto: CreateAgentDto): Promise<AgentDetail> => createTrigger({ body: dto }),
    [createTrigger]
  )

  return { createAgent }
}

/**
 * Mutation hook scoped to a single agent id. PATCH accepts any `AgentBase`
 * subset (typed as `UpdateAgentDto`); the backend merges at the row level.
 * DELETE cascades sessions / tasks on the main side.
 */
export function useAgentMutationsById(id: string) {
  const path = `/agents/${id}` as const

  const { trigger: updateTrigger } = useMutation('PATCH', path, {
    refresh: ['/agents']
  })
  const { trigger: deleteTrigger } = useMutation('DELETE', path, {
    refresh: ['/agents']
  })

  const updateAgent = useCallback(
    (dto: UpdateAgentDto): Promise<AgentDetail> => updateTrigger({ body: dto }),
    [updateTrigger]
  )
  const deleteAgent = useCallback((): Promise<void> => deleteTrigger().then(() => undefined), [deleteTrigger])

  return { updateAgent, deleteAgent }
}
