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
  CreateKnowledgeRootChildrenDto,
  KnowledgeItemChildrenQuery,
  KnowledgeRootChildrenQuery,
  UpdateKnowledgeItemDto
} from '@shared/data/api/schemas/knowledges'
import {
  DirectoryDataSchema,
  FileItemDataSchema,
  NoteItemDataSchema,
  SitemapItemDataSchema,
  UrlItemDataSchema
} from '@shared/data/api/schemas/knowledges'
import type { KnowledgeItem } from '@shared/data/types/knowledge'
import { and, desc, eq, sql } from 'drizzle-orm'

import { knowledgeBaseService } from './KnowledgeBaseService'

const logger = loggerService.withContext('DataApi:KnowledgeItemService')

const KNOWLEDGE_ITEM_DATA_SCHEMAS = {
  file: FileItemDataSchema,
  url: UrlItemDataSchema,
  note: NoteItemDataSchema,
  sitemap: SitemapItemDataSchema,
  directory: DirectoryDataSchema
} as const

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

  async listRootChildren(
    baseId: string,
    query: KnowledgeRootChildrenQuery
  ): Promise<OffsetPaginationResponse<KnowledgeItem>> {
    const db = application.get('DbService').getDb()
    await knowledgeBaseService.getById(baseId)
    const { page, limit, type } = query
    const offset = (page - 1) * limit
    const conditions = [eq(knowledgeItemTable.baseId, baseId), sql`${knowledgeItemTable.parentId} IS NULL`]

    if (type !== undefined) {
      conditions.push(eq(knowledgeItemTable.type, type))
    }

    const where = conditions.length === 1 ? conditions[0] : and(...conditions)

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

  async listChildren(id: string, query: KnowledgeItemChildrenQuery): Promise<OffsetPaginationResponse<KnowledgeItem>> {
    const db = application.get('DbService').getDb()
    const parent = await this.getById(id)
    const { page, limit } = query
    const offset = (page - 1) * limit
    const where = and(eq(knowledgeItemTable.baseId, parent.baseId), eq(knowledgeItemTable.parentId, id))

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

  async createRootChildren(baseId: string, dto: CreateKnowledgeRootChildrenDto): Promise<{ items: KnowledgeItem[] }> {
    const db = application.get('DbService').getDb()
    await knowledgeBaseService.getById(baseId)
    const values: Array<typeof knowledgeItemTable.$inferInsert> = dto.items.map((item) => ({
      baseId,
      parentId: null,
      type: item.type,
      data: item.data,
      status: 'idle',
      error: null
    }))

    const rows = await db.insert(knowledgeItemTable).values(values).returning()
    const items = rows.map((row) => rowToKnowledgeItem(row))

    logger.info('Created root knowledge items', { baseId, count: items.length })
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
      const parsed = KNOWLEDGE_ITEM_DATA_SCHEMAS[existing.type].safeParse(dto.data)
      if (!parsed.success) {
        throw DataApiErrorFactory.validation({
          data: [`Data payload does not match the existing knowledge item type '${existing.type}'`]
        })
      }
      updates.data = parsed.data
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

  /**
   * Delete a knowledge item subtree by id.
   *
   * The SQLite self-referencing foreign key on `parentId` is configured with
   * `ON DELETE CASCADE`, so removing the target node also removes its
   * descendants in the same knowledge base.
   */
  async delete(id: string): Promise<void> {
    const db = application.get('DbService').getDb()
    await this.getById(id)
    await db.delete(knowledgeItemTable).where(eq(knowledgeItemTable.id, id))
    logger.info('Deleted knowledge item', { id })
  }
}

export const knowledgeItemService = KnowledgeItemService.getInstance()
