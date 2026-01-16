/**
/**
 * Knowledge Item Service (DataApi v2)
 *
 * Handles CRUD operations for knowledge items stored in SQLite,
 * and manages item processing via KnowledgeServiceV2.
 */

import { dbService } from '@data/db/DbService'
import { knowledgeItemTable } from '@data/db/schemas/knowledge'
import { loggerService } from '@logger'
import { knowledgeServiceV2 } from '@main/services/knowledge/KnowledgeServiceV2'
import { type KnowledgeJob, knowledgeQueueManager } from '@main/services/knowledge/queue'
import type { KnowledgeStage } from '@main/services/knowledge/types'
import { DataApiErrorFactory } from '@shared/data/api'
import type {
  BaseQueueStatus,
  CreateKnowledgeItemsDto,
  IgnoreResponse,
  RecoverResponse,
  UpdateKnowledgeItemDto
} from '@shared/data/api/schemas/knowledges'
import type { ItemStatus, KnowledgeBase, KnowledgeItem, KnowledgeItemData } from '@shared/data/types/knowledge'
import { and, desc, eq, inArray } from 'drizzle-orm'

import { knowledgeBaseService } from './KnowledgeBaseService'

const logger = loggerService.withContext('DataApi:KnowledgeItemService')

function rowToKnowledgeItem(row: typeof knowledgeItemTable.$inferSelect): KnowledgeItem {
  const parseJson = <T>(value: T | string | null | undefined): T | undefined => {
    if (value == null) return undefined
    if (typeof value === 'string') return JSON.parse(value) as T
    return value
  }

  return {
    id: row.id,
    baseId: row.baseId,
    type: row.type,
    data: parseJson(row.data) as KnowledgeItemData,
    status: row.status ?? 'idle',
    error: row.error ?? undefined,
    createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : new Date().toISOString(),
    updatedAt: row.updatedAt ? new Date(row.updatedAt).toISOString() : new Date().toISOString(),
    progress: knowledgeQueueManager.getProgress(row.id)
  }
}

export class KnowledgeItemService {
  private static instance: KnowledgeItemService
  private jobTokens = new Map<string, number>()

  private constructor() {}

  public static getInstance(): KnowledgeItemService {
    if (!KnowledgeItemService.instance) {
      KnowledgeItemService.instance = new KnowledgeItemService()
    }
    return KnowledgeItemService.instance
  }

  /**
   * List all knowledge items for a base
   */
  async list(baseId: string): Promise<KnowledgeItem[]> {
    const db = dbService.getDb()
    await knowledgeBaseService.getById(baseId)

    const rows = await db
      .select()
      .from(knowledgeItemTable)
      .where(eq(knowledgeItemTable.baseId, baseId))
      .orderBy(desc(knowledgeItemTable.createdAt))

    return rows.map((row) => rowToKnowledgeItem(row))
  }

  /**
   * Create multiple knowledge items for a base
   */
  async create(baseId: string, dto: CreateKnowledgeItemsDto): Promise<{ items: KnowledgeItem[] }> {
    const db = dbService.getDb()

    if (!dto.items || dto.items.length === 0) {
      throw DataApiErrorFactory.validation({ items: ['At least one item is required'] })
    }

    const base = await knowledgeBaseService.getById(baseId)

    const values = dto.items.map((item) => ({
      baseId,
      type: item.type,
      data: item.data,
      status: 'pending' as ItemStatus,
      error: null
    }))

    const rows = await db.insert(knowledgeItemTable).values(values).returning()
    const items = rows.map((row) => rowToKnowledgeItem(row))

    items.forEach((item) => {
      void this.processItem(base, item)
    })

    return { items }
  }

  /**
   * Get knowledge item by ID
   */
  async getById(id: string): Promise<KnowledgeItem> {
    const db = dbService.getDb()
    const [row] = await db.select().from(knowledgeItemTable).where(eq(knowledgeItemTable.id, id)).limit(1)

    if (!row) {
      throw DataApiErrorFactory.notFound('KnowledgeItem', id)
    }

    return rowToKnowledgeItem(row)
  }

  /**
   * Update knowledge item
   */
  async update(id: string, dto: UpdateKnowledgeItemDto): Promise<KnowledgeItem> {
    const db = dbService.getDb()

    await this.getById(id)

    const updates: Partial<typeof knowledgeItemTable.$inferInsert> = {}

    if (dto.data !== undefined) updates.data = dto.data
    if (dto.status !== undefined) updates.status = dto.status
    if (dto.error !== undefined) updates.error = dto.error

    const [row] = await db.update(knowledgeItemTable).set(updates).where(eq(knowledgeItemTable.id, id)).returning()

    logger.info('Updated knowledge item', { id, changes: Object.keys(dto) })

    return rowToKnowledgeItem(row)
  }

  /**
   * Reprocess a knowledge item
   */
  async reprocess(id: string): Promise<KnowledgeItem> {
    const db = dbService.getDb()

    const item = await this.getById(id)
    knowledgeQueueManager.cancel(id)
    knowledgeQueueManager.clearProgress(id)

    const [row] = await db
      .update(knowledgeItemTable)
      .set({ status: 'pending', error: null })
      .where(eq(knowledgeItemTable.id, id))
      .returning()

    const updatedItem = rowToKnowledgeItem(row)
    const base = await knowledgeBaseService.getById(item.baseId)

    await this.removeItemVectors(base, updatedItem)
    await this.processItem(base, updatedItem)

    logger.info('Triggered reprocessing for knowledge item', { id })

    return updatedItem
  }

  /**
   * Delete knowledge item
   */
  async delete(id: string): Promise<void> {
    const db = dbService.getDb()

    const item = await this.getById(id)
    const base = await knowledgeBaseService.getById(item.baseId)
    knowledgeQueueManager.cancel(id)
    knowledgeQueueManager.clearProgress(id)

    await knowledgeServiceV2.remove({ base, item })

    await db.delete(knowledgeItemTable).where(eq(knowledgeItemTable.id, id))

    logger.info('Deleted knowledge item', { id })
  }

  /**
   * Get orphan items for a knowledge base.
   * Orphans = items with incomplete status that are NOT in the active queue.
   */
  async getOrphanItems(baseId: string): Promise<KnowledgeItem[]> {
    const db = dbService.getDb()
    const incompleteStatuses: ItemStatus[] = ['pending', 'ocr', 'read', 'embed']

    const rows = await db
      .select()
      .from(knowledgeItemTable)
      .where(and(eq(knowledgeItemTable.baseId, baseId), inArray(knowledgeItemTable.status, incompleteStatuses)))

    // Filter out items that are actually in the queue
    return rows
      .filter((row) => !knowledgeQueueManager.isQueued(row.id) && !knowledgeQueueManager.isProcessing(row.id))
      .map(rowToKnowledgeItem)
  }

  /**
   * Get queue status for a knowledge base.
   */
  async getQueueStatus(baseId: string): Promise<BaseQueueStatus> {
    // Validate base exists
    await knowledgeBaseService.getById(baseId)

    const orphanItems = await this.getOrphanItems(baseId)
    const allItems = await this.list(baseId)

    const activeItemIds = allItems
      .filter((item) => knowledgeQueueManager.isQueued(item.id) || knowledgeQueueManager.isProcessing(item.id))
      .map((item) => item.id)

    const queueStatus = knowledgeQueueManager.getStatus()
    const pendingCount = queueStatus.perBaseQueue[baseId] ?? 0

    return {
      orphanItemIds: orphanItems.map((item) => item.id),
      activeItemIds,
      pendingCount
    }
  }

  /**
   * Recover orphan items by re-enqueueing them.
   */
  async recoverOrphans(baseId: string): Promise<RecoverResponse> {
    const orphanItems = await this.getOrphanItems(baseId)
    const base = await knowledgeBaseService.getById(baseId)

    for (const item of orphanItems) {
      // Reset status and re-enqueue
      await this.updateItemStatus(item.id, 'pending', null)
      knowledgeQueueManager.clearProgress(item.id)
      await this.removeItemVectors(base, item)
      await this.processItem(base, { ...item, status: 'pending', error: undefined })
    }

    logger.info('Recovered orphan items', { baseId, count: orphanItems.length })
    return { recoveredCount: orphanItems.length }
  }

  /**
   * Ignore orphan items by marking them as failed.
   */
  async ignoreOrphans(baseId: string): Promise<IgnoreResponse> {
    // Validate base exists
    await knowledgeBaseService.getById(baseId)

    const orphanItems = await this.getOrphanItems(baseId)

    if (orphanItems.length > 0) {
      const db = dbService.getDb()
      const orphanIds = orphanItems.map((item) => item.id)

      await db
        .update(knowledgeItemTable)
        .set({ status: 'failed', error: 'Task interrupted' })
        .where(inArray(knowledgeItemTable.id, orphanIds))
    }

    logger.info('Ignored orphan items', { baseId, count: orphanItems.length })
    return { ignoredCount: orphanItems.length }
  }

  private async processItem(base: KnowledgeBase, item: KnowledgeItem): Promise<void> {
    try {
      if (knowledgeQueueManager.isQueued(item.id) || knowledgeQueueManager.isProcessing(item.id)) {
        logger.debug('Item already queued or processing, skipping enqueue', { itemId: item.id })
        return
      }

      const createdAt = Date.now()
      this.jobTokens.set(item.id, createdAt)

      const job: KnowledgeJob = {
        baseId: base.id,
        itemId: item.id,
        type: item.type,
        createdAt
      }

      knowledgeQueueManager
        .enqueue(job, async ({ signal, runStage, updateProgress }) => {
          const isCurrentJob = () => this.jobTokens.get(item.id) === createdAt
          const updateStatus = async (status: ItemStatus, errorMessage: string | null) => {
            if (!isCurrentJob()) {
              return
            }
            await this.updateItemStatus(item.id, status, errorMessage)
          }
          const updateItemProgress = (progress: number, options?: { immediate?: boolean }) => {
            if (!isCurrentJob()) {
              return
            }
            updateProgress(progress, options)
          }

          const handleStageChange = async (stage: KnowledgeStage) => {
            // Only 'ocr' and 'embed' are valid status values
            if (stage === 'ocr' || stage === 'embed') {
              await updateStatus(stage, null)
            }
          }

          const handleProgress = (_stage: KnowledgeStage, progress: number) => {
            updateItemProgress(progress, { immediate: true })
          }

          try {
            await knowledgeServiceV2.add({
              base,
              item,
              signal,
              onStageChange: handleStageChange,
              onProgress: handleProgress,
              runStage
            })
            await updateStatus('completed', null)
            updateItemProgress(100, { immediate: true })
          } catch (error) {
            if (this.isAbortError(error)) {
              await updateStatus('failed', 'Cancelled')
              logger.info('Knowledge item processing cancelled', { itemId: item.id })
              return
            }

            logger.error('Knowledge item processing failed', error as Error, { itemId: item.id, baseId: base.id })
            await updateStatus('failed', error instanceof Error ? error.message : String(error))
          } finally {
            if (isCurrentJob()) {
              this.jobTokens.delete(item.id)
            }
          }
        })
        .catch((error) => {
          if (this.isAbortError(error)) {
            logger.debug('Queue task aborted before start', { itemId: item.id })
            this.jobTokens.delete(item.id)
            return
          }
          logger.error('Failed to enqueue knowledge item', error as Error, { itemId: item.id })
          this.jobTokens.delete(item.id)
        })
    } catch (error) {
      this.jobTokens.delete(item.id)
      logger.error('Knowledge item enqueue failed', error as Error, { itemId: item.id, baseId: base.id })
      await this.updateItemStatus(item.id, 'failed', error instanceof Error ? error.message : String(error))
    }
  }

  private async updateItemStatus(id: string, status: ItemStatus, errorMessage: string | null): Promise<void> {
    const db = dbService.getDb()

    await db.update(knowledgeItemTable).set({ status, error: errorMessage }).where(eq(knowledgeItemTable.id, id))
  }

  private isAbortError(error: unknown): boolean {
    return error instanceof Error && error.name === 'AbortError'
  }

  private async removeItemVectors(base: KnowledgeBase, item: KnowledgeItem): Promise<void> {
    try {
      await knowledgeServiceV2.remove({ base, item })
    } catch (error) {
      logger.warn('Failed to remove knowledge item vectors', { itemId: item.id, error })
    }
  }
}

export const knowledgeItemService = KnowledgeItemService.getInstance()
