import { cacheService } from '@renderer/data/CacheService'
import { useCache } from '@renderer/data/hooks/useCache'
import { useMutation, useQuery } from '@renderer/data/hooks/useDataApi'
import type { AddAgentForm, AgentEntity, CreateAgentResponse } from '@renderer/types'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { useLegacyAgentReorderClient } from './useLegacyAgentReorderClient'
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
  const { data, isLoading, error, refetch, mutate } = useQuery('/agents')
  const agents = useMemo<AgentEntity[]>(() => (data?.items ?? []) as unknown as AgentEntity[], [data])
  const [activeAgentId] = useCache('agent.active_id')
  const legacyReorderClient = useLegacyAgentReorderClient()

  const { trigger: createTrigger } = useMutation('POST', '/agents', { refresh: ['/agents'] })
  const addAgent = useCallback(
    async (form: AddAgentForm): Promise<Result<CreateAgentResponse>> => {
      try {
        const result = await createTrigger({ body: form })
        window.toast.success(t('common.add_success'))
        return { success: true, data: result as unknown as CreateAgentResponse }
      } catch (error) {
        const msg = formatErrorMessageWithPrefix(error, t('agent.add.error.failed'))
        window.toast.error(msg)
        return { success: false, error: error instanceof Error ? error : new Error(msg) }
      }
    },
    [createTrigger, t]
  )

  const { trigger: deleteTrigger } = useMutation('DELETE', '/agents/:agentId', { refresh: ['/agents'] })
  const deleteAgent = useCallback(
    async (id: string) => {
      try {
        await deleteTrigger({ params: { agentId: id } })
        const currentMap = cacheService.get('agent.session.active_id_map') ?? {}
        cacheService.set('agent.session.active_id_map', { ...currentMap, [id]: null })
        if (activeAgentId === id) {
          const newId = agents.filter((a) => a.id !== id).find(() => true)?.id
          cacheService.set('agent.active_id', newId ?? null)
        }
        window.toast.success(t('common.delete_success'))
      } catch (error) {
        window.toast.error(formatErrorMessageWithPrefix(error, t('agent.delete.error.failed')))
      }
    },
    [deleteTrigger, activeAgentId, agents, t]
  )

  const reorderAgents = useCallback(
    async (reorderedList: AgentEntity[]) => {
      const orderedIds = reorderedList.map((a) => a.id)
      try {
        if (!legacyReorderClient) {
          throw new Error(t('apiServer.messages.notEnabled'))
        }
        if (data) {
          await mutate({ ...data, items: reorderedList } as never, { revalidate: false })
        }
        await legacyReorderClient.reorderAgents(orderedIds)
        await refetch()
      } catch (error) {
        await refetch()
        window.toast.error(formatErrorMessageWithPrefix(error, t('agent.reorder.error.failed')))
      }
    },
    [legacyReorderClient, refetch, mutate, data, t]
  )

  return { agents, error, isLoading, addAgent, deleteAgent, reorderAgents }
}
