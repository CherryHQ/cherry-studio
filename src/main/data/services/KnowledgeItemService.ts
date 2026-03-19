/**
 * Knowledge Item Service (DataApi v2).
 *
 * Handles CRUD operations for knowledge items stored in SQLite.
 */

import { dbService } from '@data/db/DbService'
import { knowledgeItemTable } from '@data/db/schemas/knowledge'
import { loggerService } from '@logger'
import { DataApiErrorFactory } from '@shared/data/api'
import type { CreateKnowledgeItemsDto, UpdateKnowledgeItemDto } from '@shared/data/api/schemas/knowledges'
import type { ItemStatus, KnowledgeItem, KnowledgeItemData, KnowledgeItemTreeNode } from '@shared/data/types/knowledge'
import { desc, eq, inArray } from 'drizzle-orm'

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
    parentId: row.parentId ?? null,
    type: row.type,
    data: parseJson(row.data) as KnowledgeItemData,
    status: row.status ?? 'idle',
    error: row.error ?? undefined,
    createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : new Date().toISOString(),
    updatedAt: row.updatedAt ? new Date(row.updatedAt).toISOString() : new Date().toISOString()
  }
}

function buildKnowledgeItemTree(items: KnowledgeItem[]): KnowledgeItemTreeNode[] {
  const childrenMap = new Map<string | null, KnowledgeItem[]>()

  for (const item of items) {
    const parentId = item.parentId ?? null
    if (!childrenMap.has(parentId)) {
      childrenMap.set(parentId, [])
    }
    childrenMap.get(parentId)!.push(item)
  }

  const roots = childrenMap.get(null) ?? []

  const buildNode = (item: KnowledgeItem, path: Set<string>): KnowledgeItemTreeNode => {
    const children = childrenMap.get(item.id) ?? []
    const nextPath = new Set(path)
    nextPath.add(item.id)

    return {
      item,
      children: children.filter((child) => !nextPath.has(child.id)).map((child) => buildNode(child, nextPath))
    }
  }

  return roots.map((root) => buildNode(root, new Set()))
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

  async list(baseId: string): Promise<KnowledgeItemTreeNode[]> {
    const items = await this.listFlat(baseId)
    return buildKnowledgeItemTree(items)
  }

  private async listFlat(baseId: string): Promise<KnowledgeItem[]> {
    const db = dbService.getDb()
    await knowledgeBaseService.getById(baseId)

    const rows = await db
      .select()
      .from(knowledgeItemTable)
      .where(eq(knowledgeItemTable.baseId, baseId))
      .orderBy(desc(knowledgeItemTable.createdAt))

    return rows.map((row) => rowToKnowledgeItem(row))
  }

  async create(baseId: string, dto: CreateKnowledgeItemsDto): Promise<{ items: KnowledgeItem[] }> {
    const db = dbService.getDb()
    await knowledgeBaseService.getById(baseId)

    if (!dto.items || dto.items.length === 0) {
      throw DataApiErrorFactory.validation({ items: ['At least one item is required'] })
    }
    for (const [index, item] of dto.items.entries()) {
      if (item.data === undefined || item.data === null) {
        throw DataApiErrorFactory.validation({
          [`items.${index}.data`]: ['Item data is required']
        })
      }
    }

    const parentIds = Array.from(new Set(dto.items.map((item) => item.parentId).filter((id): id is string => !!id)))

    if (parentIds.length > 0) {
      const parentRows = await db
        .select({ id: knowledgeItemTable.id, baseId: knowledgeItemTable.baseId })
        .from(knowledgeItemTable)
        .where(inArray(knowledgeItemTable.id, parentIds))

      const parentMap = new Map(parentRows.map((row) => [row.id, row]))

      for (const parentId of parentIds) {
        const parent = parentMap.get(parentId)
        if (!parent) {
          throw DataApiErrorFactory.notFound('KnowledgeItem', parentId)
        }
        if (parent.baseId !== baseId) {
          throw DataApiErrorFactory.invalidOperation(
            'create knowledge item',
            'Parent knowledge item does not belong to this knowledge base'
          )
        }
      }
    }

    const values = dto.items.map((item) => ({
      baseId,
      parentId: item.parentId ?? null,
      type: item.type,
      data: item.data,
      status: 'idle' as ItemStatus,
      error: null
    }))

    const rows = await db.insert(knowledgeItemTable).values(values).returning()
    const items = rows.map((row) => rowToKnowledgeItem(row))

    logger.info('Created knowledge items', { baseId, count: items.length })
    return { items }
  }

  async getById(id: string): Promise<KnowledgeItem> {
    const db = dbService.getDb()
    const [row] = await db.select().from(knowledgeItemTable).where(eq(knowledgeItemTable.id, id)).limit(1)

    if (!row) {
      throw DataApiErrorFactory.notFound('KnowledgeItem', id)
    }

    return rowToKnowledgeItem(row)
  }

  async update(id: string, dto: UpdateKnowledgeItemDto): Promise<KnowledgeItem> {
    const db = dbService.getDb()
    await this.getById(id)

    const updates: Partial<typeof knowledgeItemTable.$inferInsert> = {}
    if (dto.data !== undefined) updates.data = dto.data
    if (dto.status !== undefined) updates.status = dto.status
    if (dto.error !== undefined) updates.error = dto.error

    if (Object.keys(updates).length === 0) {
      throw DataApiErrorFactory.validation({ body: ['At least one field is required'] })
    }

    const [row] = await db.update(knowledgeItemTable).set(updates).where(eq(knowledgeItemTable.id, id)).returning()
    logger.info('Updated knowledge item', { id, changes: Object.keys(dto) })
    return rowToKnowledgeItem(row)
  }

  async delete(id: string): Promise<void> {
    const db = dbService.getDb()
    await this.getById(id)
    await db.delete(knowledgeItemTable).where(eq(knowledgeItemTable.id, id))
    logger.info('Deleted knowledge item', { id })
  }
}

export const knowledgeItemService = KnowledgeItemService.getInstance()
