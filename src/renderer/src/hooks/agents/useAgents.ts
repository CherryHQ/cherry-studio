import { cacheService } from '@renderer/data/CacheService'
import { useCache } from '@renderer/data/hooks/useCache'
import { useInvalidateCache, useQuery } from '@renderer/data/hooks/useDataApi'
import type { AddAgentForm, CreateAgentResponse, GetAgentResponse } from '@renderer/types'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import type { OffsetPaginationResponse } from '@shared/data/api/apiTypes'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'

import { useAgentClient } from './useAgentClient'

type Result<T> =
  | {
      success: true
      data: T
    }
  | {
      success: false
      error: Error
    }

export const useAgents = () => {
  const { t } = useTranslation()
  const client = useAgentClient()
  const invalidate = useInvalidateCache()
  const { data, error, isLoading, refetch } = useQuery('/agents', {
    query: {
      page: 1,
      limit: 200,
      sortBy: 'sort_order',
      orderBy: 'asc'
    }
  })
  const [activeAgentId] = useCache('agent.active_id')
  const pagedData = data as OffsetPaginationResponse<GetAgentResponse> | undefined

  const addAgent = useCallback(
    async (form: AddAgentForm): Promise<Result<CreateAgentResponse>> => {
      try {
        if (!client) {
          throw new Error(t('apiServer.messages.notEnabled'))
        }
        const result = await client.createAgent(form)
        await invalidate('/agents')
        window.toast.success(t('common.add_success'))
        return { success: true, data: result }
      } catch (error) {
        const errorMessage = formatErrorMessageWithPrefix(error, t('agent.add.error.failed'))
        window.toast.error(errorMessage)
        if (error instanceof Error) {
          return { success: false, error }
        }
        return { success: false, error: new Error(formatErrorMessageWithPrefix(error, t('agent.add.error.failed'))) }
      }
    },
    [client, invalidate, t]
  )

  const deleteAgent = useCallback(
    async (id: string) => {
      try {
        if (!client) {
          throw new Error(t('apiServer.messages.notEnabled'))
        }
        await client.deleteAgent(id)
        const currentMap = cacheService.get('agent.session.active_id_map') ?? {}
        cacheService.set('agent.session.active_id_map', { ...currentMap, [id]: null })
        if (activeAgentId === id) {
          const newId = pagedData?.items.filter((a) => a.id !== id).find(() => true)?.id
          cacheService.set('agent.active_id', newId ?? null)
        }
        await invalidate(['/agents', `/agents/${id}`])
        window.toast.success(t('common.delete_success'))
      } catch (error) {
        window.toast.error(formatErrorMessageWithPrefix(error, t('agent.delete.error.failed')))
      }
    },
    [activeAgentId, client, pagedData, invalidate, t]
  )

  const getAgent = useCallback(
    async (id: string) => {
      if (!client) {
        return
      }
      await invalidate(`/agents/${id}`)
      await invalidate('/agents')
    },
    [client, invalidate]
  )

  const reorderAgents = useCallback(
    async (reorderedList: GetAgentResponse[]) => {
      const orderedIds = reorderedList.map((a) => a.id)
      try {
        if (!client) {
          throw new Error(t('apiServer.messages.notEnabled'))
        }
        await client.reorderAgents(orderedIds)
        await invalidate('/agents')
      } catch (error) {
        await invalidate('/agents')
        window.toast.error(formatErrorMessageWithPrefix(error, t('agent.reorder.error.failed')))
      }
    },
    [client, invalidate, t]
  )

  return {
    agents: pagedData?.items,
    error,
    isLoading,
    addAgent,
    deleteAgent,
    getAgent,
    reorderAgents,
    refetch
  }
}
