import { application } from '@application'
import type { FileProcessingTask, FileProcessingTaskId } from '@main/features/fileProcessing'

interface FileProcessingWait {
  baseId: string
  taskId: FileProcessingTaskId
  /** Last percentage written to the item, so an unchanged value is not broadcast again. */
  mirroredProgress?: number
}

function fileProcessingProgressCacheKey(itemId: string): `knowledge.item.file_processing_progress.${string}` {
  return `knowledge.item.file_processing_progress.${itemId}`
}

/**
 * The knowledge items waiting on their file-processing task, keyed by item id. Entries live in
 * memory only, like the task's `done` that ends each wait: after a restart, boot recovery fails
 * the items that were still waiting.
 */
export class FileProcessingWaitManager {
  private readonly waits = new Map<string, FileProcessingWait>()

  add(baseId: string, itemId: string, taskId: FileProcessingTaskId): void {
    this.waits.set(itemId, { baseId, taskId })
  }

  has(itemId: string): boolean {
    return this.waits.has(itemId)
  }

  /** End an item's wait and clear the percentage mirrored onto it. */
  delete(itemId: string): void {
    const wait = this.waits.get(itemId)
    if (!wait) {
      return
    }
    this.waits.delete(itemId)
    if (wait.mirroredProgress !== undefined) {
      application.get('CacheService').deleteShared(fileProcessingProgressCacheKey(itemId))
    }
  }

  /** The file-processing tasks that items of `baseId` wait on, limited to `itemIds` when given. */
  taskIds(baseId: string, itemIds?: ReadonlySet<string>): FileProcessingTaskId[] {
    const taskIds: FileProcessingTaskId[] = []
    for (const [itemId, wait] of this.waits) {
      if (wait.baseId === baseId && (!itemIds || itemIds.has(itemId))) {
        taskIds.push(wait.taskId)
      }
    }
    return taskIds
  }

  /** Copy a processing task's progress onto the item waiting on it, writing only values that changed. */
  mirrorProgress(task: FileProcessingTask): void {
    if (task.status !== 'processing') {
      return
    }
    for (const [itemId, wait] of this.waits) {
      if (wait.taskId !== task.id || wait.mirroredProgress === task.progress) {
        continue
      }
      application.get('CacheService').setShared(fileProcessingProgressCacheKey(itemId), task.progress)
      wait.mirroredProgress = task.progress
    }
  }
}
