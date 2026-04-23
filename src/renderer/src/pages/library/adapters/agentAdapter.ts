import { useMutation, useQuery } from '@data/hooks/useDataApi'
import type { CreateAgentDto, UpdateAgentDto } from '@shared/data/api/schemas/agents'
import type { AgentDetail } from '@shared/data/types/agent'
import { useCallback } from 'react'

import type { ResourceAdapter, ResourceListResult } from './types'

/**
 * List hook for agent resources — mirrors `assistantAdapter.useAssistantList`.
 *
 * NOTE: `GET /agents` currently does not accept `search` / `tagIds` query params
 * (the upstream DataApi handler only exposes pagination). `search` is handled
 * by `useResourceLibrary`'s client-side filter; `tagIds` is a no-op here
 * because agents have no tag relation. The list-query argument is therefore
 * omitted from this adapter's signature.
 */
function useAgentList(): ResourceListResult<AgentDetail> {
  const { data, isLoading, isRefreshing, error, refetch } = useQuery('/agents')

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
