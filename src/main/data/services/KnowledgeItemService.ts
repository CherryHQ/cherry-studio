/**
 * Knowledge Item Service (DataApi v2).
 *
 * Handles CRUD operations for knowledge items stored in SQLite.
 */

import { knowledgeItemTable } from '@data/db/schemas/knowledge'
import { loggerService } from '@logger'
import { application } from '@main/core/application'
import { DataApiErrorFactory } from '@shared/data/api'
import type { OffsetPaginationResponse } from '@shared/data/api/apiTypes'
import type {
  CreateKnowledgeItemsDto,
  KnowledgeItemsQuery,
  UpdateKnowledgeItemDto
} from '@shared/data/api/schemas/knowledges'
import type { KnowledgeItem } from '@shared/data/types/knowledge'
import { and, desc, eq, isNull, sql } from 'drizzle-orm'

import { knowledgeBaseService } from './KnowledgeBaseService'

const logger = loggerService.withContext('DataApi:KnowledgeItemService')

function rowToKnowledgeItem(row: typeof knowledgeItemTable.$inferSelect): KnowledgeItem {
  const parseJson = <T>(value: T | string | null | undefined): T | null => {
    if (value == null) return null
    if (typeof value === 'string') return JSON.parse(value)
    return value as T
  }

  return {
    id: row.id,
    baseId: row.baseId,
    parentId: row.parentId,
    type: row.type,
    data: parseJson(row.data)!,
    status: row.status,
    error: row.error,
    createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : new Date().toISOString(),
    updatedAt: row.updatedAt ? new Date(row.updatedAt).toISOString() : new Date().toISOString()
  } as KnowledgeItem
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

  async list(baseId: string, query: KnowledgeItemsQuery): Promise<OffsetPaginationResponse<KnowledgeItem>> {
    const db = application.get('DbService').getDb()
    await knowledgeBaseService.getById(baseId)
    const { page, limit, parentId } = query
    const offset = (page - 1) * limit
    const where = parentId
      ? and(eq(knowledgeItemTable.baseId, baseId), eq(knowledgeItemTable.parentId, parentId))
      : and(eq(knowledgeItemTable.baseId, baseId), isNull(knowledgeItemTable.parentId))

    const [rows, [{ count }]] = await Promise.all([
      db
        .select()
        .from(knowledgeItemTable)
        .where(where)
        .orderBy(desc(knowledgeItemTable.createdAt), desc(knowledgeItemTable.id))
        .limit(limit)
        .offset(offset),
      db.select({ count: sql<number>`count(*)` }).from(knowledgeItemTable).where(where)
    ])

    return {
      items: rows.map((row) => rowToKnowledgeItem(row)),
      total: count,
      page
    }
  }

  async create(baseId: string, dto: CreateKnowledgeItemsDto): Promise<{ items: KnowledgeItem[] }> {
    const db = application.get('DbService').getDb()
    await knowledgeBaseService.getById(baseId)

    if (!dto.items || dto.items.length === 0) {
      throw DataApiErrorFactory.validation({ items: ['At least one item is required'] })
    }
    for (const item of dto.items) {
      if (item.parentId == null) {
        continue
      }

      const [parent] = await db
        .select()
        .from(knowledgeItemTable)
        .where(eq(knowledgeItemTable.id, item.parentId))
        .limit(1)
      if (!parent) {
        throw DataApiErrorFactory.notFound('KnowledgeItem', item.parentId)
      }

      const operation = 'create knowledge item'
      if (parent.baseId !== baseId) {
        throw DataApiErrorFactory.invalidOperation(operation, 'Parent item does not belong to this knowledge base')
      }
    }

    const values: Array<typeof knowledgeItemTable.$inferInsert> = dto.items.map((item) => ({
      baseId,
      parentId: item.parentId ?? null,
      type: item.type,
      data: item.data,
      status: 'idle',
      error: null
    }))

    const rows = await db.insert(knowledgeItemTable).values(values).returning()
    const items = rows.map((row) => rowToKnowledgeItem(row))

    logger.info('Created knowledge items', { baseId, count: items.length })
    return { items }
  }

  async getById(id: string): Promise<KnowledgeItem> {
    const db = application.get('DbService').getDb()
    const [row] = await db.select().from(knowledgeItemTable).where(eq(knowledgeItemTable.id, id)).limit(1)

    if (!row) {
      throw DataApiErrorFactory.notFound('KnowledgeItem', id)
    }

    return rowToKnowledgeItem(row)
  }

  async update(id: string, dto: UpdateKnowledgeItemDto): Promise<KnowledgeItem> {
    const db = application.get('DbService').getDb()
    const existing = await this.getById(id)

    const updates: Partial<typeof knowledgeItemTable.$inferInsert> = {}
    if (dto.data !== undefined) {
      updates.data = dto.data
    }
    if (dto.status !== undefined) updates.status = dto.status
    if (dto.error !== undefined) updates.error = dto.error

    if (Object.keys(updates).length === 0) {
      return existing
    }

    const [row] = await db.update(knowledgeItemTable).set(updates).where(eq(knowledgeItemTable.id, id)).returning()
    logger.info('Updated knowledge item', { id, changes: Object.keys(dto) })
    return rowToKnowledgeItem(row)
  }

  async delete(id: string): Promise<void> {
    const db = application.get('DbService').getDb()
    await this.getById(id)
    await db.delete(knowledgeItemTable).where(eq(knowledgeItemTable.id, id))
    logger.info('Deleted knowledge item', { id })
  }
}

export const knowledgeItemService = KnowledgeItemService.getInstance()
