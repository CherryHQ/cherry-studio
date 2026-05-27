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
  type KnowledgeRuntimeAddItemInput,
  KnowledgeRuntimeAddItemInputSchema,
  type KnowledgeSearchResult,
  type RestoreKnowledgeBaseDto
} from '@shared/data/types/knowledge'
import { IpcChannel } from '@shared/IpcChannel'
import { MetadataMode } from '@vectorstores/core'
import { embedMany } from 'ai'

import { createDeleteSubtreeJobHandler } from './jobs/deleteSubtreeJobHandler'
import { createIndexDocumentsJobHandler } from './jobs/indexDocumentsJobHandler'
import { createPrepareRootJobHandler } from './jobs/prepareRootJobHandler'
import { createReindexSubtreeJobHandler } from './jobs/reindexSubtreeJobHandler'
import { KnowledgeMutationCoordinator } from './KnowledgeMutationCoordinator'
import { KnowledgeWorkflowCoordinator } from './KnowledgeWorkflowCoordinator'
import { rerankKnowledgeSearchResults } from './rerank/rerank'
import {
  KNOWLEDGE_ACTIVE_JOB_LIMIT,
  KNOWLEDGE_ACTIVE_JOB_STATUSES,
  knowledgeDeleteSubtreeIdempotencyKey,
  knowledgeQueueName
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
const DELETE_RECOVERY_RETRY_BASE_DELAY_MS = 30_000
const DELETE_RECOVERY_RETRY_MAX_DELAY_MS = 5 * 60_000
const CHUNK_DELETE_ACTIVE_STATUSES = new Set<KnowledgeItem['status']>([
  'preparing',
  'processing',
  'reading',
  'embedding'
])
const KNOWLEDGE_JOB_TYPES = new Set([
  'knowledge.prepare-root',
  'knowledge.index-documents',
  'knowledge.delete-subtree',
  'knowledge.reindex-subtree'
])

@Injectable('KnowledgeOrchestrationService')
@ServicePhase(Phase.WhenReady)
@DependsOn(['KnowledgeVectorStoreService', 'FileManager'])
export class KnowledgeOrchestrationService extends BaseService {
  private readonly mutationCoordinator = new KnowledgeMutationCoordinator()
  private readonly workflowCoordinator = new KnowledgeWorkflowCoordinator(this.mutationCoordinator)
  private deletingRecoveryActive = false
  private deletingRecoveryPending = false
  private deletingRecoveryScheduled = false

  protected onInit(): void {
    const jobManager = application.get('JobManager')
    jobManager.registerHandler(
      'knowledge.prepare-root',
      createPrepareRootJobHandler(this.mutationCoordinator, this.workflowCoordinator)
    )
    jobManager.registerHandler('knowledge.index-documents', createIndexDocumentsJobHandler(this.mutationCoordinator))
    jobManager.registerHandler('knowledge.delete-subtree', createDeleteSubtreeJobHandler(this.mutationCoordinator))
    jobManager.registerHandler(
      'knowledge.reindex-subtree',
      createReindexSubtreeJobHandler(this.mutationCoordinator, this.workflowCoordinator)
    )
    this.registerIpcHandlers()
  }

  protected async onAllReady(): Promise<void> {
    await this.recoverDeletingItemsWithRetry()
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

    await this.mutationCoordinator.withBaseMutationLock(baseId, async () => {
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

    const embeddingModelChanged = dto.embeddingModelId.trim() !== sourceBase.embeddingModelId
    const dimensionsChanged = dto.dimensions !== sourceBase.dimensions
    if (sourceBase.status !== 'failed' && !embeddingModelChanged && !dimensionsChanged) {
      throw DataApiErrorFactory.invalidOperation(
        'restoreBase',
        'Embedding model or dimensions must change when rebuilding a completed knowledge base'
      )
    }

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
      hybridAlpha: sourceBase.hybridAlpha
    }
    if (sourceBase.groupId) {
      createDto.groupId = sourceBase.groupId
    }

    const rootItems = await knowledgeItemService.getItemsByBaseId(sourceBase.id, { groupId: null })
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
      if (inputs.length > 0) {
        await this.addItems(restoredBase.id, inputs)
      }
    } catch (error) {
      try {
        await this.deleteBase(restoredBase.id)
      } catch (cleanupError) {
        logger.error(
          'Failed to delete restored knowledge base after item restoration failed',
          cleanupError instanceof Error ? cleanupError : new Error(String(cleanupError)),
          {
            sourceBaseId: sourceBase.id,
            restoredBaseId: restoredBase.id
          }
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
    await this.workflowCoordinator.addItems(baseId, items)
  }

  async deleteItems(baseId: string, itemIds: string[]): Promise<void> {
    const items = await this.getTopLevelItemsInBase(baseId, itemIds)
    if (items.length === 0) {
      return
    }

    try {
      await this.workflowCoordinator.deleteItems(
        baseId,
        items.map((item) => item.id)
      )
    } catch (error) {
      this.scheduleDeletingItemsRecovery()
      throw error
    }
  }

  async reindexItems(baseId: string, itemIds: string[]): Promise<void> {
    await this.assertBaseCanRunRuntimeOperation(baseId, 'reindexItems')
    const items = await this.getTopLevelItemsInBase(baseId, itemIds)
    if (items.length === 0) {
      return
    }

    await this.workflowCoordinator.reindexItems(
      baseId,
      items.map((item) => item.id)
    )
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
    await this.assertBaseCanRunRuntimeOperation(baseId, 'listItemChunks')
    await this.assertSubtreeCanRunChunkOperation(baseId, itemId, 'list chunks')

    const base = await knowledgeBaseService.getById(baseId)
    const leafItems = await knowledgeItemService.getSubtreeItems(baseId, [itemId], {
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
    await this.assertBaseCanRunRuntimeOperation(baseId, 'deleteItemChunk')

    await this.mutationCoordinator.withBaseMutationLock(baseId, async () => {
      await this.assertSubtreeCanRunChunkOperation(baseId, itemId, 'delete chunk', { rejectActive: true })

      const base = await knowledgeBaseService.getById(baseId)
      const vectorStoreService = application.get('KnowledgeVectorStoreService')
      const vectorStore = await vectorStoreService.createStore(base)

      await vectorStore.deleteByIdAndExternalId(chunkId, itemId)
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
      queue: knowledgeQueueName(baseId),
      status: [...KNOWLEDGE_ACTIVE_JOB_STATUSES],
      limit: KNOWLEDGE_ACTIVE_JOB_LIMIT
    })
    const jobsToCancel = activeJobs.filter((job) => KNOWLEDGE_JOB_TYPES.has(job.type))

    await Promise.all(jobsToCancel.map((job) => jobManager.cancel(job.id, 'delete-base')))
  }

  private async recoverDeletingItemsWithRetry(attempt = 1): Promise<void> {
    if (this.deletingRecoveryActive) {
      this.deletingRecoveryPending = true
      return
    }

    this.deletingRecoveryActive = true
    this.deletingRecoveryPending = false
    const recovered = await this.recoverDeletingItems()
    if (recovered) {
      this.deletingRecoveryActive = false
      if (this.deletingRecoveryPending) {
        this.scheduleDeletingItemsRecovery()
      }
      return
    }

    const delayMs = Math.min(DELETE_RECOVERY_RETRY_BASE_DELAY_MS * attempt, DELETE_RECOVERY_RETRY_MAX_DELAY_MS)
    const timer = setTimeout(() => {
      this.deletingRecoveryActive = false
      void this.recoverDeletingItemsWithRetry(attempt + 1)
    }, delayMs)
    timer.unref()
    this.registerDisposable(() => clearTimeout(timer))
  }

  private scheduleDeletingItemsRecovery(): void {
    if (this.deletingRecoveryActive) {
      this.deletingRecoveryPending = true
      return
    }
    if (this.deletingRecoveryScheduled) {
      return
    }

    this.deletingRecoveryScheduled = true
    const timer = setTimeout(() => {
      this.deletingRecoveryScheduled = false
      void this.recoverDeletingItemsWithRetry()
    }, 0)
    timer.unref()
    this.registerDisposable(() => clearTimeout(timer))
  }

  private async recoverDeletingItems(): Promise<boolean> {
    let deletingRootGroups: Awaited<ReturnType<typeof knowledgeItemService.getDeletingRootGroups>>
    try {
      deletingRootGroups = await knowledgeItemService.getDeletingRootGroups()
    } catch (error) {
      logger.error('Failed to scan deleting knowledge items for recovery', error as Error)
      return false
    }

    if (deletingRootGroups.length === 0) {
      return true
    }

    const jobManager = application.get('JobManager')
    let recovered = true
    for (const { baseId, rootItemIds } of deletingRootGroups) {
      for (let i = 0; i < rootItemIds.length; i += DELETE_RECOVERY_ROOT_CHUNK_SIZE) {
        const rootItemIdChunk = rootItemIds.slice(i, i + DELETE_RECOVERY_ROOT_CHUNK_SIZE)
        try {
          await jobManager.enqueue(
            'knowledge.delete-subtree',
            { baseId, rootItemIds: rootItemIdChunk },
            {
              idempotencyKey: knowledgeDeleteSubtreeIdempotencyKey(baseId, rootItemIdChunk),
              queue: knowledgeQueueName(baseId)
            }
          )
        } catch (error) {
          logger.error('Failed to enqueue recovered knowledge delete cleanup', error as Error, {
            baseId,
            rootItemIds: rootItemIdChunk
          })
          recovered = false
        }
      }
    }
    return recovered
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

  private async assertSubtreeCanRunChunkOperation(
    baseId: string,
    itemId: string,
    operation: 'list chunks' | 'delete chunk',
    options: { rejectActive?: boolean } = {}
  ): Promise<void> {
    const [rootItem] = await this.getRootItemsInBase(baseId, [itemId])

    if (rootItem.status === 'deleting') {
      throw DataApiErrorFactory.validation(
        { item: [`Knowledge item '${itemId}' is being deleted`] },
        `Cannot ${operation} for a deleting knowledge item`
      )
    }
    if (options.rejectActive && CHUNK_DELETE_ACTIVE_STATUSES.has(rootItem.status)) {
      throw DataApiErrorFactory.validation(
        { item: [`Knowledge item '${itemId}' is currently indexing`] },
        `Cannot ${operation} while knowledge item is indexing`
      )
    }

    const subtreeItems = await knowledgeItemService.getSubtreeItems(baseId, [itemId])
    if (subtreeItems.some((item) => item.status === 'deleting')) {
      throw DataApiErrorFactory.validation(
        { item: [`Knowledge item subtree '${itemId}' is being deleted`] },
        `Cannot ${operation} for a deleting knowledge item`
      )
    }
    if (options.rejectActive && subtreeItems.some((item) => CHUNK_DELETE_ACTIVE_STATUSES.has(item.status))) {
      throw DataApiErrorFactory.validation(
        { item: [`Knowledge item subtree '${itemId}' is currently indexing`] },
        `Cannot ${operation} while knowledge item is indexing`
      )
    }
  }

  private async getTopLevelItemsInBase(baseId: string, itemIds: string[]): Promise<KnowledgeItem[]> {
    const items = await this.getRootItemsInBase(baseId, itemIds)
    const selectedIds = new Set(items.map((item) => item.id))
    const descendantSelectedIds = new Set<string>()

    for (const item of items) {
      const descendants = await knowledgeItemService.getSubtreeItems(baseId, [item.id])
      for (const descendant of descendants) {
        if (selectedIds.has(descendant.id)) {
          descendantSelectedIds.add(descendant.id)
        }
      }
    }

    return items.filter((item) => !descendantSelectedIds.has(item.id))
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
