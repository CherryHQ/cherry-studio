import { cacheService } from '@renderer/data/CacheService'
import { dataApiService } from '@renderer/data/DataApiService'
import { useCache } from '@renderer/data/hooks/useCache'
import { useInvalidateCache, useQuery } from '@renderer/data/hooks/useDataApi'
import type { AddAgentForm, CreateAgentResponse, GetAgentResponse } from '@renderer/types'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import type { OffsetPaginationResponse } from '@shared/data/api/apiTypes'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'

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
        const result = (await dataApiService.post('/agents', {
          body: form
        })) as CreateAgentResponse
        await invalidate('/agents')
        await invalidate(`/agents/${result.id}`)
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
    [invalidate, t]
  )

  const deleteAgent = useCallback(
    async (id: string) => {
      try {
        await dataApiService.delete(`/agents/${id}`)
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
    [activeAgentId, pagedData, invalidate, t]
  )

  const getAgent = useCallback(
    async (id: string) => {
      await invalidate(`/agents/${id}`)
      await invalidate('/agents')
    },
    [invalidate]
  )

  const reorderAgents = useCallback(
    async (reorderedList: GetAgentResponse[]) => {
      const orderedIds = reorderedList.map((a) => a.id)
      try {
        await dataApiService.patch('/agents', {
          body: { orderedIds }
        })
        await invalidate('/agents')
      } catch (error) {
        await invalidate('/agents')
        window.toast.error(formatErrorMessageWithPrefix(error, t('agent.reorder.error.failed')))
      }
    },
    [invalidate, t]
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
