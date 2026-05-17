import { useMutation, useQuery } from '@renderer/data/hooks/useDataApi'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import type { CreateTaskRequest, ScheduledTaskEntity, UpdateTaskRequest } from '@shared/data/types/agent'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'

export const useTasks = (agentId: string | null) => {
  const { data, error, isLoading } = useQuery('/agents/:agentId/tasks', {
    params: { agentId: agentId! },
    query: { limit: 200 },
    enabled: !!agentId,
    swrOptions: { keepPreviousData: false }
  })
  return {
    tasks: data?.items ?? [],
    total: data?.total ?? 0,
    error,
    isLoading
  }
}

export const useCreateTask = () => {
  const { t } = useTranslation()
  const { trigger: createTrigger } = useMutation('POST', '/agents/:agentId/tasks', {
    refresh: ({ args }) => [`/agents/${args?.params.agentId}/tasks` as never]
  })
  const createTask = useCallback(
    async (agentId: string, req: CreateTaskRequest): Promise<ScheduledTaskEntity | undefined> => {
      try {
        const result = await createTrigger({ params: { agentId }, body: req as never })
        window.toast.success({ key: 'create-task', title: t('common.create_success') })
        return result as unknown as ScheduledTaskEntity
      } catch (error) {
        window.toast.error(
          formatErrorMessageWithPrefix(error, t('agent.cherryClaw.tasks.error.createFailed', 'Failed to create task'))
        )
        return undefined
      }
    },
    [createTrigger, t]
  )
  return { createTask }
}

export const useUpdateTask = () => {
  const { t } = useTranslation()
  const { trigger: updateTrigger } = useMutation('PATCH', '/agents/:agentId/tasks/:taskId', {
    refresh: ({ args }) => [`/agents/${args?.params.agentId}/tasks` as never]
  })
  const updateTask = useCallback(
    async (agentId: string, taskId: string, updates: UpdateTaskRequest): Promise<ScheduledTaskEntity | undefined> => {
      try {
        const result = await updateTrigger({ params: { agentId, taskId }, body: updates as never })
        window.toast.success({ key: 'update-task', title: t('common.update_success') })
        return result as unknown as ScheduledTaskEntity
      } catch (error) {
        window.toast.error(
          formatErrorMessageWithPrefix(error, t('agent.cherryClaw.tasks.error.updateFailed', 'Failed to update task'))
        )
        return undefined
      }
    },
    [updateTrigger, t]
  )
  return { updateTask }
}

export const useRunTask = () => {
  const { t } = useTranslation()
  const runTask = useCallback(
    async (agentId: string, taskId: string): Promise<boolean> => {
      try {
        await window.api.agent.runTask(agentId, taskId)
        window.toast.success({ key: 'run-task', title: t('agent.cherryClaw.tasks.runTriggered') })
        return true
      } catch (error) {
        window.toast.error(
          formatErrorMessageWithPrefix(error, t('agent.cherryClaw.tasks.error.runFailed', 'Failed to run task'))
        )
        return false
      }
    },
    [t]
  )
  return { runTask }
}

export const useDeleteTask = () => {
  const { t } = useTranslation()
  const { trigger: deleteTrigger } = useMutation('DELETE', '/agents/:agentId/tasks/:taskId', {
    refresh: ({ args }) => [`/agents/${args?.params.agentId}/tasks` as never]
  })
  const deleteTask = useCallback(
    async (agentId: string, taskId: string): Promise<boolean> => {
      try {
        await deleteTrigger({ params: { agentId, taskId } })
        window.toast.success({ key: 'delete-task', title: t('common.delete_success') })
        return true
      } catch (error) {
        window.toast.error(
          formatErrorMessageWithPrefix(error, t('agent.cherryClaw.tasks.error.deleteFailed', 'Failed to delete task'))
        )
        return false
      }
    },
    [deleteTrigger, t]
  )
  return { deleteTask }
}

export const useTaskLogs = (agentId: string | null, taskId: string | null) => {
  const { data, error, isLoading } = useQuery('/agents/:agentId/tasks/:taskId/logs', {
    params: { agentId: agentId!, taskId: taskId! },
    query: { limit: 50 },
    enabled: !!(agentId && taskId),
    swrOptions: { keepPreviousData: false }
  })
  return {
    logs: data?.items ?? [],
    total: data?.total ?? 0,
    error,
    isLoading
  }
}
