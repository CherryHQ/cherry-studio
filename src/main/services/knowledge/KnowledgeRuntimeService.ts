import { knowledgeBaseService } from '@data/services/KnowledgeBaseService'
import { knowledgeItemService } from '@data/services/KnowledgeItemService'
import { loggerService } from '@logger'
import { application } from '@main/core/application'
import { BaseService, DependsOn, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import type { KnowledgeBase, KnowledgeItem, KnowledgeSearchResult } from '@shared/data/types/knowledge'
import { IpcChannel } from '@shared/IpcChannel'
import type { BaseVectorStore } from '@vectorstores/core'
import { MetadataMode } from '@vectorstores/core'
import { embedMany } from 'ai'
import PQueue from 'p-queue'

import { loadKnowledgeItemDocuments } from './readers/KnowledgeReader'
import { rerankKnowledgeSearchResults } from './rerank/rerank'
import { chunkDocuments } from './utils/chunk'
import { expandDirectoryToCreateItems } from './utils/directory'
import { embedDocuments } from './utils/embed'
import { getEmbedModel } from './utils/model'
import { expandSitemapToCreateItems } from './utils/sitemap'
import { runAbortable, type RuntimeTaskContext, SHUTDOWN_INTERRUPTED_REASON } from './utils/taskRuntime'

const logger = loggerService.withContext('KnowledgeRuntimeService')
const CONTAINER_ITEM_INDEXING_UNSUPPORTED_REASON =
  'Container knowledge items must be expanded into child items before indexing'

@Injectable('KnowledgeRuntimeService')
@ServicePhase(Phase.WhenReady)
@DependsOn(['DbService', 'KnowledgeVectorStoreService'])
export class KnowledgeRuntimeService extends BaseService {
  private queue: PQueue
  private isStopping = false
  private queuedItemIds = new Set<string>()
  private runningItemIds = new Set<string>()
  private taskControllers = new Map<string, AbortController>()
  private taskPromises = new Map<string, Promise<void>>()

  constructor() {
    super()
    this.queue = new PQueue({ concurrency: 5 })
  }

  protected onInit(): void {
    this.isStopping = false
    this.taskControllers.clear()
    this.taskPromises.clear()
    this.registerIpcHandlers()
  }

  protected async onStop(): Promise<void> {
    this.isStopping = true
    this.queue.pause()

    const queuedItemIds = [...this.queuedItemIds]
    const runningItemIds = [...this.runningItemIds]
    const runningPromises = runningItemIds
      .map((itemId) => this.taskPromises.get(itemId))
      .filter((promise): promise is Promise<void> => promise !== undefined)

    for (const itemId of runningItemIds) {
      this.taskControllers.get(itemId)?.abort()
    }

    this.queue.clear()
    this.queuedItemIds.clear()

    await this.failItems(queuedItemIds, SHUTDOWN_INTERRUPTED_REASON)
    await Promise.allSettled(runningPromises)
  }

  async createBase(base: KnowledgeBase) {
    const vectorStoreService = application.get('KnowledgeVectorStoreService')
    await vectorStoreService.createStore(base)
  }

  async deleteBase(base: KnowledgeBase) {
    const vectorStoreService = application.get('KnowledgeVectorStoreService')
    await vectorStoreService.deleteStore(base)
  }

  async addItems(base: KnowledgeBase, items: KnowledgeItem[]) {
    await Promise.all(
      items.map((item) =>
        knowledgeItemService.update(item.id, {
          status: 'pending',
          error: null
        })
      )
    )

    return await Promise.all(items.map((item) => this.enqueueTask(item.id, (ctx) => this._addItem(base, item, ctx))))
  }

  async deleteItems(base: KnowledgeBase, items: KnowledgeItem[]) {
    return await Promise.all(items.map((item) => this.enqueueTask(item.id, (ctx) => this._deleteItem(base, item, ctx))))
  }

  async search(base: KnowledgeBase, query: string): Promise<KnowledgeSearchResult[]> {
    const model = getEmbedModel(base)
    const embedResult = await embedMany({ model, values: [query] })
    const vectorStoreService = application.get('KnowledgeVectorStoreService')
    const vectorStore = await vectorStoreService.createStore(base)
    const results = await vectorStore.query({
      queryStr: query,
      queryEmbedding: embedResult.embeddings[0],
      mode: base.searchMode ?? 'default',
      similarityTopK: base.documentCount ?? 10,
      alpha: base.hybridAlpha
    })
    const nodes = results.nodes ?? []
    const searchResults = nodes.map((node, index) => ({
      pageContent: node.getContent(MetadataMode.NONE),
      score: results.similarities[index] ?? 0,
      metadata: node.metadata ?? {},
      itemId:
        typeof node.metadata?.itemId === 'string' && node.metadata.itemId.length > 0 ? node.metadata.itemId : undefined,
      chunkId: node.id_
    }))

    logger.info('Knowledge search completed', {
      baseId: base.id,
      query,
      resultCount: searchResults.length
    })

    return await rerankKnowledgeSearchResults(base, query, searchResults)
  }

  private async _addItem(base: KnowledgeBase, item: KnowledgeItem, ctx: RuntimeTaskContext) {
    let vectorStore: BaseVectorStore | null = null

    try {
      const nodes = await this.indexItem(ctx, base, item)
      const vectorStoreService = application.get('KnowledgeVectorStoreService')
      vectorStore = await runAbortable(this.isStopping, ctx, () => vectorStoreService.createStore(base))
      const activeVectorStore = vectorStore
      await runAbortable(this.isStopping, ctx, () => activeVectorStore.add(nodes))
      await runAbortable(this.isStopping, ctx, () =>
        knowledgeItemService.update(item.id, {
          status: 'completed',
          error: null
        })
      )
    } catch (error) {
      throw await this.handleAddItemFailure(base, item, vectorStore, error)
    }
  }

  private async indexItem(ctx: RuntimeTaskContext, base: KnowledgeBase, item: KnowledgeItem) {
    if (item.type === 'directory' || item.type === 'sitemap') {
      throw new Error(CONTAINER_ITEM_INDEXING_UNSUPPORTED_REASON)
    }

    // todo file processing
    const documents = await runAbortable(this.isStopping, ctx, () => loadKnowledgeItemDocuments(item))
    const chunks = await runAbortable(this.isStopping, ctx, () => chunkDocuments(base, item, documents))
    const embeddingModel = await runAbortable(this.isStopping, ctx, () => getEmbedModel(base))
    return await runAbortable(this.isStopping, ctx, () => embedDocuments(embeddingModel, chunks))
  }

  private async handleAddItemFailure(
    base: KnowledgeBase,
    item: KnowledgeItem,
    vectorStore: BaseVectorStore | null,
    error: unknown
  ): Promise<Error> {
    const normalizedError = error instanceof Error ? error : new Error(String(error))

    logger.error('Failed to add knowledge item', normalizedError, {
      baseId: base.id,
      itemId: item.id,
      itemType: item.type
    })

    await knowledgeItemService.update(item.id, {
      status: 'failed',
      error: normalizedError.message
    })
    await this.cleanupFailedItemVectors(base.id, item.id, vectorStore)

    return normalizedError
  }

  private async cleanupFailedItemVectors(
    baseId: string,
    itemId: string,
    vectorStore: BaseVectorStore | null
  ): Promise<void> {
    if (!vectorStore) {
      return
    }

    try {
      await vectorStore.delete(itemId)
    } catch (cleanupError) {
      logger.warn('Failed to cleanup knowledge item vectors after add failure', {
        baseId,
        itemId,
        cleanupError: cleanupError instanceof Error ? cleanupError.message : String(cleanupError)
      })
    }
  }

  private async _deleteItem(base: KnowledgeBase, item: KnowledgeItem, ctx: RuntimeTaskContext) {
    const vectorStoreService = application.get('KnowledgeVectorStoreService')
    const vectorStore = await runAbortable(this.isStopping, ctx, () => vectorStoreService.createStore(base))
    await runAbortable(this.isStopping, ctx, () => vectorStore.delete(item.id))
  }

  private async enqueueTask(itemId: string, task: (ctx: RuntimeTaskContext) => Promise<void>): Promise<void> {
    const controller = new AbortController()
    this.queuedItemIds.add(itemId)

    const queuedPromise = this.queue.add(
      async () => {
        this.queuedItemIds.delete(itemId)
        this.runningItemIds.add(itemId)
        this.taskControllers.set(itemId, controller)

        const runningPromise = (async () => {
          try {
            await task({ itemId, signal: controller.signal })
          } finally {
            this.runningItemIds.delete(itemId)
            this.taskControllers.delete(itemId)
            this.taskPromises.delete(itemId)
          }
        })()

        this.taskPromises.set(itemId, runningPromise)
        return await runningPromise
      },
      { throwOnTimeout: true }
    )

    await queuedPromise
  }

  private registerIpcHandlers(): void {
    this.ipcHandle(IpcChannel.KnowledgeRuntime_CreateBase, async (_, payload: { baseId: string }) => {
      const base = await this.loadBase(payload.baseId)
      return await this.createBase(base)
    })
    this.ipcHandle(IpcChannel.KnowledgeRuntime_DeleteBase, async (_, payload: { baseId: string }) => {
      const base = await this.loadBase(payload.baseId)
      return await this.deleteBase(base)
    })
    this.ipcHandle(IpcChannel.KnowledgeRuntime_ExpandDirectory, async (_, payload: { path: string }) => {
      return await expandDirectoryToCreateItems(payload.path)
    })
    this.ipcHandle(IpcChannel.KnowledgeRuntime_ExpandSitemap, async (_, payload: { url: string }) => {
      return await expandSitemapToCreateItems(payload.url)
    })
    this.ipcHandle(IpcChannel.KnowledgeRuntime_AddItems, async (_, payload: { baseId: string; itemIds: string[] }) => {
      const { base, items } = await this.loadBaseAndItems(payload.baseId, payload.itemIds)
      return await this.addItems(base, items)
    })
    this.ipcHandle(
      IpcChannel.KnowledgeRuntime_DeleteItems,
      async (_, payload: { baseId: string; itemIds: string[] }) => {
        const { base, items } = await this.loadBaseAndItems(payload.baseId, payload.itemIds)
        return await this.deleteItems(base, items)
      }
    )
    this.ipcHandle(IpcChannel.KnowledgeRuntime_Search, async (_, payload: { baseId: string; query: string }) => {
      const base = await this.loadBase(payload.baseId)
      return await this.search(base, payload.query)
    })
  }

  private async loadBase(baseId: string): Promise<KnowledgeBase> {
    return await knowledgeBaseService.getById(baseId)
  }

  private async loadItems(itemIds: string[]): Promise<KnowledgeItem[]> {
    return await Promise.all(itemIds.map((itemId) => knowledgeItemService.getById(itemId)))
  }

  private async loadBaseAndItems(
    baseId: string,
    itemIds: string[]
  ): Promise<{ base: KnowledgeBase; items: KnowledgeItem[] }> {
    const [base, items] = await Promise.all([this.loadBase(baseId), this.loadItems(itemIds)])
    return { base, items }
  }

  private async failItems(itemIds: string[], reason: string): Promise<void> {
    if (itemIds.length === 0) {
      return
    }

    const uniqueItemIds = [...new Set(itemIds)]
    const results = await Promise.allSettled(
      uniqueItemIds.map((itemId) =>
        knowledgeItemService.update(itemId, {
          status: 'failed',
          error: reason
        })
      )
    )

    for (const [index, result] of results.entries()) {
      if (result.status === 'fulfilled') {
        continue
      }

      logger.error(
        'Failed to persist interrupted knowledge item state',
        result.reason instanceof Error ? result.reason : new Error(String(result.reason)),
        {
          itemId: uniqueItemIds[index],
          reason
        }
      )
    }
  }
}
