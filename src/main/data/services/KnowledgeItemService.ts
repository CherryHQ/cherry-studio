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

import { knowledgeBaseService } from './KnowledgeBaseService'

const logger = loggerService.withContext('DataApi:KnowledgeItemService')

const KNOWLEDGE_ITEM_DATA_SCHEMAS = {
  file: FileItemDataSchema,
  url: UrlItemDataSchema,
  note: NoteItemDataSchema,
  sitemap: SitemapItemDataSchema,
  directory: DirectoryItemDataSchema
} as const

function getCreateKnowledgeItemGroupingErrors(
  plannedItems: CreateKnowledgeItemsDto['items']
): Record<string, string[]> {
  const itemsByRef = new Map(
    plannedItems
      .filter((item): item is (typeof plannedItems)[number] & { ref: string } => typeof item.ref === 'string')
      .map((item) => [item.ref, item] as const)
  )

  for (const item of plannedItems) {
    if (item.ref && item.groupRef === item.ref) {
      return {
        groupRef: ['Knowledge item cannot reference itself as group owner']
      }
    }
  }

  const visitState = new Map<string, 'visiting' | 'visited'>()

  const hasCycle = (ref: string): boolean => {
    const state = visitState.get(ref)
    if (state === 'visiting') {
      return true
    }
    if (state === 'visited') {
      return false
    }

    visitState.set(ref, 'visiting')

    const targetRef = itemsByRef.get(ref)?.groupRef
    if (targetRef && itemsByRef.has(targetRef) && hasCycle(targetRef)) {
      return true
    }

    visitState.set(ref, 'visited')
    return false
  }

  for (const ref of itemsByRef.keys()) {
    if (hasCycle(ref)) {
      return {
        groupRef: ['Knowledge item grouping cannot contain cycles within one request batch']
      }
    }
  }

  return {}
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

    const groupingErrors = getCreateKnowledgeItemGroupingErrors(dto.items)
    if (Object.keys(groupingErrors).length > 0) {
      throw DataApiErrorFactory.validation(groupingErrors)
    }

    const plannedItems = dto.items.map((item, index) => {
      const parsed = KNOWLEDGE_ITEM_DATA_SCHEMAS[item.type].safeParse(item.data)
      if (!parsed.success) {
        throw DataApiErrorFactory.validation({
          [`items.${index}.data`]: [`Data payload does not match knowledge item type '${item.type}'`]
        })
      }

      return {
        ...item,
        parsedData: parsed.data,
        index
      }
    })

    const requestedGroupIds = [
      ...new Set(plannedItems.map((item) => item.groupId).filter((groupId) => groupId != null))
    ]
    const itemsByRef = new Map<string, KnowledgeItem>()
    const createdItems = new Map<number, KnowledgeItem>()

    await db.transaction(async (tx) => {
      if (requestedGroupIds.length > 0) {
        const existingGroupRows = await tx
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

      const pendingItems = [...plannedItems]

      while (pendingItems.length > 0) {
        const readyItems = pendingItems.filter((item) => item.groupRef == null || itemsByRef.has(item.groupRef))

        if (readyItems.length === 0) {
          throw DataApiErrorFactory.validation({
            groupRef: ['Knowledge item grouping cannot contain unresolved references within one request batch']
          })
        }

        for (const item of readyItems) {
          const groupId = item.groupRef ? (itemsByRef.get(item.groupRef)?.id ?? null) : (item.groupId ?? null)
          const [row] = await tx
            .insert(knowledgeItemTable)
            .values({
              baseId,
              groupId,
              type: item.type,
              data: item.parsedData,
              status: 'idle',
              error: null
            })
            .returning()

          const createdItem = rowToKnowledgeItem(row)
          createdItems.set(item.index, createdItem)

          if (item.ref) {
            itemsByRef.set(item.ref, createdItem)
          }
        }

        const readyIndices = new Set(readyItems.map((item) => item.index))
        for (let index = pendingItems.length - 1; index >= 0; index -= 1) {
          if (readyIndices.has(pendingItems[index].index)) {
            pendingItems.splice(index, 1)
          }
        }
      }
    })

    const items = plannedItems.map((item) => {
      const createdItem = createdItems.get(item.index)
      if (!createdItem) {
        throw DataApiErrorFactory.dataInconsistent(
          'KnowledgeItem',
          `Knowledge item create result missing for index '${item.index}'`
        )
      }

      return createdItem
    })

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
