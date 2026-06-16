import { application } from '@application'
import { knowledgeBaseService } from '@data/services/KnowledgeBaseService'
import { knowledgeItemService } from '@data/services/KnowledgeItemService'
import { loggerService } from '@logger'
import { BaseService, DependsOn, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { TraceMethod } from '@mcp-trace/trace-core'
import { DataApiErrorFactory, ErrorCode, isDataApiError } from '@shared/data/api'
import { KNOWLEDGE_BASES_MAX_LIMIT } from '@shared/data/api/schemas/knowledges'
import {
  type CreateKnowledgeBaseDto,
  type KnowledgeAddItemInput,
  KnowledgeAddItemInputSchema,
  type KnowledgeBase,
  type KnowledgeItem,
  type KnowledgeItemChunk,
  type KnowledgeItemStatus,
  type KnowledgeSearchResult,
  type RestoreKnowledgeBaseDto
} from '@shared/data/types/knowledge'
import { IpcChannel } from '@shared/IpcChannel'
import { estimateTokenCount } from 'tokenx'

import { createCheckFileProcessingResultJobHandler } from './jobs/checkFileProcessingResultJobHandler'
import { createDeleteSubtreeJobHandler } from './jobs/deleteSubtreeJobHandler'
import { createIndexDocumentsJobHandler } from './jobs/indexDocumentsJobHandler'
import { createPrepareRootJobHandler } from './jobs/prepareRootJobHandler'
import { createReindexSubtreeJobHandler } from './jobs/reindexSubtreeJobHandler'
import { narrowKnowledgeJobInput } from './jobs/utils/jobInput'
import { KnowledgeLockManager } from './KnowledgeLockManager'
import { KnowledgeWorkflowService } from './KnowledgeWorkflowService'
import {
  KNOWLEDGE_ACTIVE_JOB_LIMIT,
  KNOWLEDGE_ACTIVE_JOB_STATUSES,
  KNOWLEDGE_JOB_TYPES,
  knowledgeDeleteSubtreeIdempotencyKey,
  knowledgeQueueName,
  toKnowledgeBaseId,
  toKnowledgeItemId,
  toKnowledgeItemIds
} from './types'
import {
  KnowledgeAddItemsPayloadSchema,
  KnowledgeBasePayloadSchema,
  KnowledgeCreateBasePayloadSchema,
  KnowledgeItemChunksPayloadSchema,
  KnowledgeItemsPayloadSchema,
  KnowledgeRestoreBasePayloadSchema,
  KnowledgeSearchPayloadSchema
} from './types/ipc'
import { embedKnowledgeQuery } from './utils/indexing/embed'
import { rerankKnowledgeSearchResults } from './utils/indexing/rerank'
import { applyRelevanceThreshold, getInitialSearchScoreKind, withSearchRanks } from './utils/search'
import { getKnowledgeBaseFilePath } from './utils/storage/pathStorage'
import type { KnowledgeIndexStore } from './vectorstore/indexStore/KnowledgeIndexStore'
import type { KnowledgeIndexSearchMatch } from './vectorstore/indexStore/model'

const logger = loggerService.withContext('KnowledgeService')
const SEARCH_TOKEN_PATTERN = /[\p{L}\p{N}_]+/u
const DELETE_RECOVERY_ROOT_CHUNK_SIZE = 500
/**
 * Fetch this many × the requested result count as index candidates. The index
 * store only filters by material state; the item-visibility filter (missing /
 * other-base / not-completed) runs afterwards in the caller and can drop matches,
 * so over-fetching keeps the final set from shrinking below topK.
 */
const KNOWLEDGE_SEARCH_OVERFETCH_FACTOR = 5
/** Hard ceiling on fetched candidates, bounding the brute-force vector scan and rerank cost regardless of topK. */
const KNOWLEDGE_SEARCH_CANDIDATE_CAP = 200
const REINDEX_ALLOWED_STATUSES = new Set<KnowledgeItemStatus>(['completed', 'failed'])
const KNOWLEDGE_JOB_TYPE_SET = new Set<string>(KNOWLEDGE_JOB_TYPES)

@Injectable('KnowledgeService')
@ServicePhase(Phase.WhenReady)
@DependsOn(['KnowledgeVectorStoreService', 'JobManager', 'FileProcessingService'])
export class KnowledgeService extends BaseService {
  private readonly knowledgeLockManager = new KnowledgeLockManager()
  private readonly workflowService = new KnowledgeWorkflowService(this.knowledgeLockManager)

  protected onInit(): void {
    const jobManager = application.get('JobManager')
    jobManager.registerHandler(
      'knowledge.prepare-root',
      createPrepareRootJobHandler(this.knowledgeLockManager, this.workflowService)
    )
    jobManager.registerHandler('knowledge.index-documents', createIndexDocumentsJobHandler(this.knowledgeLockManager))
    jobManager.registerHandler(
      'knowledge.check-file-processing-result',
      createCheckFileProcessingResultJobHandler(this.knowledgeLockManager, this.workflowService)
    )
    jobManager.registerHandler('knowledge.delete-subtree', createDeleteSubtreeJobHandler(this.knowledgeLockManager))
    jobManager.registerHandler(
      'knowledge.reindex-subtree',
      createReindexSubtreeJobHandler(this.knowledgeLockManager, this.workflowService)
    )
    this.registerIpcHandlers()
  }

  protected async onAllReady(): Promise<void> {
    await this.recoverDeletingItems()
  }

  async createBase(dto: CreateKnowledgeBaseDto): Promise<KnowledgeBase> {
    const base = await knowledgeBaseService.create(dto)
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
      await knowledgeBaseService.delete(baseId)
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
        await knowledgeBaseService.delete(baseId)
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

  async restoreBase(dto: RestoreKnowledgeBaseDto): Promise<KnowledgeBase> {
    const sourceBase = await knowledgeBaseService.getById(dto.sourceBaseId)

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
      searchMode: sourceBase.searchMode,
      hybridAlpha: sourceBase.hybridAlpha,
      groupId: sourceBase.groupId ?? undefined
    }

    const rootItems = await knowledgeItemService.getRootItemsByBaseId(sourceBase.id)
    const inputs = rootItems.map((item) => this.toRestoreRuntimeInput(sourceBase.id, item))
    const restoredBase = await this.createBase(createDto)
    try {
      await this.addItems(restoredBase.id, inputs)
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

    return restoredBase
  }

  async addItems(baseId: string, items: KnowledgeAddItemInput[]): Promise<void> {
    await this.assertBaseCanRunRuntimeOperation(baseId, 'addItems')
    await this.workflowService.addItems(baseId, items)
  }

  async deleteItems(baseId: string, itemIds: string[]): Promise<void> {
    const rootItemIds = await knowledgeItemService.getOutermostSelectedItemIds(baseId, itemIds)
    if (rootItemIds.length === 0) {
      return
    }

    await this.workflowService.deleteItems(baseId, rootItemIds)
  }

  async reindexItems(baseId: string, itemIds: string[]): Promise<void> {
    await this.assertBaseCanRunRuntimeOperation(baseId, 'reindexItems')
    const rootItemIds = await knowledgeItemService.getOutermostSelectedItemIds(baseId, itemIds)
    if (rootItemIds.length === 0) {
      return
    }

    await this.assertSubtreesCanReindex(baseId, rootItemIds)

    await this.workflowService.reindexItems(baseId, rootItemIds)
  }

  async listBases(): Promise<KnowledgeBase[]> {
    const { items } = await knowledgeBaseService.list({ page: 1, limit: KNOWLEDGE_BASES_MAX_LIMIT })
    return items
  }

  async listRootItems(baseId: string): Promise<KnowledgeItem[]> {
    return await knowledgeItemService.getRootItemsByBaseId(baseId)
  }

  @TraceMethod({ spanName: 'Knowledge.search', tag: 'Knowledge' })
  async search(baseId: string, query: string): Promise<KnowledgeSearchResult[]> {
    await this.assertBaseCanRunRuntimeOperation(baseId, 'search')

    if (!SEARCH_TOKEN_PATTERN.test(query)) {
      throw DataApiErrorFactory.validation(
        { query: ['Query has no searchable tokens'] },
        'Query has no searchable tokens'
      )
    }

    const base = await knowledgeBaseService.getById(baseId)
    // Stored search mode and the index store's mode are the same enum now, so no mapping.
    const mode = base.searchMode
    // BM25 is lexical only; skip the embedding round-trip when the query won't use it.
    const queryEmbedding = mode === 'bm25' ? undefined : await embedKnowledgeQuery(base, query)

    const resolvedTopK = base.documentCount ?? 10
    const candidateLimit = Math.min(resolvedTopK * KNOWLEDGE_SEARCH_OVERFETCH_FACTOR, KNOWLEDGE_SEARCH_CANDIDATE_CAP)

    const vectorStoreService = application.get('KnowledgeVectorStoreService')
    const store = await vectorStoreService.getIndexStore(base)
    const matches = await this.runStoreOperation(store, baseId, 'search', () =>
      store.search({
        queryText: query,
        queryEmbedding,
        mode,
        topK: candidateLimit,
        alpha: base.hybridAlpha
      })
    )

    const scoreKind = getInitialSearchScoreKind(base)
    const visibleSearchResults = await this.toVisibleSearchResults(baseId, matches, scoreKind)
    const topResults = this.trimToTopK(visibleSearchResults, resolvedTopK, baseId)

    if (base.rerankModelId) {
      const rerankedResults = await rerankKnowledgeSearchResults(base, query, topResults)
      return withSearchRanks(applyRelevanceThreshold(rerankedResults, base.threshold))
    }

    return withSearchRanks(applyRelevanceThreshold(topResults, base.threshold))
  }

  async listItemChunks(baseId: string, itemId: string): Promise<KnowledgeItemChunk[]> {
    const knowledgeBaseId = toKnowledgeBaseId(baseId)
    const knowledgeItemId = toKnowledgeItemId(itemId)
    await this.assertBaseCanRunRuntimeOperation(knowledgeBaseId, 'listItemChunks')
    const item = await this.assertItemCanRunChunkOperation(knowledgeBaseId, knowledgeItemId, 'list chunks')
    await this.assertCompletedContainerHasNoDeletingChildren(knowledgeBaseId, item)

    const base = await knowledgeBaseService.getById(knowledgeBaseId)
    const leafItems = await knowledgeItemService.getSubtreeItems(knowledgeBaseId, [knowledgeItemId], {
      includeRoots: true,
      leafOnly: true
    })
    if (leafItems.length === 0) {
      return []
    }

    const vectorStoreService = application.get('KnowledgeVectorStoreService')
    const store = await vectorStoreService.getIndexStore(base)
    const chunkGroups = await this.runStoreOperation(store, knowledgeBaseId, 'listItemChunks', () =>
      Promise.all(
        leafItems.map(async (leafItem) => {
          const units = await store.listMaterialUnits(leafItem.id)
          return units.map(
            (unit): KnowledgeItemChunk => ({
              id: unit.unitId,
              itemId: leafItem.id,
              content: unit.text,
              metadata: {
                itemId: leafItem.id,
                itemType: leafItem.type,
                source: leafItem.data.source,
                chunkIndex: unit.unitIndex,
                tokenCount: estimateTokenCount(unit.text)
              }
            })
          )
        })
      )
    )

    return chunkGroups.flat()
  }

  /**
   * Turn raw index matches into visible search results: fetch each match's
   * knowledge item once, drop any that is missing, in another base, or not
   * completed, and reconstruct the chunk metadata (item type / source from the
   * item; chunk index from the unit; token count recomputed from the body).
   */
  private async toVisibleSearchResults(
    baseId: string,
    matches: KnowledgeIndexSearchMatch[],
    scoreKind: KnowledgeSearchResult['scoreKind']
  ): Promise<KnowledgeSearchResult[]> {
    const itemsById = await this.loadVisibleItems(
      baseId,
      matches.map((match) => match.materialId)
    )

    const results: KnowledgeSearchResult[] = []
    for (const match of matches) {
      const item = itemsById.get(match.materialId)
      if (!item) {
        continue
      }
      results.push({
        pageContent: match.text,
        score: match.score,
        scoreKind,
        rank: results.length + 1,
        metadata: {
          itemId: match.materialId,
          itemType: item.type,
          source: item.data.source,
          chunkIndex: match.unitIndex,
          tokenCount: estimateTokenCount(match.text)
        },
        itemId: match.materialId,
        chunkId: match.unitId
      })
    }
    return results
  }

  /** Keep the highest-scored `topK` visible results, discarding the over-fetched tail. */
  private trimToTopK(results: KnowledgeSearchResult[], topK: number, baseId: string): KnowledgeSearchResult[] {
    if (results.length <= topK) {
      return results
    }
    logger.debug('Trimmed over-fetched knowledge search results to topK', {
      baseId,
      visibleCandidates: results.length,
      topK
    })
    return results.slice(0, topK)
  }

  /** Fetch the distinct items behind the matches, keeping only those visible in this base (same base, completed). */
  private async loadVisibleItems(baseId: string, materialIds: string[]): Promise<Map<string, KnowledgeItem>> {
    const uniqueIds = [...new Set(materialIds)]
    const visibleItems = new Map<string, KnowledgeItem>()

    await Promise.all(
      uniqueIds.map(async (materialId) => {
        try {
          const item = await knowledgeItemService.getById(materialId)
          if (item.baseId === baseId && item.status === 'completed') {
            visibleItems.set(materialId, item)
          }
        } catch (error) {
          if (isDataApiError(error) && error.code === ErrorCode.NOT_FOUND) {
            return
          }
          throw error
        }
      })
    )

    return visibleItems
  }

  /**
   * Run a per-base index-store interaction, translating the error raised when the
   * store is closed mid-flight — a concurrent {@link deleteBase} or app shutdown
   * closed the driver — into a defined, retryable DataApiError instead of leaking
   * the opaque driver-level error to the renderer. Genuine query errors rethrow
   * unchanged.
   */
  private async runStoreOperation<T>(
    store: KnowledgeIndexStore,
    baseId: string,
    operation: string,
    run: () => Promise<T>
  ): Promise<T> {
    try {
      return await run()
    } catch (error) {
      if (store.isClosed()) {
        logger.warn('Knowledge index store was closed during operation', { baseId, operation })
        throw DataApiErrorFactory.invalidOperation(
          operation,
          `Knowledge base '${baseId}' index store was closed during ${operation}; retry the operation`
        )
      }
      throw error
    }
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

  private async recoverDeletingItems(): Promise<void> {
    let deletingRootGroups: Awaited<ReturnType<typeof knowledgeItemService.getDeletingRootGroups>>
    try {
      deletingRootGroups = await knowledgeItemService.getDeletingRootGroups()
    } catch (error) {
      logger.error('Failed to scan deleting knowledge items for recovery', error as Error)
      return
    }

    if (deletingRootGroups.length === 0) {
      return
    }

    const jobManager = application.get('JobManager')
    for (const { baseId, rootItemIds } of deletingRootGroups) {
      for (let i = 0; i < rootItemIds.length; i += DELETE_RECOVERY_ROOT_CHUNK_SIZE) {
        const rootItemIdChunk = rootItemIds.slice(i, i + DELETE_RECOVERY_ROOT_CHUNK_SIZE)
        try {
          await jobManager.enqueue(
            'knowledge.delete-subtree',
            { baseId, rootItemIds: rootItemIdChunk },
            {
              idempotencyKey: knowledgeDeleteSubtreeIdempotencyKey(
                toKnowledgeBaseId(baseId),
                toKnowledgeItemIds(rootItemIdChunk)
              ),
              queue: knowledgeQueueName(toKnowledgeBaseId(baseId))
            }
          )
        } catch (error) {
          logger.error('Failed to enqueue recovered knowledge delete cleanup', error as Error, {
            baseId,
            rootItemIds: rootItemIdChunk
          })
        }
      }
    }
  }

  private async assertBaseCanRunRuntimeOperation(baseId: string, operation: string): Promise<void> {
    const base = await knowledgeBaseService.getById(baseId)

    if (base.status !== 'failed') {
      return
    }

    throw DataApiErrorFactory.validation(
      {
        base: [`Knowledge base '${baseId}' is in failed state; restore it before ${operation}.`]
      },
      `Cannot ${operation} failed knowledge base`
    )
  }

  private async getRootItemsInBase(baseId: string, itemIds: string[]): Promise<KnowledgeItem[]> {
    const rootIds = [...new Set(itemIds)]
    const items = await Promise.all(rootIds.map((itemId) => knowledgeItemService.getById(itemId)))
    const invalidItem = items.find((item) => item.baseId !== baseId)

    if (invalidItem) {
      throw new Error(`Knowledge item '${invalidItem.id}' does not belong to base '${baseId}'`)
    }

    return items
  }

  private async assertItemCanRunChunkOperation(
    baseId: string,
    itemId: string,
    operation: 'list chunks' | 'delete chunk'
  ): Promise<KnowledgeItem> {
    const [item] = await this.getRootItemsInBase(baseId, [itemId])

    if (item.status !== 'completed') {
      throw DataApiErrorFactory.validation(
        { item: [`Knowledge item '${itemId}' must be completed before ${operation}`] },
        `Cannot ${operation} for a non-completed knowledge item`
      )
    }

    return item
  }

  private async assertCompletedContainerHasNoDeletingChildren(baseId: string, item: KnowledgeItem): Promise<void> {
    if (item.type !== 'directory') {
      return
    }

    const subtreeItems = await knowledgeItemService.getSubtreeItems(baseId, [item.id])
    if (subtreeItems.some((item) => item.status === 'deleting')) {
      throw DataApiErrorFactory.validation(
        { item: [`Knowledge item subtree '${item.id}' is being deleted`] },
        'Cannot list chunks for a deleting knowledge item'
      )
    }
  }

  private async assertSubtreesCanReindex(baseId: string, rootItemIds: string[]): Promise<void> {
    const blockingStatusCounts = new Map<KnowledgeItemStatus, number>()

    for (const rootItemId of rootItemIds) {
      const subtreeItems = await knowledgeItemService.getSubtreeItems(baseId, [rootItemId], { includeRoots: true })
      for (const item of subtreeItems) {
        if (REINDEX_ALLOWED_STATUSES.has(item.status)) {
          continue
        }

        blockingStatusCounts.set(item.status, (blockingStatusCounts.get(item.status) ?? 0) + 1)
      }
    }

    if (blockingStatusCounts.size === 0) {
      return
    }

    const statusSummary = [...blockingStatusCounts.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([status, count]) => `${status}=${count}`)
      .join(', ')

    throw DataApiErrorFactory.validation(
      {
        item: [`Knowledge item subtree is still running or being deleted: ${statusSummary}`]
      },
      'Cannot reindex knowledge item until the entire subtree is completed or failed'
    )
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

  private registerIpcHandlers(): void {
    this.ipcHandle(IpcChannel.Knowledge_CreateBase, async (_, payload: unknown) => {
      const { base } = KnowledgeCreateBasePayloadSchema.parse(payload)
      return await this.createBase(base)
    })
    this.ipcHandle(IpcChannel.Knowledge_RestoreBase, async (_, payload: unknown) => {
      const dto = KnowledgeRestoreBasePayloadSchema.parse(payload)
      return await this.restoreBase(dto)
    })
    this.ipcHandle(IpcChannel.Knowledge_DeleteBase, async (_, payload: unknown) => {
      const { baseId } = KnowledgeBasePayloadSchema.parse(payload)
      return await this.deleteBase(baseId)
    })
    this.ipcHandle(IpcChannel.Knowledge_AddItems, async (_, payload: unknown) => {
      const { baseId, items } = KnowledgeAddItemsPayloadSchema.parse(payload)
      return await this.addItems(baseId, items)
    })
    this.ipcHandle(IpcChannel.Knowledge_DeleteItems, async (_, payload: unknown) => {
      const { baseId, itemIds } = KnowledgeItemsPayloadSchema.parse(payload)
      return await this.deleteItems(baseId, itemIds)
    })
    this.ipcHandle(IpcChannel.Knowledge_ReindexItems, async (_, payload: unknown) => {
      const { baseId, itemIds } = KnowledgeItemsPayloadSchema.parse(payload)
      return await this.reindexItems(baseId, itemIds)
    })
    this.ipcHandle(IpcChannel.Knowledge_Search, async (_, payload: unknown) => {
      const { baseId, query } = KnowledgeSearchPayloadSchema.parse(payload)
      return await this.search(baseId, query)
    })
    this.ipcHandle(IpcChannel.Knowledge_ListItemChunks, async (_, payload: unknown) => {
      const { baseId, itemId } = KnowledgeItemChunksPayloadSchema.parse(payload)
      return await this.listItemChunks(baseId, itemId)
    })
  }
}
