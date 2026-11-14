import useSWR from 'swr'

import { useSharedCacheValue } from '@renderer/data/hooks/useCache'
import { ipcApi } from '@renderer/ipc'
import type { FileProcessingTask, FileProcessingTaskId } from '@shared/data/types/fileProcessing'

export interface UseFileProcessingTaskResult {
  /** Null when no such task exists, or while `isLoading`. */
  task: FileProcessingTask | null
  isSettled: boolean
  isLoading: boolean
  error: Error | undefined
}

/**
 * Follow a file-processing task in the renderer.
 *
 * Primary source: the shared cache key `file_processing.task.${taskId}`, which
 * main rewrites on every change. Fallback: `file_processing.get_task`, read
 * while that entry is empty — before it first syncs, or after a settled task's
 * entry expires.
 */
export function useFileProcessingTask(taskId: FileProcessingTaskId): UseFileProcessingTaskResult {
  const cachedTask = useSharedCacheValue(`file_processing.task.${taskId}` as const)
  const { data: fetchedTask, error } = useSWR(
    cachedTask == null ? (['file_processing.get_task', taskId] as const) : null,
    () => ipcApi.request('file_processing.get_task', { taskId })
  )

  const task = cachedTask ?? fetchedTask ?? null
  const isSettled = task !== null && task.status !== 'queued' && task.status !== 'processing'
  const isLoading = task === null && fetchedTask === undefined && error === undefined
  return { task, isSettled, isLoading, error }
}
