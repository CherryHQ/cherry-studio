import { application } from '@application'
import { knowledgeBaseService } from '@data/services/KnowledgeBaseService'
import { knowledgeItemService } from '@data/services/KnowledgeItemService'
import { loggerService } from '@logger'
import { DataApiErrorFactory } from '@shared/data/api'
import { KNOWLEDGE_BASES_MAX_LIMIT } from '@shared/data/api/schemas/knowledges'
import {
  type CreateKnowledgeBaseDto,
  type KnowledgeAddItemInput,
  KnowledgeAddItemInputSchema,
  type KnowledgeBase,
  type KnowledgeItem,
  type RestoreKnowledgeBaseDto,
  type RestoreKnowledgeBaseResult
} from '@shared/data/types/knowledge'

import type { KnowledgeIngestionService } from './ingestion/KnowledgeIngestionService'
import { classifyKnowledgeItemSource } from './items'
import type { KnowledgeLockManager } from './KnowledgeLockManager'
import { getKnowledgeBaseFilePath } from './pathStorage'
import { narrowKnowledgeJobInput } from './tasks/utils/jobInput'
import {
  KNOWLEDGE_ACTIVE_JOB_LIMIT,
  KNOWLEDGE_ACTIVE_JOB_STATUSES,
  KNOWLEDGE_JOB_TYPES,
  knowledgeQueueName,
  toKnowledgeBaseId
} from './types'

const logger = loggerService.withContext('Knowledge:BaseAdmin')
const KNOWLEDGE_JOB_TYPE_SET = new Set<string>(KNOWLEDGE_JOB_TYPES)

/** Knowledge base lifecycle: create (with rollback), delete, restore, and list — everything about the base row + its on-disk artifacts, not about items. */
export class KnowledgeBaseAdminService {
  constructor(
    private readonly knowledgeLockManager: KnowledgeLockManager,
    private readonly ingestionService: KnowledgeIngestionService
  ) {}

  async createBase(dto: CreateKnowledgeBaseDto): Promise<KnowledgeBase> {
    const base = knowledgeBaseService.create(dto)
    const vectorStoreService = application.get('KnowledgeVectorStoreService')

    try {
      await vectorStoreService.getIndexStore(base)
    } catch (error) {
      await this.rollbackFailedBaseCreation(base.id)
      throw error
    }

    return base
  }

  /**
   * Undo a half-created base after its index store failed to open: remove the
   * orphaned `.cherry/` directory `getIndexStore` left on disk and drop the DB
   * row. Both steps are best-effort and logged — a cleanup failure must never
   * mask the original open error the caller needs to see.
   */
  private async rollbackFailedBaseCreation(baseId: string): Promise<void> {
    const vectorStoreService = application.get('KnowledgeVectorStoreService')
    try {
      await vectorStoreService.deleteStore(baseId)
    } catch (cleanupError) {
      logger.warn('Failed to remove index store dir during createBase rollback', cleanupError as Error, { baseId })
    }
    try {
      knowledgeBaseService.delete(baseId)
    } catch (cleanupError) {
      logger.warn('Failed to delete knowledge base row during createBase rollback', cleanupError as Error, { baseId })
    }
  }

  async deleteBase(baseId: string): Promise<void> {
    await this.cancelAllJobsForBase(baseId)

    await this.knowledgeLockManager.withBaseMutationLock(baseId, async () => {
      try {
        const vectorStoreService = application.get('KnowledgeVectorStoreService')
        await vectorStoreService.deleteStore(baseId)
      } catch (error) {
        const normalizedError = error instanceof Error ? error : new Error(String(error))
        logger.error('Failed to delete knowledge base vector artifacts', normalizedError, { baseId })
        throw error
      }

      try {
        knowledgeBaseService.delete(baseId)
      } catch (error) {
        const normalizedError = error instanceof Error ? error : new Error(String(error))
        logger.error('Failed to delete knowledge base SQLite row after artifact cleanup', normalizedError, {
          baseId
        })
        throw DataApiErrorFactory.invalidOperation(
          'deleteBase',
          `Vector artifacts were deleted, but SQLite knowledge base cleanup failed: ${normalizedError.message}`
        )
      }
    })
  }

  async restoreBase(dto: RestoreKnowledgeBaseDto): Promise<RestoreKnowledgeBaseResult> {
    const sourceBase = knowledgeBaseService.getById(dto.sourceBaseId)

    const createDto: CreateKnowledgeBaseDto = {
      name: dto.name?.trim() ?? sourceBase.name,
      dimensions: dto.dimensions,
      embeddingModelId: dto.embeddingModelId,
      rerankModelId: sourceBase.rerankModelId,
      fileProcessorId: sourceBase.fileProcessorId,
      chunkSize: sourceBase.chunkSize,
      chunkOverlap: sourceBase.chunkOverlap,
      threshold: sourceBase.threshold,
      documentCount: sourceBase.documentCount,
      groupId: sourceBase.groupId ?? undefined
    }

    const rootItems = knowledgeItemService.getRootItemsByBaseId(sourceBase.id)

    // Partial restore: probe each root's source and skip the ones whose source is genuinely gone, so
    // a single missing source no longer aborts the entire restore. This is the common case for a
    // failed base — a v1-migrated directory child has a virtual path with no raw/ file, and a file
    // whose original was deleted has no material to copy; addItems would throw on the first such
    // item and roll back the whole batch. An 'unverifiable' source (transient/permission error) is
    // kept, not skipped — like reindex, we never drop a source we could not confirm is gone.
    const restorableRootItems: KnowledgeItem[] = []
    for (const item of rootItems) {
      if ((await classifyKnowledgeItemSource(sourceBase.id, item)) === 'missing') {
        logger.warn('Skipping knowledge item with a missing source during restore', {
          sourceBaseId: sourceBase.id,
          itemId: item.id,
          type: item.type
        })
        continue
      }
      restorableRootItems.push(item)
    }
    const skippedMissingSourceCount = rootItems.length - restorableRootItems.length
    if (skippedMissingSourceCount > 0) {
      logger.info('Restore skipped knowledge items whose source no longer exists', {
        sourceBaseId: sourceBase.id,
        skippedMissingSourceCount,
        restorableCount: restorableRootItems.length
      })
    }

    const inputs = restorableRootItems.map((item) => this.toRestoreRuntimeInput(sourceBase.id, item))
    const restoredBase = await this.createBase(createDto)
    try {
      await this.ingestionService.addItems(restoredBase.id, inputs)
    } catch (error) {
      try {
        await this.deleteBase(restoredBase.id)
      } catch (cleanupError) {
        const cleanupMessage = cleanupError instanceof Error ? cleanupError.message : String(cleanupError)
        logger.error(
          'Failed to delete restored knowledge base after item restoration failed',
          cleanupError instanceof Error ? cleanupError : new Error(cleanupMessage),
          {
            sourceBaseId: sourceBase.id,
            restoredBaseId: restoredBase.id
          }
        )
        throw DataApiErrorFactory.invalidOperation(
          'restoreBase',
          `Failed to restore knowledge items: ${
            error instanceof Error ? error.message : String(error)
          }. Restored knowledge base '${restoredBase.id}' could not be cleaned up automatically: ${cleanupMessage}. Please delete it manually.`
        )
      }
      throw DataApiErrorFactory.invalidOperation(
        'restoreBase',
        `Failed to restore knowledge items: ${error instanceof Error ? error.message : String(error)}`
      )
    }

    return { base: restoredBase, skippedMissingSourceCount }
  }

  listBases(): KnowledgeBase[] {
    const { items } = knowledgeBaseService.list({ page: 1, limit: KNOWLEDGE_BASES_MAX_LIMIT })
    return items
  }

  /** Whether the user has any knowledge base at all — a cheap count (not a full list) for tool-availability gating. */
  hasAnyBase(): boolean {
    const { total } = knowledgeBaseService.list({ page: 1, limit: 1 })
    return total > 0
  }

  private async cancelAllJobsForBase(baseId: string): Promise<void> {
    const jobManager = application.get('JobManager')
    const activeJobs = await jobManager.list({
      queue: knowledgeQueueName(toKnowledgeBaseId(baseId)),
      status: [...KNOWLEDGE_ACTIVE_JOB_STATUSES],
      limit: KNOWLEDGE_ACTIVE_JOB_LIMIT
    })
    const jobsToCancel = activeJobs.filter((job) => KNOWLEDGE_JOB_TYPE_SET.has(job.type))
    const linkedFileProcessingJobIds = activeJobs.flatMap((job) => {
      const narrowed = narrowKnowledgeJobInput(job)
      return narrowed?.type === 'knowledge.check-file-processing-result' ? [narrowed.input.fileProcessingJobId] : []
    })

    await Promise.all([
      ...jobsToCancel.map((job) => jobManager.cancel(job.id, 'delete-base')),
      ...linkedFileProcessingJobIds.map((jobId) => jobManager.cancel(jobId, 'delete-base'))
    ])
  }

  private toRestoreRuntimeInput(sourceBaseId: string, item: KnowledgeItem): KnowledgeAddItemInput {
    try {
      if (item.type === 'file') {
        return KnowledgeAddItemInputSchema.parse({
          type: 'file',
          data: {
            source: item.data.source,
            path: getKnowledgeBaseFilePath(sourceBaseId, item.data.relativePath),
            // Carry the processed artifact across so the new base indexes from it
            // instead of re-running the (slow, paid) file processor.
            ...(item.data.indexedRelativePath
              ? { indexedPath: getKnowledgeBaseFilePath(sourceBaseId, item.data.indexedRelativePath) }
              : {})
          }
        })
      }

      if (item.type === 'url') {
        return KnowledgeAddItemInputSchema.parse({
          type: 'url',
          data: {
            source: item.data.source,
            url: item.data.url,
            // Carry the captured snapshot across so the restored URL indexes offline
            // instead of re-fetching the live page (which may have changed or died).
            // If the source never captured one, omit it and let the first index capture.
            ...(item.data.relativePath
              ? { snapshotPath: getKnowledgeBaseFilePath(sourceBaseId, item.data.relativePath) }
              : {})
          }
        })
      }

      if (item.type === 'note') {
        return KnowledgeAddItemInputSchema.parse({
          type: 'note',
          // The snapshot relativePath is intentionally dropped: the content is the
          // source of truth and re-capturing it into the new base on first index is
          // free and deterministic, so there is no snapshot file to carry across.
          data: { source: item.data.source, content: item.data.content }
        })
      }

      return KnowledgeAddItemInputSchema.parse({
        type: item.type,
        data: item.data
      })
    } catch (error) {
      throw DataApiErrorFactory.invalidOperation(
        'restoreBase',
        `Cannot restore knowledge item '${item.id}' (${item.type}): ${
          error instanceof Error ? error.message : String(error)
        }`
      )
    }
  }
}
