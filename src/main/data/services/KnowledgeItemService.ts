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
import { getCreateKnowledgeItemsReferenceErrors } from '@shared/data/api/schemas/knowledges'
import {
  DirectoryItemDataSchema,
  FileItemDataSchema,
  type KnowledgeItem,
  NoteItemDataSchema,
  SitemapItemDataSchema,
  UrlItemDataSchema
} from '@shared/data/types/knowledge'
import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import { v7 as uuidv7 } from 'uuid'

import { knowledgeBaseService } from './KnowledgeBaseService'

const logger = loggerService.withContext('DataApi:KnowledgeItemService')

const KNOWLEDGE_ITEM_DATA_SCHEMAS = {
  file: FileItemDataSchema,
  url: UrlItemDataSchema,
  note: NoteItemDataSchema,
  sitemap: SitemapItemDataSchema,
  directory: DirectoryItemDataSchema
} as const

function resolveCreateGroupId(
  item: CreateKnowledgeItemsDto['items'][number] & { id: string },
  batchRefToId: Map<string, string>
): string | null {
  if (item.groupRef) {
    return batchRefToId.get(item.groupRef) ?? null
  }

  return item.groupId ?? null
}

function rowToKnowledgeItem(row: typeof knowledgeItemTable.$inferSelect): KnowledgeItem {
  const parseJson = <T>(value: T | string | null | undefined, context?: string): T | null => {
    if (value == null) return null
    if (typeof value === 'string') {
      try {
        return JSON.parse(value)
      } catch (error) {
        logger.error(`Failed to parse JSON data${context ? ` for ${context}` : ''}`, error as Error)
        throw DataApiErrorFactory.dataInconsistent(
          'KnowledgeItem',
          `Corrupted data in knowledge item${context ? ` '${context}'` : ''}`
        )
      }
    }
    return value as T
  }

  const parsedData = parseJson(row.data, row.id)
  if (!parsedData) {
    throw DataApiErrorFactory.dataInconsistent('KnowledgeItem', `Knowledge item '${row.id}' has missing or null data`)
  }

  return {
    id: row.id,
    baseId: row.baseId,
    groupId: row.groupId,
    type: row.type,
    data: parsedData,
    status: row.status,
    error: row.error,
    createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : new Date().toISOString(),
    updatedAt: row.updatedAt ? new Date(row.updatedAt).toISOString() : new Date().toISOString()
  } as KnowledgeItem
}

export class KnowledgeItemService {
  async list(baseId: string, query: KnowledgeItemsQuery): Promise<OffsetPaginationResponse<KnowledgeItem>> {
    const db = application.get('DbService').getDb()
    await knowledgeBaseService.getById(baseId)
    const { page, limit, type, groupId } = query
    const offset = (page - 1) * limit
    const conditions = [eq(knowledgeItemTable.baseId, baseId)]

    if (type !== undefined) {
      conditions.push(eq(knowledgeItemTable.type, type))
    }
    if (groupId !== undefined) {
      conditions.push(eq(knowledgeItemTable.groupId, groupId))
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

  async createMany(baseId: string, dto: CreateKnowledgeItemsDto): Promise<{ items: KnowledgeItem[] }> {
    const db = application.get('DbService').getDb()
    await knowledgeBaseService.getById(baseId)

    const referenceErrors = getCreateKnowledgeItemsReferenceErrors(dto.items)
    if (Object.keys(referenceErrors).length > 0) {
      throw DataApiErrorFactory.validation(referenceErrors)
    }

    const batchRefToId = new Map<string, string>()
    const plannedItems = dto.items.map((item) => {
      const id = uuidv7()

      if (item.ref) {
        batchRefToId.set(item.ref, id)
      }

      return {
        ...item,
        id
      }
    })

    const values: Array<typeof knowledgeItemTable.$inferInsert> = plannedItems.map((item, index) => {
      const parsed = KNOWLEDGE_ITEM_DATA_SCHEMAS[item.type].safeParse(item.data)
      if (!parsed.success) {
        throw DataApiErrorFactory.validation({
          [`items.${index}.data`]: [`Data payload does not match knowledge item type '${item.type}'`]
        })
      }

      return {
        id: item.id,
        baseId,
        groupId: resolveCreateGroupId(item, batchRefToId),
        type: item.type,
        data: parsed.data,
        status: 'idle',
        error: null
      }
    })
    const requestedGroupIds = [
      ...new Set(plannedItems.map((item) => item.groupId).filter((groupId) => groupId != null))
    ]

    if (requestedGroupIds.length > 0) {
      const existingGroupRows = await db
        .select({ id: knowledgeItemTable.id })
        .from(knowledgeItemTable)
        .where(and(eq(knowledgeItemTable.baseId, baseId), inArray(knowledgeItemTable.id, requestedGroupIds)))
      const existingGroupIds = new Set(existingGroupRows.map((row) => row.id))
      const missingGroupIds = requestedGroupIds.filter((groupId) => !existingGroupIds.has(groupId))

      if (missingGroupIds.length > 0) {
        throw DataApiErrorFactory.validation({
          groupId: [`Knowledge item group owner not found in base '${baseId}': ${missingGroupIds.join(', ')}`]
        })
      }
    }

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

  async delete(id: string): Promise<void> {
    const db = application.get('DbService').getDb()
    await this.getById(id)
    await db.delete(knowledgeItemTable).where(eq(knowledgeItemTable.id, id))
    logger.info('Deleted knowledge item', { id })
  }
}

export const knowledgeItemService = new KnowledgeItemService()
