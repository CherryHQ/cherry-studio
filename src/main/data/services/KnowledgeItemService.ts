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
import { knowledgeQueueManager } from '@main/services/knowledge/KnowledgeQueueManager'
import { knowledgeServiceV2 } from '@main/services/knowledge/KnowledgeServiceV2'
import { DataApiErrorFactory } from '@shared/data/api'
import type { CreateKnowledgeItemsDto, UpdateKnowledgeItemDto } from '@shared/data/api/schemas/knowledges'
import type { ItemStatus, KnowledgeBase, KnowledgeItem, KnowledgeItemData } from '@shared/data/types/knowledge'
import { desc, eq } from 'drizzle-orm'

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
    updatedAt: row.updatedAt ? new Date(row.updatedAt).toISOString() : new Date().toISOString()
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

    await knowledgeServiceV2.remove({
      base,
      externalId: item.id,
      uniqueId: '',
      uniqueIds: []
    })

    await db.delete(knowledgeItemTable).where(eq(knowledgeItemTable.id, id))

    logger.info('Deleted knowledge item', { id })
  }

  private async processItem(base: KnowledgeBase, item: KnowledgeItem): Promise<void> {
    try {
      if (knowledgeQueueManager.isQueued(item.id) || knowledgeQueueManager.isProcessing(item.id)) {
        logger.debug('Item already queued or processing, skipping enqueue', { itemId: item.id })
        return
      }

      const handleStageChange = async (stage: 'preprocessing' | 'embedding') => {
        await this.updateItemStatus(item.id, stage, null)
      }

      knowledgeQueueManager
        .enqueue(item.id, async (signal) => {
          try {
            await knowledgeServiceV2.add({
              base,
              item,
              signal,
              onStageChange: handleStageChange
            })
            await this.updateItemStatus(item.id, 'completed', null)
          } catch (error) {
            if (this.isAbortError(error)) {
              await this.updateItemStatus(item.id, 'failed', 'Cancelled')
              logger.info('Knowledge item processing cancelled', { itemId: item.id })
              return
            }

            logger.error('Knowledge item processing failed', error as Error, { itemId: item.id, baseId: base.id })
            await this.updateItemStatus(item.id, 'failed', error instanceof Error ? error.message : String(error))
          }
        })
        .catch((error) => {
          if (this.isAbortError(error)) {
            logger.debug('Queue task aborted before start', { itemId: item.id })
            return
          }
          logger.error('Failed to enqueue knowledge item', error as Error, { itemId: item.id })
        })
    } catch (error) {
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
      await knowledgeServiceV2.remove({
        base,
        externalId: item.id,
        uniqueId: '',
        uniqueIds: []
      })
    } catch (error) {
      logger.warn('Failed to remove knowledge item vectors', { itemId: item.id, error })
    }
  }
}

export const knowledgeItemService = KnowledgeItemService.getInstance()
