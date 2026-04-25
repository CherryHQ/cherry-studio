import { application } from '@application'
import { knowledgeBaseService } from '@data/services/KnowledgeBaseService'
import { knowledgeItemService } from '@data/services/KnowledgeItemService'
import { loggerService } from '@logger'
import { BaseService, DependsOn, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import type { CreateKnowledgeItemsDto } from '@shared/data/api/schemas/knowledges'
import { CreateKnowledgeItemsSchema } from '@shared/data/api/schemas/knowledges'
import type {
  KnowledgeBase,
  KnowledgeItem,
  KnowledgeItemChunk,
  KnowledgeSearchResult
} from '@shared/data/types/knowledge'
import { IpcChannel } from '@shared/IpcChannel'
import * as z from 'zod'

import { processKnowledgeSources } from './processKnowledgeSources'

const logger = loggerService.withContext('KnowledgeOrchestrationService')

const KnowledgeRuntimeBasePayloadSchema = z
  .object({
    baseId: z.string().trim().min(1)
  })
  .strict()

const KnowledgeRuntimeAddSourcesPayloadSchema = z
  .object({
    baseId: z.string().trim().min(1),
    items: CreateKnowledgeItemsSchema.shape.items
  })
  .strict()

const KnowledgeRuntimeItemsPayloadSchema = z
  .object({
    baseId: z.string().trim().min(1),
    itemIds: z.array(z.string().trim().min(1)).min(1)
  })
  .strict()

const KnowledgeRuntimeSearchPayloadSchema = z
  .object({
    baseId: z.string().trim().min(1),
    query: z.string().trim().min(1).max(1000)
  })
  .strict()

const KnowledgeRuntimeItemChunksPayloadSchema = z
  .object({
    baseId: z.string().trim().min(1),
    itemId: z.string().trim().min(1)
  })
  .strict()

const KnowledgeRuntimeDeleteItemChunkPayloadSchema = z
  .object({
    baseId: z.string().trim().min(1),
    itemId: z.string().trim().min(1),
    chunkId: z.string().trim().min(1)
  })
  .strict()

const toCreateKnowledgeItemInput = (item: KnowledgeItem): CreateKnowledgeItemsDto['items'][number] => {
  switch (item.type) {
    case 'file':
      return { type: item.type, groupId: item.groupId, data: item.data }
    case 'url':
      return { type: item.type, groupId: item.groupId, data: item.data }
    case 'note':
      return { type: item.type, groupId: item.groupId, data: item.data }
    case 'sitemap':
      return { type: item.type, groupId: item.groupId, data: item.data }
    case 'directory':
      return { type: item.type, groupId: item.groupId, data: item.data }
  }
}

@Injectable('KnowledgeOrchestrationService')
@ServicePhase(Phase.WhenReady)
@DependsOn(['KnowledgeRuntimeService'])
export class KnowledgeOrchestrationService extends BaseService {
  protected onInit(): void {
    this.registerIpcHandlers()
  }

  async createBase(baseId: string): Promise<void> {
    const base = await knowledgeBaseService.getById(baseId)
    const runtime = application.get('KnowledgeRuntimeService')
    await runtime.createBase(base)
  }

  async deleteBase(baseId: string): Promise<void> {
    const runtime = application.get('KnowledgeRuntimeService')
    await runtime.deleteBase(baseId)
    await knowledgeBaseService.delete(baseId)
  }

  async addSources(baseId: string, items: CreateKnowledgeItemsDto['items']): Promise<{ itemIds: string[] }> {
    const base = await knowledgeBaseService.getById(baseId)

    const createdItems = (
      await knowledgeItemService.createManyInBase(baseId, items, {
        status: 'pending'
      })
    ).items

    this.enqueueBackgroundProcessing(base, createdItems)
    return { itemIds: createdItems.map((item) => item.id) }
  }

  async deleteItems(baseId: string, itemIds: string[]): Promise<void> {
    const [base, items] = await Promise.all([
      knowledgeBaseService.getById(baseId),
      knowledgeItemService.getByIdsInBase(baseId, itemIds)
    ])

    const runtime = application.get('KnowledgeRuntimeService')
    await runtime.deleteItems(base, items)
    await Promise.all(itemIds.map((itemId) => knowledgeItemService.delete(itemId)))
  }

  async reindexItems(baseId: string, itemIds: string[]): Promise<{ itemIds: string[] }> {
    const [base, items] = await Promise.all([
      knowledgeBaseService.getById(baseId),
      knowledgeItemService.getByIdsInBase(baseId, itemIds)
    ])
    const recreatedInputs = items.map(toCreateKnowledgeItemInput)

    const runtime = application.get('KnowledgeRuntimeService')
    await runtime.deleteItems(base, items)
    await Promise.all(items.map((item) => knowledgeItemService.delete(item.id)))

    const recreatedItems = (
      await knowledgeItemService.createManyInBase(baseId, recreatedInputs, {
        status: 'pending'
      })
    ).items

    this.enqueueBackgroundProcessing(base, recreatedItems)
    return { itemIds: recreatedItems.map((item) => item.id) }
  }

  async search(baseId: string, query: string): Promise<KnowledgeSearchResult[]> {
    const base = await knowledgeBaseService.getById(baseId)
    const runtime = application.get('KnowledgeRuntimeService')
    return await runtime.search(base, query)
  }

  async listItemChunks(baseId: string, itemId: string): Promise<KnowledgeItemChunk[]> {
    const [base] = await Promise.all([
      knowledgeBaseService.getById(baseId),
      knowledgeItemService.getByIdsInBase(baseId, [itemId])
    ])
    const runtime = application.get('KnowledgeRuntimeService')
    return await runtime.listItemChunks(base, itemId)
  }

  async deleteItemChunk(baseId: string, itemId: string, chunkId: string): Promise<void> {
    const [base] = await Promise.all([
      knowledgeBaseService.getById(baseId),
      knowledgeItemService.getByIdsInBase(baseId, [itemId])
    ])
    const runtime = application.get('KnowledgeRuntimeService')
    return await runtime.deleteItemChunk(base, itemId, chunkId)
  }

  private registerIpcHandlers(): void {
    this.ipcHandle(IpcChannel.KnowledgeRuntime_CreateBase, async (_, payload: unknown) => {
      const { baseId } = KnowledgeRuntimeBasePayloadSchema.parse(payload)
      return await this.createBase(baseId)
    })
    this.ipcHandle(IpcChannel.KnowledgeRuntime_DeleteBase, async (_, payload: unknown) => {
      const { baseId } = KnowledgeRuntimeBasePayloadSchema.parse(payload)
      return await this.deleteBase(baseId)
    })
    this.ipcHandle(IpcChannel.KnowledgeRuntime_AddItems, async (_, payload: unknown) => {
      const { baseId, items } = KnowledgeRuntimeAddSourcesPayloadSchema.parse(payload)
      return await this.addSources(baseId, items)
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

  private enqueueBackgroundProcessing(base: KnowledgeBase, items: KnowledgeItem[]): void {
    void processKnowledgeSources(base, items).catch(async (error) => {
      const normalizedError = error instanceof Error ? error : new Error(String(error))
      logger.error('Failed to process accepted knowledge sources', normalizedError, {
        baseId: base.id,
        itemIds: items.map((item) => item.id)
      })
      await this.markPendingItemsFailed(items, normalizedError.message)
    })
  }

  private async markPendingItemsFailed(items: KnowledgeItem[], error: string): Promise<void> {
    const pendingItems = items.filter((item) => item.status === 'pending')

    if (pendingItems.length === 0) {
      return
    }

    try {
      await knowledgeItemService.updateStatuses(
        pendingItems.map((item) => item.id),
        {
          status: 'failed',
          error
        }
      )
    } catch (persistError) {
      logger.error(
        'Failed to persist background knowledge source failure state',
        persistError instanceof Error ? persistError : new Error(String(persistError)),
        {
          itemIds: pendingItems.map((item) => item.id),
          originalError: error
        }
      )
    }
  }
}
