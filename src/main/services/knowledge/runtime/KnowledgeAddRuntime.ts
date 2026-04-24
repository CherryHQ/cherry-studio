import { application } from '@application'
import { knowledgeItemService } from '@data/services/KnowledgeItemService'
import { loggerService } from '@logger'
import type { KnowledgeBase, KnowledgeItem, KnowledgeItemStatus } from '@shared/data/types/knowledge'
import type { BaseVectorStore } from '@vectorstores/core'

import { loadKnowledgeItemDocuments } from '../readers/KnowledgeReader'
import { chunkDocuments } from '../utils/chunk'
import { embedDocuments } from '../utils/embed'
import { getEmbedModel } from '../utils/model'
import type { AddTaskContext } from './KnowledgeAddQueue'
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

  async executeAdd(entry: AddTaskContext): Promise<void> {
    const { base, item, controller } = entry
    const ctx: RuntimeTaskContext = {
      itemId: item.id,
      signal: controller.signal
    }
    let vectorStore: BaseVectorStore | null = null

    try {
      const nodes = await this.indexItem(ctx, base, item)
      const vectorStoreService = application.get('KnowledgeVectorStoreService')
      vectorStore = await runAbortable(this.isStopping, ctx, () => vectorStoreService.createStore(base))
      const activeVectorStore = vectorStore
      await runAbortable(this.isStopping, ctx, () => activeVectorStore.add(nodes))
      await runAbortable(this.isStopping, ctx, () => this.updateItemStatus(item, 'completed'))
    } catch (error) {
      const normalizedError = error instanceof Error ? error : new Error(String(error))

      if (
        entry.interruptedBy ||
        normalizedError.message === DELETE_INTERRUPTED_REASON ||
        normalizedError.message === SHUTDOWN_INTERRUPTED_REASON
      ) {
        throw normalizedError
      }

      throw await this.handleAddItemFailure(base, item, vectorStore, normalizedError)
    }
  }

  private async indexItem(ctx: RuntimeTaskContext, base: KnowledgeBase, item: KnowledgeItem) {
    if (item.type === 'directory' || item.type === 'sitemap') {
      throw new Error(CONTAINER_ITEM_INDEXING_UNSUPPORTED_REASON)
    }

    const embeddingModel = getEmbedModel(base)
    // TODO: File Processing
    if (base.fileProcessorId) {
      await this.updateItemStatus(item, 'file_processing')
    }
    await this.updateItemStatus(item, 'read')
    const documents = await runAbortable(this.isStopping, ctx, () => loadKnowledgeItemDocuments(item, ctx.signal))
    const chunks = await runAbortable(this.isStopping, ctx, () => chunkDocuments(base, item, documents))
    await this.updateItemStatus(item, 'embed')
    return await runAbortable(this.isStopping, ctx, () => embedDocuments(embeddingModel, chunks, ctx.signal))
  }

  private async updateItemStatus(item: KnowledgeItem, status: KnowledgeItemStatus, error: string | null = null) {
    await knowledgeItemService.update(item.id, {
      status,
      error
    })
    if (item.groupId) {
      await knowledgeItemService.refreshContainerStatuses([item.groupId])
    }
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

    try {
      await this.updateItemStatus(item, 'failed', error.message)
    } catch (persistError) {
      logger.error(
        'Failed to persist knowledge item failure state',
        persistError instanceof Error ? persistError : new Error(String(persistError)),
        {
          baseId: base.id,
          itemId: item.id,
          itemType: item.type,
          originalError: error.message
        }
      )
    }

    if (vectorStore) {
      try {
        await vectorStore.delete(item.id)
      } catch (cleanupError) {
        logger.warn('Failed to cleanup knowledge item vectors after add failure', {
          baseId: base.id,
          itemId: item.id,
          cleanupError: cleanupError instanceof Error ? cleanupError.message : String(cleanupError)
        })
      }
    }

    return error
  }
}
