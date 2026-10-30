import { application } from '@application'
import { JOB_PROGRESS_KEY_PREFIX } from '@main/core/job/types'
import type { CacheKnowledgeItemFileProcessingState } from '@shared/data/cache/cacheValueTypes'
import type { FileProcessingStage } from '@shared/data/types/fileProcessing'

interface FileProcessingWait {
  baseId: string
  jobId: string
  startedWaitingAt: number
  publishedState?: CacheKnowledgeItemFileProcessingState
}

function fileProcessingStateCacheKey(itemId: string): `knowledge.item.file_processing_state.${string}` {
  return `knowledge.item.file_processing_state.${itemId}`
}

/**
 * The knowledge items waiting on their file-processing job, keyed by item id. Entries live in
 * memory only, like the `JobHandle.finished` that ends each wait: after a restart, boot recovery
 * fails the items that were still waiting.
 */
export class FileProcessingWaitManager {
  private readonly waits = new Map<string, FileProcessingWait>()

  add(baseId: string, itemId: string, jobId: string): void {
    this.delete(itemId)
    this.waits.set(itemId, { baseId, jobId, startedWaitingAt: Date.now() })
  }

  has(itemId: string): boolean {
    return this.waits.has(itemId)
  }

  /** End an item's wait and clear its published state. */
  delete(itemId: string): void {
    const wait = this.waits.get(itemId)
    if (!wait) {
      return
    }
    if (wait.publishedState !== undefined) {
      application.get('CacheService').deleteShared(fileProcessingStateCacheKey(itemId))
    }
    this.waits.delete(itemId)
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
      const source = cacheService.getShared(`${JOB_PROGRESS_KEY_PREFIX}${wait.jobId}`)
      const detail = source?.detail
      const stage = detail && typeof detail === 'object' && 'stage' in detail ? detail.stage : null
      const state: CacheKnowledgeItemFileProcessingState = {
        stage: isFileProcessingStage(stage) ? stage : null,
        progress: typeof source?.progress === 'number' ? source.progress : null,
        elapsedMs: Math.max(0, Date.now() - wait.startedWaitingAt)
      }
      const previous = wait.publishedState
      if (
        previous?.stage === state.stage &&
        previous.progress === state.progress &&
        previous.elapsedMs === state.elapsedMs
      ) {
        continue
      }
      cacheService.setShared(fileProcessingStateCacheKey(itemId), state)
      wait.publishedState = state
    }
  }
}

function isFileProcessingStage(value: unknown): value is FileProcessingStage {
  return value === 'uploading' || value === 'queued' || value === 'parsing' || value === 'converting'
}
