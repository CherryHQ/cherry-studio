import { application } from '@application'
import { knowledgeBaseService } from '@data/services/KnowledgeBaseService'
import { knowledgeItemService } from '@data/services/KnowledgeItemService'
import { loggerService } from '@logger'
import { BaseService, DependsOn, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import type {
  CreateKnowledgeBaseDto,
  KnowledgeBase,
  KnowledgeItem,
  KnowledgeItemChunk,
  KnowledgeRuntimeAddItemInput,
  KnowledgeSearchResult
} from '@shared/data/types/knowledge'
import { IpcChannel } from '@shared/IpcChannel'

import { failItems } from './runtime/utils/cleanup'
import {
  KnowledgeRuntimeAddItemsPayloadSchema,
  KnowledgeRuntimeBasePayloadSchema,
  KnowledgeRuntimeCreateBasePayloadSchema,
  KnowledgeRuntimeDeleteItemChunkPayloadSchema,
  KnowledgeRuntimeItemChunksPayloadSchema,
  KnowledgeRuntimeItemsPayloadSchema,
  KnowledgeRuntimeSearchPayloadSchema
} from './types/ipc'

const logger = loggerService.withContext('KnowledgeOrchestrationService')

@Injectable('KnowledgeOrchestrationService')
@ServicePhase(Phase.WhenReady)
@DependsOn(['KnowledgeRuntimeService'])
export class KnowledgeOrchestrationService extends BaseService {
  protected onInit(): void {
    this.registerIpcHandlers()
  }

  async createBase(dto: CreateKnowledgeBaseDto): Promise<KnowledgeBase> {
    const base = await knowledgeBaseService.create(dto)
    const runtime = application.get('KnowledgeRuntimeService')

    try {
      await runtime.createBase(base.id)
    } catch (error) {
      await knowledgeBaseService.delete(base.id)
      throw error
    }

    return base
  }

  async deleteBase(baseId: string): Promise<void> {
    const runtime = application.get('KnowledgeRuntimeService')
    const interruptedItemIds = await runtime.deleteBase(baseId)

    try {
      await knowledgeBaseService.delete(baseId)
    } catch (error) {
      const normalizedError = error instanceof Error ? error : new Error(String(error))
      try {
        await failItems(interruptedItemIds, normalizedError.message)
      } catch (failureStateError) {
        logger.error(
          'Failed to persist runtime item failure state after knowledge base deletion failed',
          failureStateError instanceof Error ? failureStateError : new Error(String(failureStateError)),
          {
            baseId,
            interruptedItemIds,
            deleteError: normalizedError.message
          }
        )
      }
      throw error
    }

    try {
      await runtime.deleteBaseArtifacts(baseId)
    } catch (error) {
      const normalizedError = error instanceof Error ? error : new Error(String(error))
      logger.error('Failed to delete knowledge base vector artifacts after SQLite deletion', normalizedError, {
        baseId,
        interruptedItemIds
      })
    }
  }

  async addItems(baseId: string, items: KnowledgeRuntimeAddItemInput[]): Promise<void> {
    const runtime = application.get('KnowledgeRuntimeService')
    await runtime.addItems(baseId, items)
  }

  async deleteItems(baseId: string, itemIds: string[]): Promise<void> {
    const items = await this.getTopLevelItemsInBase(baseId, itemIds)
    const runtime = application.get('KnowledgeRuntimeService')
    await runtime.deleteItems(baseId, items)
    await Promise.all(items.map((item) => knowledgeItemService.delete(item.id)))
  }

  async reindexItems(baseId: string, itemIds: string[]): Promise<void> {
    const items = await this.getTopLevelItemsInBase(baseId, itemIds)
    const runtime = application.get('KnowledgeRuntimeService')

    await runtime.reindexItems(baseId, items)
  }

  async search(baseId: string, query: string): Promise<KnowledgeSearchResult[]> {
    const runtime = application.get('KnowledgeRuntimeService')
    return await runtime.search(baseId, query)
  }

  async listItemChunks(baseId: string, itemId: string): Promise<KnowledgeItemChunk[]> {
    await this.getRootItemsInBase(baseId, [itemId])
    const runtime = application.get('KnowledgeRuntimeService')
    return await runtime.listItemChunks(baseId, itemId)
  }

  async deleteItemChunk(baseId: string, itemId: string, chunkId: string): Promise<void> {
    await this.getRootItemsInBase(baseId, [itemId])
    const runtime = application.get('KnowledgeRuntimeService')
    return await runtime.deleteItemChunk(baseId, itemId, chunkId)
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

  private async getTopLevelItemsInBase(baseId: string, itemIds: string[]): Promise<KnowledgeItem[]> {
    const items = await this.getRootItemsInBase(baseId, itemIds)
    const selectedIds = new Set(items.map((item) => item.id))
    const descendantSelectedIds = new Set<string>()

    for (const item of items) {
      const descendants = await knowledgeItemService.getDescendantItems(baseId, [item.id])
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
