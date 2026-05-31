import { application } from '@application'
import { knowledgeBaseService } from '@data/services/KnowledgeBaseService'
import { knowledgeItemService } from '@data/services/KnowledgeItemService'
import { loggerService } from '@logger'
import { BaseService, DependsOn, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { DataApiErrorFactory, ErrorCode, isDataApiError } from '@shared/data/api'
import {
  type CreateKnowledgeBaseDto,
  type KnowledgeBase,
  KnowledgeChunkMetadataSchema,
  type KnowledgeItem,
  type KnowledgeItemChunk,
  type KnowledgeItemStatus,
  type KnowledgeRuntimeAddItemInput,
  KnowledgeRuntimeAddItemInputSchema,
  type KnowledgeSearchResult,
  type RestoreKnowledgeBaseDto
} from '@shared/data/types/knowledge'
import { IpcChannel } from '@shared/IpcChannel'
import { MetadataMode } from '@vectorstores/core'
import { embedMany } from 'ai'

import { createCheckFileProcessingResultJobHandler } from './jobs/checkFileProcessingResultJobHandler'
import { createDeleteSubtreeJobHandler } from './jobs/deleteSubtreeJobHandler'
import { createIndexDocumentsJobHandler } from './jobs/indexDocumentsJobHandler'
import { createPrepareRootJobHandler } from './jobs/prepareRootJobHandler'
import { createReindexSubtreeJobHandler } from './jobs/reindexSubtreeJobHandler'
import { narrowKnowledgeJobInput } from './jobs/utils/jobInput'
import { KnowledgeLockManager } from './KnowledgeLockManager'
import { KnowledgeWorkflowService } from './KnowledgeWorkflowService'
import { rerankKnowledgeSearchResults } from './rerank/rerank'
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
  KnowledgeRuntimeAddItemsPayloadSchema,
  KnowledgeRuntimeBasePayloadSchema,
  KnowledgeRuntimeCreateBasePayloadSchema,
  KnowledgeRuntimeDeleteItemChunkPayloadSchema,
  KnowledgeRuntimeItemChunksPayloadSchema,
  KnowledgeRuntimeItemsPayloadSchema,
  KnowledgeRuntimeRestoreBasePayloadSchema,
  KnowledgeRuntimeSearchPayloadSchema
} from './types/ipc'
import { mapChunkDocument } from './utils/indexing/chunk'
import { getEmbedModel } from './utils/model/embedding'
import { applyRelevanceThreshold, getInitialSearchScoreKind, withSearchRanks } from './utils/search'

const logger = loggerService.withContext('KnowledgeOrchestrationService')
const SEARCH_TOKEN_PATTERN = /[\p{L}\p{N}_]+/u
const DELETE_RECOVERY_ROOT_CHUNK_SIZE = 500
const REINDEX_ALLOWED_STATUSES = new Set<KnowledgeItemStatus>(['completed', 'failed'])
const KNOWLEDGE_JOB_TYPE_SET = new Set<string>(KNOWLEDGE_JOB_TYPES)

@Injectable('KnowledgeOrchestrationService')
@ServicePhase(Phase.WhenReady)
@DependsOn(['KnowledgeVectorStoreService', 'FileManager', 'JobManager', 'FileProcessingOrchestrationService'])
export class KnowledgeOrchestrationService extends BaseService {
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
      await vectorStoreService.createStore(base)
    } catch (error) {
      await knowledgeBaseService.delete(base.id)
      throw error
    }

    return base
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
      emoji: sourceBase.emoji,
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
    const inputs = rootItems.map((item) => {
      try {
        return KnowledgeRuntimeAddItemInputSchema.parse({
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
    })

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

  async addItems(baseId: string, items: KnowledgeRuntimeAddItemInput[]): Promise<void> {
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

  async search(baseId: string, query: string): Promise<KnowledgeSearchResult[]> {
    await this.assertBaseCanRunRuntimeOperation(baseId, 'search')

    if (!SEARCH_TOKEN_PATTERN.test(query)) {
      throw DataApiErrorFactory.validation(
        { query: ['Query has no searchable tokens'] },
        'Query has no searchable tokens'
      )
    }

    const base = await knowledgeBaseService.getById(baseId)
    const embedResult = await embedMany({ model: getEmbedModel(base), values: [query] })
    const queryEmbedding = embedResult.embeddings[0]

    if (!queryEmbedding?.length) {
      throw new Error('Failed to embed search query: model returned empty result')
    }

    const vectorStoreService = application.get('KnowledgeVectorStoreService')
    const vectorStore = await vectorStoreService.createStore(base)
    const results = await vectorStore.query({
      queryStr: query,
      queryEmbedding,
      mode: base.searchMode ?? 'default',
      similarityTopK: base.documentCount ?? 10,
      alpha: base.hybridAlpha
    })
    const nodes = results.nodes ?? []
    const scoreKind = getInitialSearchScoreKind(base)
    const searchResults = nodes.map((node, index) => {
      const metadata = KnowledgeChunkMetadataSchema.parse(node.metadata ?? {})

      return {
        pageContent: node.getContent(MetadataMode.NONE),
        score: results.similarities[index] ?? 0,
        scoreKind,
        rank: index + 1,
        metadata,
        itemId: metadata.itemId,
        chunkId: node.id_
      }
    })

    const visibleSearchResults = await this.filterVisibleSearchResults(baseId, searchResults)

    if (base.rerankModelId) {
      const rerankedResults = await rerankKnowledgeSearchResults(base, query, visibleSearchResults)
      return withSearchRanks(applyRelevanceThreshold(rerankedResults, base.threshold))
    }

    return withSearchRanks(applyRelevanceThreshold(visibleSearchResults, base.threshold))
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
    const vectorStore = await vectorStoreService.createStore(base)
    const chunkGroups = await Promise.all(leafItems.map((item) => vectorStore.listByExternalId(item.id)))

    return chunkGroups.flat().map(mapChunkDocument)
  }

  async deleteItemChunk(baseId: string, itemId: string, chunkId: string): Promise<void> {
    const knowledgeBaseId = toKnowledgeBaseId(baseId)
    const knowledgeItemId = toKnowledgeItemId(itemId)
    await this.assertBaseCanRunRuntimeOperation(knowledgeBaseId, 'deleteItemChunk')

    await this.knowledgeLockManager.withBaseMutationLock(knowledgeBaseId, async () => {
      await this.assertItemCanRunChunkOperation(knowledgeBaseId, knowledgeItemId, 'delete chunk')

      const base = await knowledgeBaseService.getById(knowledgeBaseId)
      const vectorStoreService = application.get('KnowledgeVectorStoreService')
      const vectorStore = await vectorStoreService.createStore(base)

      await vectorStore.deleteByIdAndExternalId(chunkId, knowledgeItemId)
    })
  }

  private async filterVisibleSearchResults(
    baseId: string,
    searchResults: KnowledgeSearchResult[]
  ): Promise<KnowledgeSearchResult[]> {
    const uniqueItemIds = [...new Set(searchResults.map((result) => result.itemId).filter((id): id is string => !!id))]
    const visibleItemIds = new Set<string>()

    await Promise.all(
      uniqueItemIds.map(async (itemId) => {
        try {
          const item = await knowledgeItemService.getById(itemId)
          if (item.baseId === baseId && item.status !== 'deleting') {
            visibleItemIds.add(itemId)
          }
        } catch (error) {
          if (isDataApiError(error) && error.code === ErrorCode.NOT_FOUND) {
            return
          }
          throw error
        }
      })
    )

    return searchResults.filter((result) => result.itemId && visibleItemIds.has(result.itemId))
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
    if (item.type !== 'directory' && item.type !== 'sitemap') {
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

  private registerIpcHandlers(): void {
    this.ipcHandle(IpcChannel.KnowledgeRuntime_CreateBase, async (_, payload: unknown) => {
      const { base } = KnowledgeRuntimeCreateBasePayloadSchema.parse(payload)
      return await this.createBase(base)
    })
    this.ipcHandle(IpcChannel.KnowledgeRuntime_RestoreBase, async (_, payload: unknown) => {
      const dto = KnowledgeRuntimeRestoreBasePayloadSchema.parse(payload)
      return await this.restoreBase(dto)
    })
    this.ipcHandle(IpcChannel.KnowledgeRuntime_DeleteBase, async (_, payload: unknown) => {
      const { baseId } = KnowledgeRuntimeBasePayloadSchema.parse(payload)
      return await this.deleteBase(baseId)
    })
    this.ipcHandle(IpcChannel.KnowledgeRuntime_AddItems, async (_, payload: unknown) => {
      const { baseId, items } = KnowledgeRuntimeAddItemsPayloadSchema.parse(payload)
      return await this.addItems(baseId, items)
    })
    this.ipcHandle(IpcChannel.KnowledgeRuntime_DeleteItems, async (_, payload: unknown) => {
      const { baseId, itemIds } = KnowledgeRuntimeItemsPayloadSchema.parse(payload)
      return await this.deleteItems(baseId, itemIds)
    })
    this.ipcHandle(IpcChannel.KnowledgeRuntime_ReindexItems, async (_, payload: unknown) => {
      const { baseId, itemIds } = KnowledgeRuntimeItemsPayloadSchema.parse(payload)
      return await this.reindexItems(baseId, itemIds)
    })
    this.ipcHandle(IpcChannel.KnowledgeRuntime_Search, async (_, payload: unknown) => {
      const { baseId, query } = KnowledgeRuntimeSearchPayloadSchema.parse(payload)
      return await this.search(baseId, query)
    })
    this.ipcHandle(IpcChannel.KnowledgeRuntime_ListItemChunks, async (_, payload: unknown) => {
      const { baseId, itemId } = KnowledgeRuntimeItemChunksPayloadSchema.parse(payload)
      return await this.listItemChunks(baseId, itemId)
    })
    this.ipcHandle(IpcChannel.KnowledgeRuntime_DeleteItemChunk, async (_, payload: unknown) => {
      const { baseId, itemId, chunkId } = KnowledgeRuntimeDeleteItemChunkPayloadSchema.parse(payload)
      return await this.deleteItemChunk(baseId, itemId, chunkId)
    })
  }
}
