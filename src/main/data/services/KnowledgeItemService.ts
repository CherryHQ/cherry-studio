/**
 * Knowledge Item Service (DataApi v2).
 *
 * Handles CRUD operations for knowledge items stored in SQLite.
 */

import { application } from '@application'
import { fileEntryTable, fileRefTable } from '@data/db/schemas/file'
import { knowledgeItemTable } from '@data/db/schemas/knowledge'
import { type SqliteErrorHandlers, withSqliteErrors } from '@data/db/sqliteErrors'
import type { DbType } from '@data/db/types'
import { loggerService } from '@logger'
import type { OffsetPaginationResponse } from '@shared/data/api'
import { DataApiErrorFactory } from '@shared/data/api'
import type { ListKnowledgeItemsQuery } from '@shared/data/api/schemas/knowledges'
import type { FileEntryId } from '@shared/data/types/file'
import type { KnowledgeItemFileRefRole } from '@shared/data/types/file/ref'
import { knowledgeItemSourceType } from '@shared/data/types/file/ref'
import {
  type CreateKnowledgeItemDto,
  type KnowledgeItem,
  KnowledgeItemSchema,
  type KnowledgeItemStatus
} from '@shared/data/types/knowledge'
import { and, desc, eq, inArray, isNull, ne, sql } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'

import { knowledgeBaseService } from './KnowledgeBaseService'
import { timestampToISO } from './utils/rowMappers'

const logger = loggerService.withContext('DataApi:KnowledgeItemService')
const CONTAINER_CHILD_FAILURE_ERROR = 'One or more child items failed'

type KnowledgeItemRow = typeof knowledgeItemTable.$inferSelect

type FailedKnowledgeItemStatusUpdate = {
  error: string
}

type KnowledgeItemsByBaseOptions = {
  groupId?: string | null
}

type GetSubtreeItemsOptions = {
  includeRoots?: boolean
  leafOnly?: boolean
}

export type DeletingKnowledgeItemRootGroup = {
  baseId: string
  rootItemIds: string[]
}

function rowToKnowledgeItem(row: KnowledgeItemRow): KnowledgeItem {
  return KnowledgeItemSchema.parse({
    id: row.id,
    baseId: row.baseId,
    groupId: row.groupId,
    type: row.type,
    data: row.data,
    status: row.status,
    error: row.error,
    createdAt: timestampToISO(row.createdAt),
    updatedAt: timestampToISO(row.updatedAt)
  })
}

export class KnowledgeItemService {
  private get db() {
    const dbService = application.get('DbService')
    return dbService.getDb()
  }

  async list(baseId: string, query: ListKnowledgeItemsQuery): Promise<OffsetPaginationResponse<KnowledgeItem>> {
    await knowledgeBaseService.getById(baseId)
    const { page, limit, type, groupId } = query
    const offset = (page - 1) * limit
    const conditions = [eq(knowledgeItemTable.baseId, baseId), ne(knowledgeItemTable.status, 'deleting')]

    if (type !== undefined) {
      conditions.push(eq(knowledgeItemTable.type, type))
    }
    if (groupId !== undefined) {
      conditions.push(groupId === null ? isNull(knowledgeItemTable.groupId) : eq(knowledgeItemTable.groupId, groupId))
    }

    const where = and(...conditions)
    const [rows, [{ count }]] = await Promise.all([
      this.db
        .select()
        .from(knowledgeItemTable)
        .where(where)
        .orderBy(desc(knowledgeItemTable.createdAt), desc(knowledgeItemTable.id))
        .limit(limit)
        .offset(offset),
      this.db.select({ count: sql<number>`count(*)` }).from(knowledgeItemTable).where(where)
    ])

    return {
      items: rows.map((row) => rowToKnowledgeItem(row)),
      total: count,
      page: query.page
    }
  }

  async getItemsByBaseId(baseId: string, options: KnowledgeItemsByBaseOptions = {}): Promise<KnowledgeItem[]> {
    await knowledgeBaseService.getById(baseId)

    const conditions = [eq(knowledgeItemTable.baseId, baseId), ne(knowledgeItemTable.status, 'deleting')]

    if (options.groupId !== undefined) {
      conditions.push(
        options.groupId === null ? isNull(knowledgeItemTable.groupId) : eq(knowledgeItemTable.groupId, options.groupId)
      )
    }

    const where = and(...conditions)
    const rows = await this.db
      .select()
      .from(knowledgeItemTable)
      .where(where)
      .orderBy(knowledgeItemTable.createdAt, knowledgeItemTable.id)

    return rows.map((row) => rowToKnowledgeItem(row))
  }

  async getRootItemsByBaseId(baseId: string): Promise<KnowledgeItem[]> {
    return await this.getItemsByBaseId(baseId, { groupId: null })
  }

  async getOutermostSelectedItemIds(baseId: string, itemIds: string[]): Promise<string[]> {
    const selectedIds = [...new Set(itemIds)]
    const selectedItems = await Promise.all(selectedIds.map((itemId) => this.getById(itemId)))
    const invalidItem = selectedItems.find((item) => item.baseId !== baseId)

    if (invalidItem) {
      throw new Error(`Knowledge item '${invalidItem.id}' does not belong to base '${baseId}'`)
    }

    const descendantSelectedIds = new Set<string>()
    for (const itemId of selectedIds) {
      const descendants = await this.getSubtreeItems(baseId, [itemId])
      for (const descendant of descendants) {
        if (selectedIds.includes(descendant.id)) {
          descendantSelectedIds.add(descendant.id)
        }
      }
    }

    return selectedIds.filter((itemId) => !descendantSelectedIds.has(itemId))
  }

  async getDeletingRootGroups(): Promise<DeletingKnowledgeItemRootGroup[]> {
    const rows = await this.db.all<{ baseId: string; id: string }>(sql`
      SELECT child.base_id AS "baseId", child.id AS id
      FROM knowledge_item child
      LEFT JOIN knowledge_item parent
        ON parent.base_id = child.base_id
       AND parent.id = child.group_id
      WHERE child.status = 'deleting'
        AND (
          child.group_id IS NULL
          OR parent.id IS NULL
          OR parent.status != 'deleting'
        )
      ORDER BY child.base_id, child.id
    `)

    const rootIdsByBase = new Map<string, string[]>()
    for (const row of rows) {
      const rootItemIds = rootIdsByBase.get(row.baseId) ?? []
      rootItemIds.push(row.id)
      rootIdsByBase.set(row.baseId, rootItemIds)
    }

    return [...rootIdsByBase.entries()].map(([baseId, rootItemIds]) => ({ baseId, rootItemIds }))
  }

  async create(baseId: string, item: CreateKnowledgeItemDto): Promise<KnowledgeItem> {
    const dbService = application.get('DbService')
    const row = await dbService.withWriteTx(async (tx) => {
      await this.validateGroupOwnerTx(tx, baseId, item.groupId)

      if (item.type === 'file') {
        const [fileEntry] = await tx
          .select({ id: fileEntryTable.id })
          .from(fileEntryTable)
          .where(eq(fileEntryTable.id, item.data.fileEntryId))
          .limit(1)

        if (!fileEntry) {
          throw DataApiErrorFactory.notFound('FileEntry', item.data.fileEntryId)
        }
      }

      const [insertedRow] = await withSqliteErrors(
        async () =>
          await tx
            .insert(knowledgeItemTable)
            .values({
              baseId,
              groupId: item.groupId ?? null,
              type: item.type,
              data: item.data,
              status: 'idle',
              error: null
            })
            .returning(),
        {
          foreignKey: () =>
            item.groupId
              ? DataApiErrorFactory.validation({
                  groupId: [`Knowledge item group owner not found in base '${baseId}': ${item.groupId}`]
                })
              : DataApiErrorFactory.notFound('KnowledgeBase', baseId),
          check: (constraintName) =>
            DataApiErrorFactory.validation({
              _root: [
                constraintName
                  ? `Knowledge item failed CHECK constraint '${constraintName}'`
                  : 'Knowledge item failed a CHECK constraint'
              ]
            })
        } satisfies SqliteErrorHandlers
      )

      if (!insertedRow) {
        throw DataApiErrorFactory.dataInconsistent('KnowledgeItem', 'Knowledge item create result missing')
      }

      if (item.type === 'file') {
        const now = Date.now()
        await tx.insert(fileRefTable).values({
          id: uuidv4(),
          fileEntryId: item.data.fileEntryId,
          sourceType: knowledgeItemSourceType,
          sourceId: insertedRow.id,
          role: 'source',
          createdAt: now,
          updatedAt: now
        })
      }

      return insertedRow
    })

    logger.info('Created knowledge item', { baseId, id: row.id, type: row.type })
    return rowToKnowledgeItem(row)
  }

  private async validateGroupOwnerTx(
    db: Pick<DbType, 'select'>,
    baseId: string,
    groupId: string | null | undefined
  ): Promise<void> {
    if (groupId == null) {
      return
    }

    if (groupId.trim().length === 0) {
      throw DataApiErrorFactory.validation({
        groupId: ['Knowledge item group owner id is required when groupId is provided']
      })
    }

    const [owner] = await db
      .select({
        type: knowledgeItemTable.type,
        status: knowledgeItemTable.status
      })
      .from(knowledgeItemTable)
      .where(and(eq(knowledgeItemTable.baseId, baseId), eq(knowledgeItemTable.id, groupId)))
      .limit(1)

    if (!owner) {
      throw DataApiErrorFactory.validation({
        groupId: [`Knowledge item group owner not found in base '${baseId}': ${groupId}`]
      })
    }

    if (owner.type !== 'directory' && owner.type !== 'sitemap') {
      throw DataApiErrorFactory.validation({
        groupId: [`Knowledge item group owner must be a directory or sitemap: ${groupId}`]
      })
    }

    if (owner.status === 'deleting') {
      throw DataApiErrorFactory.validation({
        groupId: [`Knowledge item group owner is being deleted: ${groupId}`]
      })
    }
  }

  async getById(id: string): Promise<KnowledgeItem> {
    const [row] = await this.db.select().from(knowledgeItemTable).where(eq(knowledgeItemTable.id, id)).limit(1)

    if (!row) {
      throw DataApiErrorFactory.notFound('KnowledgeItem', id)
    }

    return rowToKnowledgeItem(row)
  }

  async setSubtreeStatus(
    baseId: string,
    rootIds: string[],
    status: Exclude<KnowledgeItemStatus, 'failed'>,
    update?: never
  ): Promise<string[]>
  async setSubtreeStatus(
    baseId: string,
    rootIds: string[],
    status: 'failed',
    update: FailedKnowledgeItemStatusUpdate
  ): Promise<string[]>
  async setSubtreeStatus(
    baseId: string,
    rootIds: string[],
    status: KnowledgeItemStatus,
    update: FailedKnowledgeItemStatusUpdate | undefined = undefined
  ): Promise<string[]> {
    const error = status === 'failed' ? update?.error.trim() : null

    if (status === 'failed' && !error) {
      throw DataApiErrorFactory.validation({
        error: ['Failed knowledge items must include a non-empty error']
      })
    }

    const subtreeIds = await this.getSubtreeItemIds(baseId, rootIds, { includeRoots: true })
    if (subtreeIds.length === 0) {
      return []
    }

    const dbService = application.get('DbService')
    const updatedRows = await dbService.withWriteTx(async (tx) => {
      const conditions = [eq(knowledgeItemTable.baseId, baseId), inArray(knowledgeItemTable.id, subtreeIds)]
      if (status !== 'deleting') {
        conditions.push(ne(knowledgeItemTable.status, 'deleting'))
      }

      return await tx
        .update(knowledgeItemTable)
        .set({ status, error })
        .where(and(...conditions))
        .returning({
          id: knowledgeItemTable.id,
          groupId: knowledgeItemTable.groupId
        })
    })

    const updatedIds = status === 'deleting' ? subtreeIds : await this.getNonDeletingItemIds(baseId, subtreeIds)

    if (status !== 'deleting') {
      const updatedIdSet = new Set(updatedRows.map((row) => row.id))
      await this.reconcileContainers(
        baseId,
        updatedRows.map((row) => row.groupId).filter((groupId) => !updatedIdSet.has(groupId ?? ''))
      )
    }

    logger.info('Updated knowledge item subtree status', { baseId, rootIds, status, count: updatedIds.length })
    return updatedIds
  }

  async deleteItemsByIds(baseId: string, itemIds: string[]): Promise<void> {
    const uniqueItemIds = [...new Set(itemIds)]
    if (uniqueItemIds.length === 0) {
      return
    }

    const dbService = application.get('DbService')
    const deleted = await dbService.withWriteTx(async (tx) => {
      const targetRows = await tx
        .select({ groupId: knowledgeItemTable.groupId })
        .from(knowledgeItemTable)
        .where(and(eq(knowledgeItemTable.baseId, baseId), inArray(knowledgeItemTable.id, uniqueItemIds)))
      await tx
        .delete(fileRefTable)
        .where(and(eq(fileRefTable.sourceType, knowledgeItemSourceType), inArray(fileRefTable.sourceId, uniqueItemIds)))
      await tx
        .delete(knowledgeItemTable)
        .where(and(eq(knowledgeItemTable.baseId, baseId), inArray(knowledgeItemTable.id, uniqueItemIds)))
      return {
        rowsAffected: targetRows.length,
        groupIds: targetRows.map((row) => row.groupId)
      }
    })

    await this.reconcileContainers(baseId, deleted.groupIds)

    logger.info('Deleted knowledge items by ids', { baseId, count: deleted.rowsAffected })
  }

  async detachFileRefs(itemIds: string[]): Promise<FileEntryId[]> {
    const uniqueItemIds = [...new Set(itemIds)]
    if (uniqueItemIds.length === 0) {
      return []
    }

    const dbService = application.get('DbService')
    const detachedRefs = await dbService.withWriteTx(
      async (tx) =>
        await tx
          .delete(fileRefTable)
          .where(
            and(eq(fileRefTable.sourceType, knowledgeItemSourceType), inArray(fileRefTable.sourceId, uniqueItemIds))
          )
          .returning({ fileEntryId: fileRefTable.fileEntryId })
    )

    const detachedFileEntryIds = [...new Set(detachedRefs.map((row) => row.fileEntryId))]
    logger.info('Detached knowledge item file refs', { count: detachedRefs.length, itemCount: uniqueItemIds.length })
    return detachedFileEntryIds
  }

  async attachFileRef(itemId: string, fileEntryId: FileEntryId, role: KnowledgeItemFileRefRole): Promise<void> {
    const dbService = application.get('DbService')
    await dbService.withWriteTx(async (tx) => {
      const [item] = await tx
        .select({ id: knowledgeItemTable.id })
        .from(knowledgeItemTable)
        .where(eq(knowledgeItemTable.id, itemId))
        .limit(1)
      if (!item) {
        throw DataApiErrorFactory.notFound('KnowledgeItem', itemId)
      }

      const [fileEntry] = await tx
        .select({ id: fileEntryTable.id })
        .from(fileEntryTable)
        .where(eq(fileEntryTable.id, fileEntryId))
        .limit(1)
      if (!fileEntry) {
        throw DataApiErrorFactory.notFound('FileEntry', fileEntryId)
      }

      const now = Date.now()
      await tx
        .insert(fileRefTable)
        .values({
          id: uuidv4(),
          fileEntryId,
          sourceType: knowledgeItemSourceType,
          sourceId: itemId,
          role,
          createdAt: now,
          updatedAt: now
        })
        .onConflictDoNothing()
    })
    logger.info('Attached knowledge item file ref', { itemId, fileEntryId, role })
  }

  async getSubtreeItems(
    baseId: string,
    rootIds: string[],
    options: GetSubtreeItemsOptions = {}
  ): Promise<KnowledgeItem[]> {
    const subtreeIds = await this.getSubtreeItemIds(baseId, rootIds, options)
    if (subtreeIds.length === 0) {
      return []
    }

    const rows = await this.db
      .select()
      .from(knowledgeItemTable)
      .where(and(eq(knowledgeItemTable.baseId, baseId), inArray(knowledgeItemTable.id, subtreeIds)))
    const rowsById = new Map(rows.map((row) => [row.id, row]))

    return subtreeIds.map((id) => {
      const row = rowsById.get(id)

      if (!row) {
        throw DataApiErrorFactory.dataInconsistent('KnowledgeItem', `Subtree row missing for id '${id}'`)
      }

      return rowToKnowledgeItem(row)
    })
  }

  private async getSubtreeItemIds(
    baseId: string,
    rootIds: string[],
    options: GetSubtreeItemsOptions = {}
  ): Promise<string[]> {
    const uniqueRootIds = [...new Set(rootIds)]
    if (uniqueRootIds.length === 0) {
      return []
    }

    const leafFilter = options.leafOnly ? sql`AND type IN ('file', 'url', 'note')` : sql``
    const rootFilter =
      options.includeRoots === true
        ? sql``
        : sql`AND id NOT IN (${sql.join(
            uniqueRootIds.map((id) => sql`${id}`),
            sql`, `
          )})`

    const rows = await this.db.all<{ id: string }>(sql`
      WITH RECURSIVE subtree AS (
        SELECT id, type
        FROM knowledge_item
        WHERE base_id = ${baseId}
          AND id IN (${sql.join(
            uniqueRootIds.map((id) => sql`${id}`),
            sql`, `
          )})

        UNION ALL

        SELECT child.id, child.type
        FROM knowledge_item child
        INNER JOIN subtree parent ON child.group_id = parent.id
        WHERE child.base_id = ${baseId}
      )
      SELECT DISTINCT id
      FROM subtree
      WHERE 1 = 1
        ${rootFilter}
        ${leafFilter}
    `)

    return rows.map((row) => row.id)
  }

  async updateStatus(id: string, status: Exclude<KnowledgeItemStatus, 'failed'>, update?: never): Promise<KnowledgeItem>
  async updateStatus(id: string, status: 'failed', update: FailedKnowledgeItemStatusUpdate): Promise<KnowledgeItem>
  async updateStatus(
    id: string,
    status: KnowledgeItemStatus,
    update: FailedKnowledgeItemStatusUpdate | undefined = undefined
  ): Promise<KnowledgeItem> {
    // Per-type status legality is enforced by the DB CHECK constraint.
    const error = status === 'failed' ? update?.error.trim() : null

    if (status === 'failed' && !error) {
      throw DataApiErrorFactory.validation({
        error: ['Failed knowledge items must include a non-empty error']
      })
    }

    const dbService = application.get('DbService')
    const { item, startContainerIds } = await dbService.withWriteTx(async (tx) => {
      const [existingRow] = await tx.select().from(knowledgeItemTable).where(eq(knowledgeItemTable.id, id)).limit(1)

      if (!existingRow) {
        throw DataApiErrorFactory.notFound('KnowledgeItem', id)
      }

      if (existingRow.status === 'deleting' && status !== 'deleting') {
        return {
          item: rowToKnowledgeItem(existingRow),
          startContainerIds: []
        }
      }

      const [updatedRow] = await tx
        .update(knowledgeItemTable)
        .set({ status, error })
        .where(eq(knowledgeItemTable.id, id))
        .returning()

      if (!updatedRow) {
        throw DataApiErrorFactory.dataInconsistent(
          'KnowledgeItem',
          `Knowledge item status update result missing for id '${id}'`
        )
      }

      return {
        item: rowToKnowledgeItem(updatedRow),
        startContainerIds:
          status === 'failed' && (updatedRow.type === 'directory' || updatedRow.type === 'sitemap')
            ? [existingRow.groupId]
            : [updatedRow.id, existingRow.groupId]
      }
    })

    await this.reconcileContainers(item.baseId, startContainerIds)
    logger.info('Updated knowledge item status', { id, status })
    return item
  }

  private async getNonDeletingItemIds(baseId: string, itemIds: string[]): Promise<string[]> {
    if (itemIds.length === 0) {
      return []
    }

    const rows = await this.db
      .select({ id: knowledgeItemTable.id })
      .from(knowledgeItemTable)
      .where(
        and(
          eq(knowledgeItemTable.baseId, baseId),
          inArray(knowledgeItemTable.id, itemIds),
          ne(knowledgeItemTable.status, 'deleting')
        )
      )
    const activeIds = new Set(rows.map((row) => row.id))
    return itemIds.filter((id) => activeIds.has(id))
  }

  private async reconcileContainers(
    baseId: string,
    startContainerIds: Array<string | null | undefined>
  ): Promise<void> {
    const dbService = application.get('DbService')
    await dbService.withWriteTx(async (tx) => {
      const queue = [...new Set(startContainerIds.filter((id): id is string => Boolean(id)))]
      const visited = new Set<string>()

      while (queue.length > 0) {
        const containerId = queue.shift()
        if (!containerId || visited.has(containerId)) {
          continue
        }
        visited.add(containerId)

        const [containerRow] = await tx
          .select()
          .from(knowledgeItemTable)
          .where(and(eq(knowledgeItemTable.baseId, baseId), eq(knowledgeItemTable.id, containerId)))
          .limit(1)

        if (!containerRow || (containerRow.type !== 'directory' && containerRow.type !== 'sitemap')) {
          continue
        }

        if (containerRow.status === 'deleting') {
          continue
        }

        if (containerRow.status === 'preparing') {
          if (containerRow.groupId) {
            queue.push(containerRow.groupId)
          }
          continue
        }

        const [stats] = await tx
          .select({
            activeCount: sql<number>`sum(case when ${knowledgeItemTable.status} not in ('completed', 'failed', 'deleting') then 1 else 0 end)`,
            failedCount: sql<number>`sum(case when ${knowledgeItemTable.status} = 'failed' then 1 else 0 end)`
          })
          .from(knowledgeItemTable)
          .where(and(eq(knowledgeItemTable.baseId, baseId), eq(knowledgeItemTable.groupId, containerId)))

        if (Number(stats?.activeCount ?? 0) > 0) {
          await tx
            .update(knowledgeItemTable)
            .set({ status: 'processing', error: null })
            .where(and(eq(knowledgeItemTable.baseId, baseId), eq(knowledgeItemTable.id, containerId)))

          if (containerRow.groupId) {
            queue.push(containerRow.groupId)
          }
          continue
        }

        const nextStatus: KnowledgeItemStatus = Number(stats?.failedCount ?? 0) > 0 ? 'failed' : 'completed'
        await tx
          .update(knowledgeItemTable)
          .set({ status: nextStatus, error: nextStatus === 'failed' ? CONTAINER_CHILD_FAILURE_ERROR : null })
          .where(and(eq(knowledgeItemTable.baseId, baseId), eq(knowledgeItemTable.id, containerId)))

        if (containerRow.groupId) {
          queue.push(containerRow.groupId)
        }
      }
    })
  }

  async delete(id: string): Promise<void> {
    const dbService = application.get('DbService')
    const deleted = await dbService.withWriteTx(async (tx) => {
      const [existingRow] = await tx.select().from(knowledgeItemTable).where(eq(knowledgeItemTable.id, id)).limit(1)

      if (!existingRow) {
        throw DataApiErrorFactory.notFound('KnowledgeItem', id)
      }

      await tx.run(sql`
        WITH RECURSIVE subtree AS (
          SELECT id
          FROM knowledge_item
          WHERE base_id = ${existingRow.baseId}
            AND id = ${id}

          UNION ALL

          SELECT child.id
          FROM knowledge_item child
          INNER JOIN subtree parent ON child.group_id = parent.id
          WHERE child.base_id = ${existingRow.baseId}
        )
        DELETE FROM file_ref
        WHERE source_type = ${knowledgeItemSourceType}
          AND source_id IN (SELECT DISTINCT id FROM subtree)
      `)

      const [row] = await tx.delete(knowledgeItemTable).where(eq(knowledgeItemTable.id, id)).returning({
        id: knowledgeItemTable.id
      })

      if (!row) {
        throw DataApiErrorFactory.notFound('KnowledgeItem', id)
      }

      return { baseId: existingRow.baseId, groupId: existingRow.groupId }
    })

    await this.reconcileContainers(deleted.baseId, [deleted.groupId])
    logger.info('Deleted knowledge item', { id })
  }
}

export const knowledgeItemService = new KnowledgeItemService()
