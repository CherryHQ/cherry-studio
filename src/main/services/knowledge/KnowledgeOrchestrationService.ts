import { application } from '@application'
import { knowledgeBaseService } from '@data/services/KnowledgeBaseService'
import { knowledgeItemService } from '@data/services/KnowledgeItemService'
import { loggerService } from '@logger'
import { BaseService, DependsOn, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { TraceMethod } from '@mcp-trace/trace-core'
import { DataApiErrorFactory } from '@shared/data/api'
import { KNOWLEDGE_BASES_MAX_LIMIT } from '@shared/data/api/schemas/knowledges'
import {
  type CreateKnowledgeBaseDto,
  type KnowledgeBase,
  type KnowledgeItem,
  type KnowledgeItemChunk,
  type KnowledgeRuntimeAddItemInput,
  KnowledgeRuntimeAddItemInputSchema,
  type KnowledgeSearchResult,
  type RestoreKnowledgeBaseDto
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
  KnowledgeRuntimeRestoreBasePayloadSchema,
  KnowledgeRuntimeSearchPayloadSchema
} from './types/ipc'

const logger = loggerService.withContext('KnowledgeOrchestrationService')

export interface KnowledgeRuntimeAddItemsPartialFailure {
  sourceItemId: string | null
  sourceItemType: KnowledgeItem['type'] | null
  message: string
}

export class KnowledgeRuntimeAddItemsPartialError extends Error {
  readonly failures: KnowledgeRuntimeAddItemsPartialFailure[]

  constructor(failures: KnowledgeRuntimeAddItemsPartialFailure[]) {
    super(`Failed to restore ${failures.length} knowledge root item(s)`)
    this.name = 'KnowledgeRuntimeAddItemsPartialError'
    this.failures = failures
  }
}

function createRestoreBaseDto(sourceBase: KnowledgeBase, dto: RestoreKnowledgeBaseDto): CreateKnowledgeBaseDto {
  // The new vector store is shaped from dto.dimensions. Callers must resolve it
  // against dto.embeddingModelId before restore; mismatches surface during reindex.
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

  return createDto
}

function assertRestoreBaseCanRebuild(sourceBase: KnowledgeBase, dto: RestoreKnowledgeBaseDto): void {
  if (sourceBase.status === 'failed') {
    return
  }

  const embeddingModelChanged = dto.embeddingModelId.trim() !== sourceBase.embeddingModelId
  const dimensionsChanged = dto.dimensions !== sourceBase.dimensions

  if (embeddingModelChanged || dimensionsChanged) {
    return
  }

  throw DataApiErrorFactory.invalidOperation(
    'restoreBase',
    'Embedding model or dimensions must change when rebuilding a completed knowledge base'
  )
}

function normalizeFailureMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

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
      throw DataApiErrorFactory.invalidOperation(
        'deleteBase',
        `SQLite knowledge base was deleted, but vector artifact cleanup failed: ${normalizedError.message}`
      )
    }
  }

  async restoreBase(dto: RestoreKnowledgeBaseDto): Promise<KnowledgeBase> {
    const sourceBase = await knowledgeBaseService.getById(dto.sourceBaseId)
    assertRestoreBaseCanRebuild(sourceBase, dto)

    const createDto = createRestoreBaseDto(sourceBase, dto)
    const rootItems = await this.listRootItems(sourceBase.id)
    const restoredBase = await this.createBase(createDto)

    try {
      const failures: KnowledgeRuntimeAddItemsPartialFailure[] = []
      const inputs: KnowledgeRuntimeAddItemInput[] = []

      for (const item of rootItems) {
        try {
          const input = KnowledgeRuntimeAddItemInputSchema.parse({
            type: item.type,
            data: item.data
          })
          inputs.push(input)
        } catch (error) {
          failures.push({
            sourceItemId: item.id,
            sourceItemType: item.type,
            message: normalizeFailureMessage(error)
          })
        }
      }

      if (inputs.length > 0 && failures.length === 0) {
        try {
          await this.addItems(restoredBase.id, inputs)
        } catch (error) {
          const message = normalizeFailureMessage(error)
          failures.push({
            sourceItemId: null,
            sourceItemType: null,
            message
          })
        }
      }

      if (failures.length > 0) {
        throw new KnowledgeRuntimeAddItemsPartialError(failures)
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
      throw error
    }

    return restoredBase
  }

  async addItems(baseId: string, items: KnowledgeRuntimeAddItemInput[]): Promise<void> {
    await this.assertBaseCanRunRuntimeOperation(baseId, 'addItems')
    const runtime = application.get('KnowledgeRuntimeService')
    await runtime.addItems(baseId, items)
  }

  async deleteItems(baseId: string, itemIds: string[]): Promise<void> {
    const items = await this.getTopLevelItemsInBase(baseId, itemIds)
    const runtime = application.get('KnowledgeRuntimeService')
    await runtime.deleteItems(baseId, items)
    for (const item of items) {
      await knowledgeItemService.delete(item.id)
    }
  }

  async reindexItems(baseId: string, itemIds: string[]): Promise<void> {
    await this.assertBaseCanRunRuntimeOperation(baseId, 'reindexItems')
    const items = await this.getTopLevelItemsInBase(baseId, itemIds)
    const runtime = application.get('KnowledgeRuntimeService')

    await runtime.reindexItems(baseId, items)
  }

  async listBases(): Promise<KnowledgeBase[]> {
    const { items } = await knowledgeBaseService.list({ page: 1, limit: KNOWLEDGE_BASES_MAX_LIMIT })
    return items
  }

  async listRootItems(baseId: string): Promise<KnowledgeItem[]> {
    return await knowledgeItemService.getItemsByBaseId(baseId, { groupId: null })
  }

  @TraceMethod({ spanName: 'Knowledge.search', tag: 'Knowledge' })
  async search(baseId: string, query: string): Promise<KnowledgeSearchResult[]> {
    await this.assertBaseCanRunRuntimeOperation(baseId, 'search')
    const runtime = application.get('KnowledgeRuntimeService')
    return await runtime.search(baseId, query)
  }

  async listItemChunks(baseId: string, itemId: string): Promise<KnowledgeItemChunk[]> {
    await this.assertBaseCanRunRuntimeOperation(baseId, 'listItemChunks')
    await this.getRootItemsInBase(baseId, [itemId])
    const runtime = application.get('KnowledgeRuntimeService')
    return await runtime.listItemChunks(baseId, itemId)
  }

  async deleteItemChunk(baseId: string, itemId: string, chunkId: string): Promise<void> {
    await this.assertBaseCanRunRuntimeOperation(baseId, 'deleteItemChunk')
    await this.getRootItemsInBase(baseId, [itemId])
    const runtime = application.get('KnowledgeRuntimeService')
    return await runtime.deleteItemChunk(baseId, itemId, chunkId)
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
