import type { CacheActiveFileProcessingTasks } from '@shared/data/cache/cacheValueTypes'
import type {
  FileProcessingMarkdownTaskResult,
  FileProcessingMarkdownTaskStartResult
} from '@shared/data/types/fileProcessing'
import { Mutex } from 'async-mutex'

const fileProcessingStatusCacheMutex = new Mutex()

export interface FileProcessingStatusCache {
  getShared(key: 'file_processing.active_tasks'): CacheActiveFileProcessingTasks | undefined
  setShared(key: 'file_processing.active_tasks', value: CacheActiveFileProcessingTasks): void
}

export function buildActiveTaskCacheKey(processorId: string, providerTaskId: string): string {
  return `${processorId}:${providerTaskId}`
}

export async function syncActiveFileProcessingTask(
  cache: FileProcessingStatusCache,
  providerTaskId: string,
  result: FileProcessingMarkdownTaskResult | FileProcessingMarkdownTaskStartResult
): Promise<void> {
  await fileProcessingStatusCacheMutex.runExclusive(() => {
    const activeTasks = cache.getShared('file_processing.active_tasks') || {}
    const taskKey = buildActiveTaskCacheKey(result.processorId, providerTaskId)
    const nextActiveTasks = { ...activeTasks }

    if (result.status === 'pending' || result.status === 'processing') {
      nextActiveTasks[taskKey] = {
        status: result.status,
        progress: result.progress
      }
    } else {
      delete nextActiveTasks[taskKey]
    }

    cache.setShared('file_processing.active_tasks', nextActiveTasks)
  })
}
