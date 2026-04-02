import type {
  CreateTaskRequest,
  ListTaskLogsResponse,
  ListTasksResponse,
  ScheduledTaskEntity,
  UpdateTaskRequest
} from '@renderer/types'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import useSWR, { mutate } from 'swr'

import { useApiServer } from '../useApiServer'
import { useAgentClient } from './useAgentClient'

const TASKS_LIST_KEY = '/v1/tasks'

export const useTasks = () => {
  const client = useAgentClient()
  const { apiServerRunning } = useApiServer()

  const key = apiServerRunning ? TASKS_LIST_KEY : null

  const fetcher = useCallback(async () => {
    return client.listTasks({ limit: 200 })
  }, [client])

  const { data, error, isLoading } = useSWR<ListTasksResponse>(key, fetcher)

  return {
    tasks: data?.data ?? [],
    total: data?.total ?? 0,
    error,
    isLoading
  }
}

export const useCreateTask = () => {
  const { t } = useTranslation()
  const client = useAgentClient()

  const createTask = useCallback(
    async (agentId: string, req: CreateTaskRequest): Promise<ScheduledTaskEntity | undefined> => {
      try {
        const result = await client.createTask(agentId, req)
        void mutate(TASKS_LIST_KEY)
        window.toast.success({ key: 'create-task', title: t('common.create_success') })
        return result
      } catch (error) {
        window.toast.error(
          formatErrorMessageWithPrefix(error, t('agent.cherryClaw.tasks.error.createFailed', 'Failed to create task'))
        )
        return undefined
      }
    },
    [client, t]
  )

  return { createTask }
}

export const useUpdateTask = () => {
  const { t } = useTranslation()
  const client = useAgentClient()

  const updateTask = useCallback(
    async (taskId: string, updates: UpdateTaskRequest): Promise<ScheduledTaskEntity | undefined> => {
      try {
        const result = await client.updateTask(taskId, updates)
        void mutate(TASKS_LIST_KEY)
        window.toast.success({ key: 'update-task', title: t('common.update_success') })
        return result
      } catch (error) {
        window.toast.error(
          formatErrorMessageWithPrefix(error, t('agent.cherryClaw.tasks.error.updateFailed', 'Failed to update task'))
        )
        return undefined
      }
    },
    [client, t]
  )

  return { updateTask }
}

export const useRunTask = () => {
  const { t } = useTranslation()
  const client = useAgentClient()

  const runTask = useCallback(
    async (taskId: string): Promise<boolean> => {
      try {
        await client.runTask(taskId)
        void mutate(TASKS_LIST_KEY)
        window.toast.success({ key: 'run-task', title: t('agent.cherryClaw.tasks.runTriggered') })
        return true
      } catch (error) {
        window.toast.error(
          formatErrorMessageWithPrefix(error, t('agent.cherryClaw.tasks.error.runFailed', 'Failed to run task'))
        )
        return false
      }
    },
    [client, t]
  )

  return { runTask }
}

export const useDeleteTask = () => {
  const { t } = useTranslation()
  const client = useAgentClient()

  const deleteTask = useCallback(
    async (taskId: string): Promise<boolean> => {
      try {
        await client.deleteTask(taskId)
        void mutate(TASKS_LIST_KEY)
        window.toast.success({ key: 'delete-task', title: t('common.delete_success') })
        return true
      } catch (error) {
        window.toast.error(
          formatErrorMessageWithPrefix(error, t('agent.cherryClaw.tasks.error.deleteFailed', 'Failed to delete task'))
        )
        return false
      }
    },
    [client, t]
  )

  return { deleteTask }
}

export const useTaskLogs = (taskId: string | null) => {
  const client = useAgentClient()
  const { apiServerRunning } = useApiServer()

  const key = apiServerRunning && taskId ? client.taskPaths.logs(taskId) : null

  const fetcher = useCallback(async () => {
    if (!taskId) throw new Error('Task ID required')
    return client.getTaskLogs(taskId, { limit: 50 })
  }, [client, taskId])

  const { data, error, isLoading } = useSWR<ListTaskLogsResponse>(key, fetcher)

  return {
    logs: data?.data ?? [],
    total: data?.total ?? 0,
    error,
    isLoading
  }
}
