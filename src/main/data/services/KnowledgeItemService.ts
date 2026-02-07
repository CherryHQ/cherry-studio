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
import type {
  DirectoryContainerData,
  ItemStatus,
  KnowledgeItem,
  KnowledgeItemData,
  KnowledgeItemTreeNode,
  KnowledgeItemType
} from '@shared/data/types/knowledge'
import { and, desc, eq, inArray, sql } from 'drizzle-orm'

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
    updatedAt: row.updatedAt ? new Date(row.updatedAt).toISOString() : new Date().toISOString(),
    progress: knowledgeOrchestrator.getProgress(row.id)
  }
}

function isDirectoryContainerData(data: KnowledgeItemData): data is DirectoryContainerData {
  return (
    typeof data === 'object' &&
    data !== null &&
    'path' in data &&
    typeof data.path === 'string' &&
    'recursive' in data &&
    typeof data.recursive === 'boolean'
  )
}

function shouldProcessItem(item: { type: KnowledgeItemType; data: KnowledgeItemData }): boolean {
  return !(item.type === 'directory' && isDirectoryContainerData(item.data))
}

export function buildKnowledgeItemTree(items: KnowledgeItem[]): KnowledgeItemTreeNode[] {
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

  /**
   * List knowledge items for a base as tree structure.
   */
  async list(baseId: string): Promise<KnowledgeItemTreeNode[]> {
    const items = await this.listFlat(baseId)
    return buildKnowledgeItemTree(items)
  }

  /**
   * List all knowledge items for a base as a flat array.
   */
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

  /**
   * Create multiple knowledge items for a base
   */
  async create(baseId: string, dto: CreateKnowledgeItemsDto): Promise<{ items: KnowledgeItem[] }> {
    const db = dbService.getDb()

    if (!dto.items || dto.items.length === 0) {
      throw DataApiErrorFactory.validation({ items: ['At least one item is required'] })
    }

    const base = await knowledgeBaseService.getById(baseId)

    const items = await db.transaction(async (tx) => {
      const parentIds = Array.from(new Set(dto.items.map((item) => item.parentId).filter((id): id is string => !!id)))

      if (parentIds.length > 0) {
        const parentRows = await tx
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
        status: shouldProcessItem(item) ? ('pending' as ItemStatus) : ('completed' as ItemStatus),
        error: null
      }))

      const rows = await tx.insert(knowledgeItemTable).values(values).returning()
      return rows.map((row) => rowToKnowledgeItem(row))
    })

    // Dispatch orchestrator processing after transaction commits
    // to ensure items exist in DB before processing starts
    for (const item of items) {
      if (!shouldProcessItem(item)) {
        continue
      }

      void knowledgeOrchestrator.process({
        base,
        item,
        onStatusChange: async (status, error) => {
          await this.update(item.id, { status, error })
        }
      })
    }

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
   * Reprocess a knowledge item.
   *
   * For directory container nodes, reprocesses all descendant file nodes.
   */
  async reprocess(id: string): Promise<KnowledgeItem> {
    const item = await this.getById(id)
    const base = await knowledgeBaseService.getById(item.baseId)

    if (item.type === 'directory' && isDirectoryContainerData(item.data)) {
      const descendants = await this.getDescendantItems(item.baseId, item.id)
      const fileItems = descendants.filter((descendant) => descendant.type === 'file')

      for (const fileItem of fileItems) {
        await this.reprocessSingle(base, fileItem)
      }

      logger.info('Triggered directory reprocessing for knowledge item', { id, fileCount: fileItems.length })
      return item
    }

    return await this.reprocessSingle(base, item)
  }

  private async reprocessSingle(base: Awaited<ReturnType<typeof knowledgeBaseService.getById>>, item: KnowledgeItem) {
    const db = dbService.getDb()

    knowledgeOrchestrator.cancel(item.id)
    knowledgeOrchestrator.clearProgress(item.id)

    const [row] = await db
      .update(knowledgeItemTable)
      .set({ status: 'pending', error: null })
      .where(eq(knowledgeItemTable.id, item.id))
      .returning()

    const updatedItem = rowToKnowledgeItem(row)
    const onStatusChange = async (status: ItemStatus, error: string | null) => {
      await this.update(item.id, { status, error })
    }

    await knowledgeOrchestrator.removeVectors(base, updatedItem)
    await knowledgeOrchestrator.process({
      base,
      item: updatedItem,
      onStatusChange
    })

    logger.info('Triggered reprocessing for knowledge item', { id: item.id })

    return updatedItem
  }

  /**
   * Delete knowledge item and all descendants.
   */
  async delete(id: string): Promise<void> {
    const db = dbService.getDb()

    const item = await this.getById(id)
    const base = await knowledgeBaseService.getById(item.baseId)

    const descendantIds = await this.getDescendantIds(id)
    const allIds = [id, ...descendantIds]

    const rows = await db.select().from(knowledgeItemTable).where(inArray(knowledgeItemTable.id, allIds))
    const itemsToDelete = rows.map((row) => rowToKnowledgeItem(row))

    for (const target of itemsToDelete) {
      knowledgeOrchestrator.cancel(target.id)
      knowledgeOrchestrator.clearProgress(target.id)
      await knowledgeOrchestrator.removeVectors(base, target)
    }

    await db.delete(knowledgeItemTable).where(inArray(knowledgeItemTable.id, allIds))

    logger.info('Deleted knowledge item tree', { id, count: allIds.length })
  }

  private async getDescendantIds(id: string): Promise<string[]> {
    const db = dbService.getDb()

    const result = await db.all<{ id: string }>(sql`
      WITH RECURSIVE descendants AS (
        SELECT id FROM knowledge_item WHERE parent_id = ${id}
        UNION ALL
        SELECT ki.id FROM knowledge_item ki
        INNER JOIN descendants d ON ki.parent_id = d.id
      )
      SELECT id FROM descendants
    `)

    return result.map((row) => row.id)
  }

  private async getDescendantItems(baseId: string, id: string): Promise<KnowledgeItem[]> {
    const db = dbService.getDb()
    const descendantIds = await this.getDescendantIds(id)

    if (descendantIds.length === 0) {
      return []
    }

    const rows = await db
      .select()
      .from(knowledgeItemTable)
      .where(and(eq(knowledgeItemTable.baseId, baseId), inArray(knowledgeItemTable.id, descendantIds)))

    return rows.map((row) => rowToKnowledgeItem(row))
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

    return rows
      .filter((row) => !knowledgeOrchestrator.isQueued(row.id) && !knowledgeOrchestrator.isProcessing(row.id))
      .map(rowToKnowledgeItem)
  }

  /**
   * Get queue status for a knowledge base.
   */
  async getQueueStatus(baseId: string): Promise<BaseQueueStatus> {
    await knowledgeBaseService.getById(baseId)

    const orphanItems = await this.getOrphanItems(baseId)
    const allItems = await this.listFlat(baseId)

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

    const processableOrphans = orphanItems.filter((item) => shouldProcessItem(item))

    // Mark non-processable orphans (e.g. directory containers) as completed
    for (const item of orphanItems) {
      if (!shouldProcessItem(item)) {
        await this.update(item.id, { status: 'completed', error: null })
      }
    }

    for (const item of processableOrphans) {
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

    logger.info('Recovered orphan items', { baseId, count: processableOrphans.length })
    return { recoveredCount: processableOrphans.length }
  }

  /**
   * Ignore orphan items by marking them as failed.
   */
  async ignoreOrphans(baseId: string): Promise<IgnoreResponse> {
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
