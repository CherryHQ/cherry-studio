import type { TFunction } from 'i18next'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'

import { useDataChange, useInvalidateCache, usePaginatedQuery, useQuery } from '@renderer/data/hooks/useDataApi'
import { ipcApi } from '@renderer/ipc'
import { toast } from '@renderer/services/toast'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import type { ScheduledTaskEntity } from '@shared/data/types/agent'
import { aiErrorCodes } from '@shared/ipc/errors/ai'
import { IpcError } from '@shared/ipc/errors/IpcError'
import type { AgentTaskForm, AgentTaskPatch } from '@shared/ipc/schemas/ai'

/**
 * Task reads stay on DataApi (`useQuery` below); task commands go through the
 * IpcApi `ai.agent.task.*` routes (schedule mutations are mixed-effect and
 * must not ride DataApi — see api-design-guidelines.md). After a successful
 * command the DataApi read keys are invalidated explicitly since IpcApi has no
 * auto-refresh tie-in.
 */
const taskReadKeys = (agentId: string) => [
  '/agent-tasks',
  '/agent-tasks/*',
  `/agents/${agentId}/tasks`,
  `/agents/${agentId}/tasks/*`
]

export const TASKS_PAGE_LIMIT = 50

/** Trigger-validation failures carry a branchable code — map them to the form hint instead of the raw parser message. */
const taskCommandErrorMessage = (error: unknown, t: TFunction, fallbackPrefix: string): string => {
  if (error instanceof IpcError && error.code === aiErrorCodes.AI_AGENT_TASK_TRIGGER_INVALID) {
    return t('agent.tasks.error.triggerInvalid')
  }
  return formatErrorMessageWithPrefix(error, fallbackPrefix)
}

export const useTasks = (agentId: string | null) => {
  const { data, error, isLoading, refetch } = useQuery('/agents/:agentId/tasks', {
    params: { agentId: agentId! },
    query: { limit: 200 },
    enabled: !!agentId,
    swrOptions: { keepPreviousData: false }
  })
  useDataChange('/agents/:agentId/tasks', () => refetch())
  return {
    tasks: data?.items ?? [],
    total: data?.total ?? 0,
    error,
    isLoading
  }
}

/** All scheduled tasks across every agent — backs the settings overview page. */
export const useAllTasks = () => {
  const { items, total, page, error, isLoading, hasNext, hasPrev, nextPage, prevPage, refresh } = usePaginatedQuery(
    '/agent-tasks',
    {
      limit: TASKS_PAGE_LIMIT,
      swrOptions: { keepPreviousData: false }
    }
  )
  useDataChange('/agent-tasks', () => refresh())
  return {
    tasks: items,
    total,
    page,
    pageCount: Math.ceil(total / TASKS_PAGE_LIMIT),
    error,
    isLoading,
    hasNext,
    hasPrev,
    nextPage,
    prevPage,
    refetch: refresh
  }
}

export const useTask = (taskId: string | null) => {
  const { data, error, isLoading, refetch } = useQuery('/agent-tasks/:taskId', {
    params: { taskId: taskId! },
    enabled: !!taskId,
    swrOptions: { keepPreviousData: false }
  })
  useDataChange('/agent-tasks/:taskId', (effects) => {
    if (effects.some((effect) => !effect.entityIds || (taskId !== null && effect.entityIds.includes(taskId)))) {
      void refetch()
    }
  })
  return {
    task: data,
    error,
    isLoading
  }
}

export const useCreateTask = () => {
  const { t } = useTranslation()
  const invalidate = useInvalidateCache()
  const createTask = useCallback(
    async (agentId: string, form: AgentTaskForm): Promise<ScheduledTaskEntity | undefined> => {
      try {
        const task = await ipcApi.request('ai.agent.task.create', { agentId, ...form })
        toast.success({ key: 'create-task', title: t('common.create_success') })
        await invalidate(taskReadKeys(agentId))
        return task
      } catch (error) {
        toast.error(taskCommandErrorMessage(error, t, t('agent.tasks.error.createFailed', 'Failed to create task')))
        return undefined
      }
    },
    [invalidate, t]
  )
  return { createTask }
}

export const useUpdateTask = () => {
  const { t } = useTranslation()
  const invalidate = useInvalidateCache()
  const updateTask = useCallback(
    async (agentId: string, taskId: string, patch: AgentTaskPatch): Promise<ScheduledTaskEntity | undefined> => {
      try {
        const task = await ipcApi.request('ai.agent.task.update', { agentId, taskId, patch })
        toast.success({ key: 'update-task', title: t('common.update_success') })
        await invalidate(taskReadKeys(agentId))
        return task
      } catch (error) {
        toast.error(taskCommandErrorMessage(error, t, t('agent.tasks.error.updateFailed', 'Failed to update task')))
        return undefined
      }
    },
    [invalidate, t]
  )
  return { updateTask }
}

/** Pause / resume are dedicated idempotent commands (not an `enabled` PATCH field) — see ai.agent.task.* schemas. */
export const useSetTaskEnabled = () => {
  const { t } = useTranslation()
  const invalidate = useInvalidateCache()
  const setTaskEnabled = useCallback(
    async (agentId: string, taskId: string, enabled: boolean): Promise<ScheduledTaskEntity | undefined> => {
      try {
        const task = enabled
          ? await ipcApi.request('ai.agent.task.resume', { agentId, taskId })
          : await ipcApi.request('ai.agent.task.pause', { agentId, taskId })
        toast.success({ key: 'update-task', title: t('common.update_success') })
        await invalidate(taskReadKeys(agentId))
        return task
      } catch (error) {
        toast.error(formatErrorMessageWithPrefix(error, t('agent.tasks.error.updateFailed', 'Failed to update task')))
        return undefined
      }
    },
    [invalidate, t]
  )
  return { setTaskEnabled }
}

export const useRunTask = () => {
  const { t } = useTranslation()
  const invalidate = useInvalidateCache()
  const runTask = useCallback(
    async (agentId: string, taskId: string): Promise<boolean> => {
      try {
        await ipcApi.request('ai.agent.task.run', { agentId, taskId })
        toast.success({ key: 'run-task', title: t('agent.tasks.runTriggered') })
        // The triggered job row is persisted before the command resolves, so
        // the logs key (under `/tasks/*`) picks up the pending run right away.
        await invalidate(taskReadKeys(agentId))
        return true
      } catch (error) {
        toast.error(formatErrorMessageWithPrefix(error, t('agent.tasks.error.runFailed', 'Failed to run task')))
        return false
      }
    },
    [invalidate, t]
  )
  return { runTask }
}

export const useDeleteTask = () => {
  const { t } = useTranslation()
  const invalidate = useInvalidateCache()
  const deleteTask = useCallback(
    async (agentId: string, taskId: string): Promise<boolean> => {
      try {
        await ipcApi.request('ai.agent.task.delete', { agentId, taskId })
        toast.success({ key: 'delete-task', title: t('common.delete_success') })
        await invalidate(taskReadKeys(agentId))
        return true
      } catch (error) {
        toast.error(formatErrorMessageWithPrefix(error, t('agent.tasks.error.deleteFailed', 'Failed to delete task')))
        return false
      }
    },
    [invalidate, t]
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
