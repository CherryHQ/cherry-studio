import { loggerService } from '@logger'
import { application } from '@main/core/application'
import { BaseService, DependsOn, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import type { KnowledgeBase, KnowledgeItem, KnowledgeSearchResult } from '@shared/data/types/knowledge'
import { IpcChannel } from '@shared/IpcChannel'

import type { EnqueueKnowledgeTaskInput } from './KnowledgeTaskService'
import { VectorStoreFactory } from './vectorstore/VectorStoreFactory'

const logger = loggerService.withContext('KnowledgeVectorService')

export type KnowledgeVectorSearchOptions = Record<string, unknown>

/**
 * Coordinates vector/runtime operations for already-persisted knowledge bases and items.
 *
 * Data CRUD remains in KnowledgeBaseService / KnowledgeItemService.
 */
@Injectable('KnowledgeVectorService')
@ServicePhase(Phase.Background)
@DependsOn(['KnowledgeTaskService'])
export class KnowledgeVectorService extends BaseService {
  protected onInit(): void {
    this.registerIpcHandlers()
  }

  public async createBase(base: KnowledgeBase): Promise<void> {
    // Minimal runtime initialization. Current vector store provider does not
    // require an eager collection creation step, but we still warm the runtime
    // boundary here so UI/main callers have a stable entrypoint.
    VectorStoreFactory.create(base)

    logger.info('Initialized knowledge base vector runtime', { baseId: base.id })
  }

  public async deleteBase(baseId: string): Promise<void> {
    logger.warn('Knowledge base vector deletion is not implemented yet', { baseId })
  }

  public async addItems(base: KnowledgeBase, items: KnowledgeItem[]): Promise<void> {
    await this.createBase(base)

    const tasks = this.toEnqueueTasks(base, items)

    if (tasks.length === 0) {
      logger.info('No knowledge items eligible for vector enqueue', {
        baseId: base.id,
        itemCount: items.length
      })
      return
    }

    await application.get('KnowledgeTaskService').enqueueMany(tasks)

    logger.info('Enqueued knowledge items for vector execution', {
      baseId: base.id,
      itemIds: tasks.map((task) => task.itemId),
      count: tasks.length,
      stage: 'embed'
    })
  }

  public async deleteItems(baseId: string, itemIds: string[]): Promise<void> {
    if (itemIds.length === 0) {
      return
    }

    logger.warn('Knowledge item vector deletion is not implemented yet', {
      baseId,
      itemIds
    })
  }

  public async search(
    base: KnowledgeBase,
    query: string,
    options: KnowledgeVectorSearchOptions = {}
  ): Promise<KnowledgeSearchResult[]> {
    void query
    void options

    await this.createBase(base)

    logger.warn('Knowledge vector search is not implemented yet', { baseId: base.id })
    return []
  }

  private toEnqueueTasks(base: KnowledgeBase, items: KnowledgeItem[]): EnqueueKnowledgeTaskInput[] {
    return items.flatMap((item) => {
      if (item.baseId !== base.id) {
        throw new Error(`Knowledge item ${item.id} does not belong to knowledge base ${base.id}`)
      }

      if (!this.shouldEnqueue(item)) {
        return []
      }

      return [
        {
          itemId: item.id,
          baseId: base.id,
          // First version dispatches directly into the embed stage.
          stage: 'embed'
        }
      ]
    })
  }

  private shouldEnqueue(item: KnowledgeItem): boolean {
    return item.type === 'file' || item.type === 'note' || item.type === 'url' || item.type === 'sitemap'
  }

  private registerIpcHandlers(): void {
    this.ipcHandle(IpcChannel.KnowledgeVector_CreateBase, async (_, base: KnowledgeBase) => this.createBase(base))
    this.ipcHandle(IpcChannel.KnowledgeVector_DeleteBase, async (_, baseId: string) => this.deleteBase(baseId))
    this.ipcHandle(
      IpcChannel.KnowledgeVector_AddItems,
      async (_, payload: { base: KnowledgeBase; items: KnowledgeItem[] }) => this.addItems(payload.base, payload.items)
    )
    this.ipcHandle(IpcChannel.KnowledgeVector_DeleteItems, async (_, payload: { baseId: string; itemIds: string[] }) =>
      this.deleteItems(payload.baseId, payload.itemIds)
    )
    this.ipcHandle(
      IpcChannel.KnowledgeVector_Search,
      async (_, payload: { base: KnowledgeBase; query: string; options?: KnowledgeVectorSearchOptions }) =>
        this.search(payload.base, payload.query, payload.options)
    )
  }
}
