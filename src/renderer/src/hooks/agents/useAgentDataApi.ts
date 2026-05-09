/**
 * DataApi-backed agent queries and mutations.
 *
 * `agent` is the canonical reusable blueprint — sessions are pure instances of
 * it. Config (model / instructions / mcps / allowedTools / accessiblePaths /
 * configuration) lives here, not on sessions.
 */

import { useMutation, useQuery } from '@renderer/data/hooks/useDataApi'
import type { AddAgentForm, GetAgentResponse, UpdateAgentForm } from '@renderer/types'
import type { UpdateAgentBaseOptions, UpdateAgentFunction } from '@renderer/types/agent'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import type { AgentEntity } from '@shared/data/types/agent'
import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { parseAgentConfiguration } from './utils'

type Result<T> = { success: true; data: T } | { success: false; error: Error }

/**
 * Fetch a single agent by id from SQLite via DataApi. Parses `configuration`
 * through `AgentConfigurationSchema` so unknown extras survive a round-trip
 * while well-typed fields are validated.
 */
export const useAgent = (id: string | null) => {
  const { data, error, isLoading, refetch } = useQuery('/agents/:agentId', {
    params: { agentId: id! },
    enabled: !!id,
    swrOptions: {
      // Agent config may be modified externally (e.g. claw MCP tool in main process),
      // so always revalidate on mount and reduce dedup window to get fresh data.
      revalidateOnMount: true,
      dedupingInterval: 2000,
      keepPreviousData: false
    }
  })

  // Cast to GetAgentResponse for structural compatibility with settings components
  // (tools field will be undefined — callers use `?? []` fallbacks).
  const agent = useMemo((): GetAgentResponse | undefined => {
    if (!data) return undefined
    return {
      ...(data as unknown as GetAgentResponse),
      configuration: parseAgentConfiguration(data.configuration, { entityId: data.id, entityType: 'agent' })
    }
  }, [data])

  return { agent, error, isLoading, revalidate: refetch }
}

/**
 * List + mutate all agents. Deleting an agent cascades to its sessions at
 * the DB layer (FK ON DELETE cascade); the active-session pointer is
 * normalized by `useAgentSessionInitializer` next render.
 */
export const useAgents = () => {
  const { t } = useTranslation()
  const { data, isLoading, error } = useQuery('/agents')
  const agents = useMemo<AgentEntity[]>(() => (data?.items ?? []) as unknown as AgentEntity[], [data])

  const { trigger: createTrigger } = useMutation('POST', '/agents', { refresh: ['/agents'] })
  const addAgent = useCallback(
    async (form: AddAgentForm): Promise<Result<AgentEntity>> => {
      try {
        const result = await createTrigger({ body: form })
        window.toast.success(t('common.add_success'))
        return { success: true, data: result as unknown as AgentEntity }
      } catch (error) {
        const msg = formatErrorMessageWithPrefix(error, t('agent.add.error.failed'))
        window.toast.error(msg)
        return { success: false, error: error instanceof Error ? error : new Error(msg) }
      }
    },
    [createTrigger, t]
  )

  const { trigger: deleteTrigger } = useMutation('DELETE', '/agents/:agentId', {
    refresh: ['/agents', '/sessions']
  })
  const deleteAgent = useCallback(
    async (id: string) => {
      try {
        await deleteTrigger({ params: { agentId: id } })
        window.toast.success(t('common.delete_success'))
      } catch (error) {
        window.toast.error(formatErrorMessageWithPrefix(error, t('agent.delete.error.failed')))
      }
    },
    [deleteTrigger, t]
  )

  return { agents, error, isLoading, addAgent, deleteAgent }
}

/**
 * Patch an agent. Returns the parsed updated entity, or `undefined` on
 * failure (toast surfaces the error to the user).
 */
export const useUpdateAgent = () => {
  const { t } = useTranslation()
  const { trigger: updateTrigger } = useMutation('PATCH', '/agents/:agentId', {
    refresh: ({ args }) => ['/agents', `/agents/${args?.params?.agentId}`]
  })

  const updateAgent: UpdateAgentFunction = useCallback(
    async (form: UpdateAgentForm, options?: UpdateAgentBaseOptions): Promise<AgentEntity | undefined> => {
      try {
        const { id, ...patch } = form
        const result = await updateTrigger({ params: { agentId: id }, body: patch })
        if (options?.showSuccessToast ?? true) {
          window.toast.success({ key: 'update-agent', title: t('common.update_success') })
        }

        return {
          ...(result as unknown as AgentEntity),
          configuration: parseAgentConfiguration(result.configuration, { entityId: result.id, entityType: 'agent' })
        }
      } catch (error) {
        window.toast.error(formatErrorMessageWithPrefix(error, t('agent.update.error.failed')))
        return undefined
      }
    },
    [updateTrigger, t]
  )

  const updateModel = useCallback(
    async (agentId: string, modelId: string, options?: UpdateAgentBaseOptions) => {
      void updateAgent({ id: agentId, model: modelId }, options)
    },
    [updateAgent]
  )

  return { updateAgent, updateModel }
}
