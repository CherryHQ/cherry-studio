import { useAppDispatch } from '@renderer/store'
import { setActiveAgentId, setActiveSessionIdAction } from '@renderer/store/runtime'
import { AddAgentForm, CreateAgentResponse } from '@renderer/types'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import useSWR from 'swr'

import { useApiServer } from '../useApiServer'
import { useRuntime } from '../useRuntime'
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
  const key = client.agentPaths.base
  const { apiServerConfig, apiServerRunning } = useApiServer()

  // Create a more dynamic SWR key that includes server running status
  const swrKey = apiServerRunning ? key : null

  const fetcher = useCallback(async () => {
    // API server will start on startup if enabled OR there are agents
    if (!apiServerConfig.enabled && !apiServerRunning) {
      throw new Error(t('apiServer.messages.notEnabled'))
    }
    if (!apiServerRunning) {
      throw new Error(t('agent.server.error.not_running'))
    }
    const result = await client.listAgents({ sortBy: 'created_at', orderBy: 'desc' })
    // NOTE: We only use the array for now. useUpdateAgent depends on this behavior.
    return result.data
  }, [apiServerConfig.enabled, apiServerRunning, client, t])
  const { data, error, isLoading, mutate } = useSWR(swrKey, fetcher)
  const { chat } = useRuntime()
  const { activeAgentId } = chat
  const dispatch = useAppDispatch()

  const addAgent = useCallback(
    async (form: AddAgentForm): Promise<Result<CreateAgentResponse>> => {
      try {
        const result = await client.createAgent(form)
        mutate((prev) => [...(prev ?? []), result])
        window.toast.success(t('common.add_success'))
        return { success: true, data: result }
      } catch (error) {
        const errorMessage = formatErrorMessageWithPrefix(error, t('agent.add.error.failed'))
        window.toast.error(errorMessage)
        if (error instanceof Error) {
          return { success: false, error }
        } else {
          return { success: false, error: new Error(formatErrorMessageWithPrefix(error, t('agent.add.error.failed'))) }
        }
      }
    },
    [client, mutate, t]
  )

  const deleteAgent = useCallback(
    async (id: string) => {
      try {
        await client.deleteAgent(id)
        dispatch(setActiveSessionIdAction({ agentId: id, sessionId: null }))
        if (activeAgentId === id) {
          const newId = data?.filter((a) => a.id !== id).find(() => true)?.id
          if (newId) {
            dispatch(setActiveAgentId(newId))
          } else {
            dispatch(setActiveAgentId(null))
          }
        }
        mutate((prev) => prev?.filter((a) => a.id !== id) ?? [])
        window.toast.success(t('common.delete_success'))
      } catch (error) {
        window.toast.error(formatErrorMessageWithPrefix(error, t('agent.delete.error.failed')))
      }
    },
    [activeAgentId, client, data, dispatch, mutate, t]
  )

  const getAgent = useCallback(
    async (id: string) => {
      const result = await client.getAgent(id)
      mutate((prev) => prev?.map((a) => (a.id === result.id ? result : a)) ?? [])
    },
    [client, mutate]
  )

  return {
    agents: data ?? [],
    error,
    isLoading,
    addAgent,
    deleteAgent,
    getAgent
  }
}
