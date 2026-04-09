import { knowledgeItemService } from '@data/services/KnowledgeItemService'
import { loggerService } from '@logger'
import { application } from '@main/core/application'
import type { KnowledgeBase, KnowledgeItem } from '@shared/data/types/knowledge'
import type { BaseVectorStore } from '@vectorstores/core'

import { loadKnowledgeItemDocuments } from '../readers/KnowledgeReader'
import { chunkDocuments } from '../utils/chunk'
import { embedDocuments } from '../utils/embed'
import { getEmbedModel } from '../utils/model'
import type { RunningAddEntry } from './addQueue'
import {
  DELETE_INTERRUPTED_REASON,
  runAbortable,
  type RuntimeTaskContext,
  SHUTDOWN_INTERRUPTED_REASON
} from './utils/taskRuntime'

const logger = loggerService.withContext('KnowledgeAddRuntime')
const CONTAINER_ITEM_INDEXING_UNSUPPORTED_REASON =
  'Container knowledge items must be expanded into child items before indexing'

export class KnowledgeAddRuntime {
  constructor(private readonly isStopping: () => boolean) {}

  async executeAdd(entry: RunningAddEntry): Promise<void> {
    const { base, item, controller } = entry
    const ctx: RuntimeTaskContext = {
      itemId: item.id,
      signal: controller.signal
    }
    let vectorStore: BaseVectorStore | null = null

    try {
      const nodes = await this.indexItem(ctx, base, item)
      const vectorStoreService = application.get('KnowledgeVectorStoreService')
      vectorStore = await runAbortable(this.isStopping(), ctx, () => vectorStoreService.createStore(base))
      const activeVectorStore = vectorStore
      await runAbortable(this.isStopping(), ctx, () => activeVectorStore.add(nodes))
      await runAbortable(this.isStopping(), ctx, () =>
        knowledgeItemService.update(item.id, {
          status: 'completed',
          error: null
        })
      )
      entry.resolve()
    } catch (error) {
      const normalizedError = error instanceof Error ? error : new Error(String(error))

      if (
        entry.interruptedBy ||
        normalizedError.message === DELETE_INTERRUPTED_REASON ||
        normalizedError.message === SHUTDOWN_INTERRUPTED_REASON
      ) {
        entry.reject(normalizedError)
        return
      }

      entry.reject(await this.handleAddItemFailure(base, item, vectorStore, normalizedError))
    }
  }

  private async indexItem(ctx: RuntimeTaskContext, base: KnowledgeBase, item: KnowledgeItem) {
    if (item.type === 'directory' || item.type === 'sitemap') {
      throw new Error(CONTAINER_ITEM_INDEXING_UNSUPPORTED_REASON)
    }

    const documents = await runAbortable(this.isStopping(), ctx, () => loadKnowledgeItemDocuments(item))
    const chunks = await runAbortable(this.isStopping(), ctx, () => chunkDocuments(base, item, documents))
    const embeddingModel = await runAbortable(this.isStopping(), ctx, () => getEmbedModel(base))
    return await runAbortable(this.isStopping(), ctx, () => embedDocuments(embeddingModel, chunks))
  }

  private async handleAddItemFailure(
    base: KnowledgeBase,
    item: KnowledgeItem,
    vectorStore: BaseVectorStore | null,
    error: Error
  ): Promise<Error> {
    logger.error('Failed to add knowledge item', error, {
      baseId: base.id,
      itemId: item.id,
      itemType: item.type
    })

    await knowledgeItemService.update(item.id, {
      status: 'failed',
      error: error.message
    })
    await this.cleanupFailedItemVectors(base.id, item.id, vectorStore)

    return error
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
}
