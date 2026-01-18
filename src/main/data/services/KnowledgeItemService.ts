/**
/**
 * Knowledge Item Service (DataApi v2)
 *
 * Handles CRUD operations for knowledge items stored in SQLite,
 * and manages item processing via KnowledgeOrchestrator.
 */

import { dbService } from '@data/db/DbService'
import { knowledgeItemTable } from '@data/db/schemas/knowledge'
import { loggerService } from '@logger'
import { knowledgeOrchestrator } from '@main/services/knowledge/KnowledgeOrchestrator'
import { DataApiErrorFactory } from '@shared/data/api'
import type {
  BaseQueueStatus,
  CreateKnowledgeItemsDto,
  IgnoreResponse,
  RecoverResponse,
  UpdateKnowledgeItemDto
} from '@shared/data/api/schemas/knowledges'
import type { ItemStatus, KnowledgeItem, KnowledgeItemData } from '@shared/data/types/knowledge'
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
    progress: knowledgeOrchestrator.getProgress(row.id)
  }
}

export class KnowledgeItemService {
  private static instance: KnowledgeItemService

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
      logger.info('[DEBUG] Starting orchestrator.process for item', { itemId: item.id, baseId })
      void knowledgeOrchestrator.process({
        base,
        item,
        onStatusChange: async (status, error) => {
          logger.info('[DEBUG] onStatusChange callback called', { itemId: item.id, status, error })
          await this.update(item.id, { status, error })
          logger.info('[DEBUG] onStatusChange callback completed', { itemId: item.id, status })
        }
      })
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
    knowledgeOrchestrator.cancel(id)
    knowledgeOrchestrator.clearProgress(id)

    const [row] = await db
      .update(knowledgeItemTable)
      .set({ status: 'pending', error: null })
      .where(eq(knowledgeItemTable.id, id))
      .returning()

    const updatedItem = rowToKnowledgeItem(row)
    const base = await knowledgeBaseService.getById(item.baseId)
    const onStatusChange = async (status: ItemStatus, error: string | null) => {
      await this.update(item.id, { status, error })
    }

    await knowledgeOrchestrator.removeVectors(base, updatedItem)
    await knowledgeOrchestrator.process({
      base,
      item: updatedItem,
      onStatusChange
    })

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
    knowledgeOrchestrator.cancel(id)
    knowledgeOrchestrator.clearProgress(id)

    await knowledgeOrchestrator.removeVectors(base, item)

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
      .filter((row) => !knowledgeOrchestrator.isQueued(row.id) && !knowledgeOrchestrator.isProcessing(row.id))
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
      .filter((item) => knowledgeOrchestrator.isQueued(item.id) || knowledgeOrchestrator.isProcessing(item.id))
      .map((item) => item.id)

    const queueStatus = knowledgeOrchestrator.getQueueStatus()
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
      await this.update(item.id, { status: 'pending', error: null })
      knowledgeOrchestrator.clearProgress(item.id)
      await knowledgeOrchestrator.removeVectors(base, item)
      await knowledgeOrchestrator.process({
        base,
        item: { ...item, status: 'pending', error: undefined },
        onStatusChange: async (status, error) => {
          await this.update(item.id, { status, error })
        }
      })
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
}

export const knowledgeItemService = KnowledgeItemService.getInstance()
