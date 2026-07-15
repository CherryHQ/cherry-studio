/**
 * DataApi-backed agent queries and mutations.
 *
 * `agent` is the canonical reusable blueprint — sessions are pure instances of
 * it. Config (model / instructions / mcps / disabledTools /
 * configuration) lives here, not on sessions.
 */

import type { DataApiRefreshTarget } from '@renderer/data/hooks/useDataApi'
import { useMutation, useQuery } from '@renderer/data/hooks/useDataApi'
import { toast } from '@renderer/services/toast'
import type { AddAgentForm, UpdateAgentBaseOptions, UpdateAgentForm, UpdateAgentFunction } from '@renderer/types/agent'
import { parseAgentConfiguration } from '@renderer/utils/agent/utils'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import type { Tool } from '@shared/ai/tool'
import type { AgentEntity, CreateAgentDto, UpdateAgentDto } from '@shared/data/api/schemas/agents'
import { AGENTS_MAX_LIMIT } from '@shared/data/api/schemas/agents'
import type { UniqueModelId } from '@shared/data/types/model'
import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { useAgentTools } from './useAgentTools'

type Result<T> = { success: true; data: T } | { success: false; error: Error }

/**
 * Agent deletion cascades into sessions (list order + stats), pins,
 * workspaces and channel bindings. Single owner of that refresh contract —
 * do not declare `DELETE /agents/:agentId` with a hand-rolled `refresh`
 * list elsewhere.
 */
const AGENT_DELETE_REFRESH: DataApiRefreshTarget[] = [
  '/agents',
  { path: '/agent-sessions', strategy: 'reset-cursor' },
  '/agent-sessions/stats',
  '/agent-workspaces',
  '/pins',
  '/agent-channels'
]

/** Raw agent-delete trigger; UX (confirm / toast / tab fixup) stays with the caller. */
export const useDeleteAgent = () => {
  const { trigger } = useMutation('DELETE', '/agents/:agentId', { refresh: AGENT_DELETE_REFRESH })
  return trigger
}

export type AgentWithTools = AgentEntity & { tools: Tool[] }

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
  const { tools } = useAgentTools(data)

  const agent = useMemo((): AgentWithTools | undefined => {
    if (!data) return undefined
    return {
      ...data,
      tools: tools ?? [],
      configuration: parseAgentConfiguration(data.configuration, { entityId: data.id, entityType: 'agent' })
    }
  }, [data, tools])

  const revalidate = useCallback(async () => {
    await refetch()
  }, [refetch])

  return { agent, error, isLoading, revalidate }
}

/**
 * List + mutate all agents. Plain deletion removes the agent only; sessions are
 * preserved as orphaned history unless a caller explicitly requests session deletion.
 */
export const useAgents = () => {
  const { t } = useTranslation()
  const { data, isLoading, error, refetch } = useQuery('/agents', { query: { limit: AGENTS_MAX_LIMIT } })
  const agents = useMemo<AgentEntity[]>(() => (data?.items ?? []) as unknown as AgentEntity[], [data])

  const { trigger: createTrigger } = useMutation('POST', '/agents', { refresh: ['/agents'] })
  const addAgent = useCallback(
    async (form: AddAgentForm): Promise<Result<AgentEntity>> => {
      try {
        const result = await createTrigger({ body: form as unknown as CreateAgentDto })
        toast.success(t('common.add_success'))
        return { success: true, data: result as unknown as AgentEntity }
      } catch (error) {
        const msg = formatErrorMessageWithPrefix(error, t('agent.add.error.failed'))
        toast.error(msg)
        return { success: false, error: error instanceof Error ? error : new Error(msg) }
      }
    },
    [createTrigger, t]
  )

  const deleteTrigger = useDeleteAgent()
  const deleteAgent = useCallback(
    async (id: string) => {
      try {
        await deleteTrigger({ params: { agentId: id } })
        toast.success(t('common.delete_success'))
      } catch (error) {
        toast.error(formatErrorMessageWithPrefix(error, t('agent.delete.error.failed')))
      }
    },
    [deleteTrigger, t]
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
    refresh: ({ args }) => [
      '/agents',
      `/agents/${args?.params?.agentId}`,
      ...(args?.body?.name !== undefined ? ([{ path: '/agent-sessions', strategy: 'reset-cursor' }] as const) : [])
    ]
  })

  const updateAgent: UpdateAgentFunction = useCallback(
    async (form: UpdateAgentForm, options?: UpdateAgentBaseOptions): Promise<AgentEntity | undefined> => {
      try {
        const { id, ...patch } = form
        const result = await updateTrigger({ params: { agentId: id }, body: patch as unknown as UpdateAgentDto })
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
    async (agentId: string, modelId: UniqueModelId, options?: UpdateAgentBaseOptions) => {
      void updateAgent({ id: agentId, model: modelId }, options)
    },
    [updateAgent]
  )

  return { updateAgent, updateModel }
}
