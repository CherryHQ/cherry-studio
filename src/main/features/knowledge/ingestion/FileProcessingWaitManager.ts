import { application } from '@application'
import { JOB_PROGRESS_KEY_PREFIX } from '@main/core/job/types'

interface FileProcessingWait {
  baseId: string
  jobId: string
  /** Last percentage written to the item, so an unchanged value is not broadcast again. */
  mirroredProgress?: number
}

function fileProcessingProgressCacheKey(itemId: string): `knowledge.item.file_processing_progress.${string}` {
  return `knowledge.item.file_processing_progress.${itemId}`
}

/**
 * The knowledge items waiting on their file-processing job, keyed by item id. Entries live in
 * memory only, like the `JobHandle.finished` that ends each wait: after a restart, boot recovery
 * fails the items that were still waiting.
 */
export class FileProcessingWaitManager {
  private readonly waits = new Map<string, FileProcessingWait>()

  add(baseId: string, itemId: string, jobId: string): void {
    this.waits.set(itemId, { baseId, jobId })
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

  /** The file-processing jobs that items of `baseId` wait on, limited to `itemIds` when given. */
  jobIds(baseId: string, itemIds?: ReadonlySet<string>): string[] {
    const jobIds: string[] = []
    for (const [itemId, wait] of this.waits) {
      if (wait.baseId === baseId && (!itemIds || itemIds.has(itemId))) {
        jobIds.push(wait.jobId)
      }
    }
    return jobIds
  }

  /** Copy each job's latest progress onto its item, writing only values that changed. */
  mirrorProgress(): void {
    const cacheService = application.get('CacheService')
    for (const [itemId, wait] of this.waits) {
      const progress = cacheService.getShared(`${JOB_PROGRESS_KEY_PREFIX}${wait.jobId}`)?.progress
      if (progress === undefined || progress === wait.mirroredProgress) {
        continue
      }
      cacheService.setShared(fileProcessingProgressCacheKey(itemId), progress)
      wait.mirroredProgress = progress
    }
  }
}
