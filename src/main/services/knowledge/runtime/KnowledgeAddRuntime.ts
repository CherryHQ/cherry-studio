import { application } from '@application'
import { knowledgeItemService } from '@data/services/KnowledgeItemService'
import { loggerService } from '@logger'
import type { KnowledgeBase, KnowledgeItem } from '@shared/data/types/knowledge'
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
      await runAbortable(this.isStopping, ctx, () =>
        knowledgeItemService.update(item.id, {
          status: 'pending',
          error: null
        })
      )

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
    const documents = await runAbortable(this.isStopping, ctx, () => loadKnowledgeItemDocuments(item, ctx.signal))
    const chunks = await runAbortable(this.isStopping, ctx, () => chunkDocuments(base, item, documents))
    return await runAbortable(this.isStopping, ctx, () => embedDocuments(embeddingModel, chunks, ctx.signal))
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
      await knowledgeItemService.update(item.id, {
        status: 'failed',
        error: error.message
      })
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
