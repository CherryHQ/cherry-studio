/**
 * Knowledge Item Service (DataApi v2).
 *
 * Handles CRUD operations for knowledge items stored in SQLite.
 */

import { application } from '@application'
import { knowledgeItemTable } from '@data/db/schemas/knowledge'
import { type SqliteErrorHandlers, withSqliteErrors } from '@data/db/sqliteErrors'
import type { DbType } from '@data/db/types'
import { loggerService } from '@logger'
import { DataApiErrorFactory } from '@shared/data/api'
import type { KnowledgeItemListResponse, ListKnowledgeItemsQuery } from '@shared/data/api/schemas/knowledges'
import {
  type CreateKnowledgeItemDto,
  type KnowledgeItem,
  type KnowledgeItemData,
  KnowledgeItemSchema,
  type KnowledgeItemStatus
} from '@shared/data/types/knowledge'
import { and, eq, inArray, isNull, ne, type SQL, sql } from 'drizzle-orm'

import { knowledgeBaseService } from './KnowledgeBaseService'
import { asNumericKey, decodeListCursor, encodeCursor, keysetOrdering } from './utils/keysetCursor'
import { timestampToISO } from './utils/rowMappers'

const logger = loggerService.withContext('DataApi:KnowledgeItemService')
const CONTAINER_CHILD_FAILURE_ERROR = 'One or more child items failed'

type KnowledgeItemRow = typeof knowledgeItemTable.$inferSelect
type KnowledgeItemRowLike = Omit<KnowledgeItemRow, 'data'> & {
  data: KnowledgeItemData | string
}

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

function rowToKnowledgeItem(row: KnowledgeItemRowLike): KnowledgeItem {
  const data = typeof row.data === 'string' ? (JSON.parse(row.data) as KnowledgeItemData) : row.data

  return KnowledgeItemSchema.parse({
    id: row.id,
    baseId: row.baseId,
    groupId: row.groupId,
    type: row.type,
    data,
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

  async list(baseId: string, query: ListKnowledgeItemsQuery): Promise<KnowledgeItemListResponse> {
    await knowledgeBaseService.getById(baseId)
    const { limit, type, groupId } = query

    const filterConditions: SQL[] = [eq(knowledgeItemTable.baseId, baseId), ne(knowledgeItemTable.status, 'deleting')]

    if (type !== undefined) {
      filterConditions.push(eq(knowledgeItemTable.type, type))
    }
    if (groupId !== undefined) {
      filterConditions.push(
        groupId === null ? isNull(knowledgeItemTable.groupId) : eq(knowledgeItemTable.groupId, groupId)
      )
    }

    // Keyset pagination over `(createdAt DESC, id ASC)`. One direction spec drives both the WHERE
    // predicate and the matching ORDER BY (via the shared util) so the two can't silently drift.
    const ordering = keysetOrdering(knowledgeItemTable.createdAt, knowledgeItemTable.id, { major: 'desc', tie: 'asc' })
    const conditions = [...filterConditions]
    const cursor = decodeListCursor(query.cursor, asNumericKey, 'knowledge-item')
    if (cursor) {
      conditions.push(ordering.where(cursor))
    }

    const [rows, [{ count }]] = await Promise.all([
      this.db
        .select()
        .from(knowledgeItemTable)
        .where(and(...conditions))
        .orderBy(...ordering.orderBy)
        .limit(limit + 1),
      this.db
        .select({ count: sql<number>`count(*)` })
        .from(knowledgeItemTable)
        .where(and(...filterConditions))
    ])

    const pageRows = rows.slice(0, limit)

    return {
      items: pageRows.map((row) => rowToKnowledgeItem(row)),
      total: count,
      nextCursor:
        rows.length > limit
          ? encodeCursor(pageRows[pageRows.length - 1].createdAt, pageRows[pageRows.length - 1].id)
          : undefined
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
    const selectedIdSet = new Set(selectedIds)
    const selectedItems = await Promise.all(selectedIds.map((itemId) => this.getById(itemId)))
    const invalidItem = selectedItems.find((item) => item.baseId !== baseId)

    if (invalidItem) {
      throw new Error(`Knowledge item '${invalidItem.id}' does not belong to base '${baseId}'`)
    }

    const descendantSelectedIds = new Set<string>()
    for (const itemId of selectedIds) {
      const descendants = await this.getSubtreeItems(baseId, [itemId])
      for (const descendant of descendants) {
        if (selectedIdSet.has(descendant.id)) {
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

    if (owner.type !== 'directory') {
      throw DataApiErrorFactory.validation({
        groupId: [`Knowledge item group owner must be a directory: ${groupId}`]
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

  async setSubtreeStatus(baseId: string, rootIds: string[], status: 'deleting', update?: never): Promise<string[]>
  async setSubtreeStatus(
    baseId: string,
    rootIds: string[],
    status: 'failed',
    update: FailedKnowledgeItemStatusUpdate
  ): Promise<string[]>
  async setSubtreeStatus(
    baseId: string,
    rootIds: string[],
    status: 'deleting' | 'failed',
    update: FailedKnowledgeItemStatusUpdate | undefined = undefined
  ): Promise<string[]> {
    const error = status === 'failed' ? update?.error.trim() : null

    if (status === 'failed' && !error) {
      throw DataApiErrorFactory.validation({
        error: ['Failed knowledge items must include a non-empty error']
      })
    }

    const uniqueRootIds = [...new Set(rootIds)]
    if (uniqueRootIds.length === 0) {
      return []
    }

    const dbService = application.get('DbService')
    const updatedRows = await dbService.withWriteTx(async (db) => {
      return await db.all<{ id: string; groupId: string | null }>(sql`
        WITH RECURSIVE subtree AS (
          SELECT id
          FROM knowledge_item
          WHERE base_id = ${baseId}
            AND id IN (${sql.join(
              uniqueRootIds.map((id) => sql`${id}`),
              sql`, `
            )})

          UNION ALL

          SELECT child.id
          FROM knowledge_item child
          INNER JOIN subtree parent ON child.group_id = parent.id
          WHERE child.base_id = ${baseId}
        )
        UPDATE knowledge_item
        SET status = ${status},
            error = ${error}
        WHERE base_id = ${baseId}
          AND id IN (SELECT DISTINCT id FROM subtree)
          ${status === 'failed' ? sql`AND status != 'deleting'` : sql``}
        RETURNING id, group_id AS "groupId"
      `)
    })

    const updatedIdSet = new Set(updatedRows.map((row) => row.id))
    const updatedIds = updatedRows.map((row) => row.id)

    if (status === 'failed') {
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

  async getSubtreeItems(
    baseId: string,
    rootIds: string[],
    options: GetSubtreeItemsOptions = {}
  ): Promise<KnowledgeItem[]> {
    const uniqueRootIds = [...new Set(rootIds)]
    if (uniqueRootIds.length === 0) {
      return []
    }

    const leafFilter = options.leafOnly ? sql`AND item.type IN ('file', 'url', 'note')` : sql``
    const rootFilter =
      options.includeRoots === true
        ? sql``
        : sql`AND item.id NOT IN (${sql.join(
            uniqueRootIds.map((id) => sql`${id}`),
            sql`, `
          )})`

    const rows = await this.db.all<KnowledgeItemRowLike>(sql`
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
      SELECT DISTINCT
        item.id AS id,
        item.base_id AS "baseId",
        item.group_id AS "groupId",
        item.type AS type,
        item.data AS data,
        item.status AS status,
        item.error AS error,
        item.created_at AS "createdAt",
        item.updated_at AS "updatedAt"
      FROM subtree
      INNER JOIN knowledge_item item
        ON item.id = subtree.id
        AND item.base_id = ${baseId}
      WHERE 1 = 1
        ${rootFilter}
        ${leafFilter}
    `)

    return rows.map((row) => rowToKnowledgeItem(row))
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
          status === 'failed' && updatedRow.type === 'directory'
            ? [existingRow.groupId]
            : [updatedRow.id, existingRow.groupId]
      }
    })

    await this.reconcileContainers(item.baseId, startContainerIds)
    logger.info('Updated knowledge item status', { id, status })
    return item
  }

  async updateIndexedRelativePath(id: string, indexedRelativePath: string): Promise<KnowledgeItem> {
    const dbService = application.get('DbService')
    const row = await dbService.withWriteTx(async (tx) => {
      const [existingRow] = await tx.select().from(knowledgeItemTable).where(eq(knowledgeItemTable.id, id)).limit(1)

      if (!existingRow) {
        throw DataApiErrorFactory.notFound('KnowledgeItem', id)
      }

      const existingItem = rowToKnowledgeItem(existingRow)
      if (existingItem.type !== 'file') {
        throw DataApiErrorFactory.validation({
          type: [`Knowledge item must be a file to store indexed relative path: ${id}`]
        })
      }

      const [updatedRow] = await tx
        .update(knowledgeItemTable)
        .set({
          data: {
            ...existingItem.data,
            indexedRelativePath
          }
        })
        .where(eq(knowledgeItemTable.id, id))
        .returning()

      if (!updatedRow) {
        throw DataApiErrorFactory.dataInconsistent(
          'KnowledgeItem',
          `Knowledge item indexed path update result missing for id '${id}'`
        )
      }

      return updatedRow
    })

    logger.info('Updated knowledge item indexed relative path', { id, indexedRelativePath })
    return rowToKnowledgeItem(row)
  }

  /**
   * Pin a captured url/note snapshot's base-relative path onto the item's `data`.
   * url and note store the snapshot identically — the `type` guards the call site
   * against writing the path onto the wrong item kind.
   */
  async updateSnapshotRelativePath(id: string, type: 'url' | 'note', relativePath: string): Promise<KnowledgeItem> {
    const dbService = application.get('DbService')
    const row = await dbService.withWriteTx(async (tx) => {
      const [existingRow] = await tx.select().from(knowledgeItemTable).where(eq(knowledgeItemTable.id, id)).limit(1)

      if (!existingRow) {
        throw DataApiErrorFactory.notFound('KnowledgeItem', id)
      }

      const existingItem = rowToKnowledgeItem(existingRow)
      if (existingItem.type !== type) {
        throw DataApiErrorFactory.validation({
          type: [`Knowledge item must be a ${type} to store a snapshot relative path: ${id}`]
        })
      }

      const [updatedRow] = await tx
        .update(knowledgeItemTable)
        .set({
          data: { ...existingItem.data, relativePath } as KnowledgeItemData
        })
        .where(eq(knowledgeItemTable.id, id))
        .returning()

      if (!updatedRow) {
        throw DataApiErrorFactory.dataInconsistent(
          'KnowledgeItem',
          `Knowledge item ${type} snapshot path update result missing for id '${id}'`
        )
      }

      return updatedRow
    })

    logger.info(`Updated knowledge ${type} snapshot relative path`, { id, relativePath })
    return rowToKnowledgeItem(row)
  }

  /**
   * Pin the deduped `raw/` directory prefix chosen during expansion onto a directory
   * container's `data.relativePath` (e.g. `docs` or `docs_2`). The original folder stays
   * in `data.source`; this prefix is what the UI shows and what delete removes the shell by.
   */
  async updateDirectoryRelativePath(id: string, relativePath: string): Promise<KnowledgeItem> {
    const dbService = application.get('DbService')
    const row = await dbService.withWriteTx(async (tx) => {
      const [existingRow] = await tx.select().from(knowledgeItemTable).where(eq(knowledgeItemTable.id, id)).limit(1)

      if (!existingRow) {
        throw DataApiErrorFactory.notFound('KnowledgeItem', id)
      }

      const existingItem = rowToKnowledgeItem(existingRow)
      if (existingItem.type !== 'directory') {
        throw DataApiErrorFactory.validation({
          type: [`Knowledge item must be a directory to store a directory relative path: ${id}`]
        })
      }

      const [updatedRow] = await tx
        .update(knowledgeItemTable)
        .set({
          data: { ...existingItem.data, relativePath } as KnowledgeItemData
        })
        .where(eq(knowledgeItemTable.id, id))
        .returning()

      if (!updatedRow) {
        throw DataApiErrorFactory.dataInconsistent(
          'KnowledgeItem',
          `Knowledge item directory relative path update result missing for id '${id}'`
        )
      }

      return updatedRow
    })

    logger.info('Updated knowledge directory relative path', { id, relativePath })
    return rowToKnowledgeItem(row)
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

        if (!containerRow || containerRow.type !== 'directory') {
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
