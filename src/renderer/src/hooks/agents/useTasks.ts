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

export const useTasks = (agentId: string | null) => {
  const client = useAgentClient()
  const { apiServerRunning } = useApiServer()

  const key = apiServerRunning && agentId ? client.getTaskPaths(agentId).base : null

  const fetcher = useCallback(async () => {
    if (!agentId) throw new Error('Agent ID required')
    return client.listTasks(agentId, { limit: 100 })
  }, [client, agentId])

  const { data, error, isLoading } = useSWR<ListTasksResponse>(key, fetcher)

  return {
    tasks: data?.data ?? [],
    total: data?.total ?? 0,
    error,
    isLoading
  }
}

export const useCreateTask = (agentId: string) => {
  const { t } = useTranslation()
  const client = useAgentClient()
  const listKey = client.getTaskPaths(agentId).base

  const createTask = useCallback(
    async (req: CreateTaskRequest): Promise<ScheduledTaskEntity | undefined> => {
      try {
        const result = await client.createTask(agentId, req)
        mutate(listKey)
        window.toast.success({ key: 'create-task', title: t('common.create_success') })
        return result
      } catch (error) {
        window.toast.error(
          formatErrorMessageWithPrefix(error, t('agent.cherryClaw.tasks.error.createFailed', 'Failed to create task'))
        )
        return undefined
      }
    },
    [agentId, client, listKey, t]
  )

  return { createTask }
}

export const useUpdateTask = (agentId: string) => {
  const { t } = useTranslation()
  const client = useAgentClient()
  const listKey = client.getTaskPaths(agentId).base

  const updateTask = useCallback(
    async (taskId: string, updates: UpdateTaskRequest): Promise<ScheduledTaskEntity | undefined> => {
      try {
        const result = await client.updateTask(agentId, taskId, updates)
        mutate(listKey)
        window.toast.success({ key: 'update-task', title: t('common.update_success') })
        return result
      } catch (error) {
        window.toast.error(
          formatErrorMessageWithPrefix(error, t('agent.cherryClaw.tasks.error.updateFailed', 'Failed to update task'))
        )
        return undefined
      }
    },
    [agentId, client, listKey, t]
  )

  return { updateTask }
}

export const useRunTask = (agentId: string) => {
  const { t } = useTranslation()
  const client = useAgentClient()
  const listKey = client.getTaskPaths(agentId).base

  const runTask = useCallback(
    async (taskId: string): Promise<boolean> => {
      try {
        await client.runTask(agentId, taskId)
        mutate(listKey)
        window.toast.success({ key: 'run-task', title: t('agent.cherryClaw.tasks.runTriggered') })
        return true
      } catch (error) {
        window.toast.error(
          formatErrorMessageWithPrefix(error, t('agent.cherryClaw.tasks.error.runFailed', 'Failed to run task'))
        )
        return false
      }
    },
    [agentId, client, listKey, t]
  )

  return { runTask }
}

export const useDeleteTask = (agentId: string) => {
  const { t } = useTranslation()
  const client = useAgentClient()
  const listKey = client.getTaskPaths(agentId).base

  const deleteTask = useCallback(
    async (taskId: string): Promise<boolean> => {
      try {
        await client.deleteTask(agentId, taskId)
        mutate(listKey)
        window.toast.success({ key: 'delete-task', title: t('common.delete_success') })
        return true
      } catch (error) {
        window.toast.error(
          formatErrorMessageWithPrefix(error, t('agent.cherryClaw.tasks.error.deleteFailed', 'Failed to delete task'))
        )
        return false
      }
    },
    [agentId, client, listKey, t]
  )

  return { deleteTask }
}

export const useTaskLogs = (agentId: string | null, taskId: string | null) => {
  const client = useAgentClient()
  const { apiServerRunning } = useApiServer()

  const key = apiServerRunning && agentId && taskId ? client.getTaskPaths(agentId).logs(taskId) : null

  const fetcher = useCallback(async () => {
    if (!agentId || !taskId) throw new Error('Agent ID and Task ID required')
    return client.getTaskLogs(agentId, taskId, { limit: 50 })
  }, [client, agentId, taskId])

  const { data, error, isLoading } = useSWR<ListTaskLogsResponse>(key, fetcher)

  return {
    logs: data?.data ?? [],
    total: data?.total ?? 0,
    error,
    isLoading
  }
}
