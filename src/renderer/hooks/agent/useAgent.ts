/**
 * DataApi-backed agent queries and mutations.
 *
 * `agent` is the canonical reusable blueprint — sessions are pure instances of
 * it. Config (model / instructions / mcps / disabledTools /
 * configuration) lives here, not on sessions.
 */

import { useDataChange, useInvalidateCache, useMutation, useQuery } from '@renderer/data/hooks/useDataApi'
import { createAgentAndRefresh } from '@renderer/services/createAgent'
import { deleteAgentAndRefresh } from '@renderer/services/deleteAgent'
import { toast } from '@renderer/services/toast'
import type { AddAgentForm, UpdateAgentBaseOptions, UpdateAgentForm, UpdateAgentFunction } from '@renderer/types/agent'
import { parseAgentConfiguration } from '@renderer/utils/agent/utils'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import type { AgentEntity } from '@shared/data/api/schemas/agents'
import { AGENTS_MAX_LIMIT } from '@shared/data/api/schemas/agents'
import type { UniqueModelId } from '@shared/data/types/model'
import type { CreateAgentCommand } from '@shared/ipc/schemas/ai'
import type { ReasoningEffortOption } from '@shared/types/aiSdk'
import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

type Result<T> = { success: true; data: T } | { success: false; error: Error }
type UpdateAgentModelInput = {
  agentId: string
  modelId: UniqueModelId
  reasoningEffort?: ReasoningEffortOption
}

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
      // Agent config may be modified externally (e.g. cherry MCP tool in main process),
      // so always revalidate on mount and reduce dedup window to get fresh data.
      revalidateOnMount: true,
      dedupingInterval: 2000,
      keepPreviousData: false
    }
  })
  const agent = useMemo((): AgentEntity | undefined => {
    if (!data) return undefined
    return {
      ...data,
      configuration: parseAgentConfiguration(data.configuration, { entityId: data.id, entityType: 'agent' })
    }
  }, [data])

  const revalidate = useCallback(async () => {
    await refetch()
  }, [refetch])

  return { agent, error, isLoading, revalidate }
}

/**
 * List + mutate all agents. Plain deletion removes the agent only; sessions are
 * preserved as orphaned history unless a caller explicitly requests session deletion.
 *
 * @param options.enabled - Skip the list query when the caller has nothing to render
 *   for it (mutations stay usable). Defaults to `true`.
 */
export const useAgents = (options: { enabled?: boolean } = {}) => {
  const { t } = useTranslation()
  const enabled = options.enabled ?? true
  const { data, isLoading, error, refetch } = useQuery('/agents', {
    enabled,
    query: { limit: AGENTS_MAX_LIMIT }
  })
  useDataChange(enabled ? '/agents' : [], () => void refetch())
  const agents = useMemo<AgentEntity[]>(() => (data?.items ?? []) as unknown as AgentEntity[], [data])
  const invalidate = useInvalidateCache()

  const addAgent = useCallback(
    async (form: AddAgentForm): Promise<Result<AgentEntity>> => {
      try {
        const result = await createAgentAndRefresh(form as unknown as CreateAgentCommand, () => invalidate('/agents'))
        toast.success(t('common.add_success'))
        return { success: true, data: result }
      } catch (error) {
        const msg = formatErrorMessageWithPrefix(error, t('agent.add.error.failed'))
        toast.error(msg)
        return { success: false, error: error instanceof Error ? error : new Error(msg) }
      }
    },
    [invalidate, t]
  )

  const deleteAgent = useCallback(
    async (id: string) => {
      try {
        await deleteAgentAndRefresh(id, invalidate)
        toast.success(t('common.delete_success'))
      } catch (error) {
        toast.error(formatErrorMessageWithPrefix(error, t('agent.delete.error.failed')))
      }
    },
    [invalidate, t]
  )

  return { agents, error, isLoading, addAgent, deleteAgent, refetch }
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
          toast.success({ key: 'update-agent', title: t('common.update_success') })
        }

        return {
          ...(result as unknown as AgentEntity),
          configuration: parseAgentConfiguration(result.configuration, { entityId: result.id, entityType: 'agent' })
        }
      } catch (error) {
        toast.error(formatErrorMessageWithPrefix(error, t('agent.update.error.failed')))
        return undefined
      }
    },
    [updateTrigger, t]
  )

  const updateModel = useCallback(
    async ({ agentId, modelId, reasoningEffort }: UpdateAgentModelInput, options?: UpdateAgentBaseOptions) => {
      return updateAgent(
        {
          id: agentId,
          model: modelId,
          ...(reasoningEffort === undefined ? {} : { configuration: { reasoning_effort: reasoningEffort } })
        },
        options
      )
    },
    [updateAgent]
  )

  return { updateAgent, updateModel }
}
