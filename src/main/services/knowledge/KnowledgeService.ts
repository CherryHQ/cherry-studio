import { knowledgeItemService } from '@data/services/KnowledgeItemService'
import { loggerService } from '@logger'
import { BaseService, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import type { KnowledgeBase, KnowledgeItem, KnowledgeSearchResult } from '@shared/data/types/knowledge'
import { MetadataMode } from '@vectorstores/core'
import { embedMany } from 'ai'
import PQueue from 'p-queue'

import { EmbeddingModelFactory } from './embedding/EmbeddingModelFactory'
import { loadKnowledgeItemDocuments } from './readers/KnowledgeReader'
import { chunkDocuments } from './utils/chunk'
import { embedDocuments } from './utils/embed'
import { vectorStoreManager } from './vectorstore/VectorStoreManager'

const logger = loggerService.withContext('KnowledgeService')
const SHUTDOWN_INTERRUPTED_REASON = 'Knowledge task interrupted by service shutdown'

@Injectable('KnowledgeService')
@ServicePhase(Phase.Background)
export class KnowledgeService extends BaseService {
  private queue: PQueue
  private isStopping = false
  private queuedItemIds = new Set<string>()
  private runningItemIds = new Set<string>()

  constructor() {
    super()
    this.queue = new PQueue({ concurrency: 5 })
  }

  protected onInit(): void {
    this.isStopping = false
  }

  protected async onStop(): Promise<void> {
    this.isStopping = true
    this.queue.pause()

    const interruptedItemIds = [...new Set([...this.queuedItemIds, ...this.runningItemIds])]

    this.queue.clear()
    this.queuedItemIds.clear()

    await this.failItems(interruptedItemIds, SHUTDOWN_INTERRUPTED_REASON)
    await vectorStoreManager.clear()
  }

  async createBase(base: KnowledgeBase) {
    await vectorStoreManager.createStore(base)
  }

  async deleteBase(base: KnowledgeBase) {
    await vectorStoreManager.deleStore(base)
  }

  async addItems(base: KnowledgeBase, items: KnowledgeItem[]) {
    return await Promise.all(items.map((item) => this.enqueueTask(item.id, () => this._addItem(base, item))))
  }

  async deleteItems(base: KnowledgeBase, items: KnowledgeItem[]) {
    return await Promise.all(items.map((item) => this.enqueueTask(item.id, () => this._deleteItem(base, item))))
  }

  async search(base: KnowledgeBase, query: string): Promise<KnowledgeSearchResult[]> {
    const model = EmbeddingModelFactory.create(base)
    const embedResult = await embedMany({ model, values: [query] })
    const vectorStore = await vectorStoreManager.createStore(base)
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
      chunkId: node.id_
    }))

    logger.info('Knowledge search completed', {
      baseId: base.id,
      query,
      resultCount: searchResults.length
    })

    // todo: rerank
    return searchResults
  }

  private async _addItem(base: KnowledgeBase, item: KnowledgeItem) {
    try {
      // todo file processing
      const documents = await loadKnowledgeItemDocuments(item)
      const chunks = chunkDocuments(base, item, documents)
      const embeddingModel = EmbeddingModelFactory.create(base)
      const nodes = await embedDocuments(embeddingModel, chunks)
      const vectorStore = await vectorStoreManager.createStore(base)
      await vectorStore.add(nodes)
      this.throwIfStopping()
      await knowledgeItemService.update(item.id, {
        status: 'completed',
        error: null
      })
    } catch (error) {
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

      throw normalizedError
    }
  }

  private async _deleteItem(base: KnowledgeBase, item: KnowledgeItem) {
    const vectorStore = await vectorStoreManager.createStore(base)
    await vectorStore.delete(item.id)
  }

  private async enqueueTask(itemId: string, task: () => Promise<void>): Promise<void> {
    this.queuedItemIds.add(itemId)

    await this.queue.add(
      async () => {
        this.queuedItemIds.delete(itemId)
        this.runningItemIds.add(itemId)

        try {
          this.throwIfStopping()
          await task()
        } finally {
          this.runningItemIds.delete(itemId)
        }
      },
      { throwOnTimeout: true }
    )
  }

  private throwIfStopping(): void {
    if (this.isStopping) {
      throw new Error(SHUTDOWN_INTERRUPTED_REASON)
    }
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
