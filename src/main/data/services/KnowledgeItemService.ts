/**
 * Knowledge Item Service (DataApi v2).
 *
 * Handles CRUD operations for knowledge items stored in SQLite.
 */

import { application } from '@application'
import { knowledgeItemTable } from '@data/db/schemas/knowledge'
import { type SqliteErrorHandlers, withSqliteErrors } from '@data/db/sqliteErrors'
import { loggerService } from '@logger'
import type { OffsetPaginationResponse } from '@shared/data/api'
import { DataApiErrorFactory } from '@shared/data/api'
import type { ListKnowledgeItemsQuery } from '@shared/data/api/schemas/knowledges'
import {
  type CreateKnowledgeItemDto,
  type KnowledgeItem,
  type KnowledgeItemPhase,
  KnowledgeItemSchema,
  type KnowledgeItemStatus
} from '@shared/data/types/knowledge'
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm'

import { knowledgeBaseService } from './KnowledgeBaseService'
import { timestampToISO } from './utils/rowMappers'

const logger = loggerService.withContext('DataApi:KnowledgeItemService')
const CONTAINER_CHILD_FAILURE_ERROR = 'One or more child items failed'

type KnowledgeItemRow = typeof knowledgeItemTable.$inferSelect

type KnowledgeItemStatusUpdate = {
  phase?: KnowledgeItemPhase | null
}

type FailedKnowledgeItemStatusUpdate = {
  error: string
}

type KnowledgeItemsByBaseOptions = {
  groupId?: string | null
}

function rowToKnowledgeItem(row: KnowledgeItemRow): KnowledgeItem {
  return KnowledgeItemSchema.parse({
    id: row.id,
    baseId: row.baseId,
    groupId: row.groupId,
    type: row.type,
    data: row.data,
    status: row.status,
    phase: row.phase,
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
    const conditions = [eq(knowledgeItemTable.baseId, baseId)]

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

    const conditions = [eq(knowledgeItemTable.baseId, baseId)]

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

  async create(baseId: string, item: CreateKnowledgeItemDto): Promise<KnowledgeItem> {
    await this.validateGroupOwner(baseId, item.groupId)

    const [row] = await this.db.transaction(async (tx) =>
      withSqliteErrors(
        () =>
          tx
            .insert(knowledgeItemTable)
            .values({
              baseId,
              groupId: item.groupId ?? null,
              type: item.type,
              data: item.data,
              status: 'idle',
              phase: null,
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
    )

    if (!row) {
      throw DataApiErrorFactory.dataInconsistent('KnowledgeItem', 'Knowledge item create result missing')
    }

    logger.info('Created knowledge item', { baseId, id: row.id, type: row.type })
    return rowToKnowledgeItem(row)
  }

  private async validateGroupOwner(baseId: string, groupId: string | null | undefined): Promise<void> {
    if (groupId == null) {
      return
    }

    if (groupId.trim().length === 0) {
      throw DataApiErrorFactory.validation({
        groupId: ['Knowledge item group owner id is required when groupId is provided']
      })
    }

    const [owner] = await this.db
      .select({
        type: knowledgeItemTable.type
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
  }

  async getById(id: string): Promise<KnowledgeItem> {
    const [row] = await this.db.select().from(knowledgeItemTable).where(eq(knowledgeItemTable.id, id)).limit(1)

    if (!row) {
      throw DataApiErrorFactory.notFound('KnowledgeItem', id)
    }

    return rowToKnowledgeItem(row)
  }

  async getLeafDescendantItems(baseId: string, rootIds: string[]): Promise<KnowledgeItem[]> {
    const leafIds = await this.getLeafDescendantIds(baseId, rootIds)

    if (leafIds.length === 0) {
      return []
    }

    const rows = await this.db
      .select()
      .from(knowledgeItemTable)
      .where(and(eq(knowledgeItemTable.baseId, baseId), inArray(knowledgeItemTable.id, leafIds)))
    const rowsById = new Map(rows.map((row) => [row.id, row]))

    return leafIds.map((id) => {
      const row = rowsById.get(id)

      if (!row) {
        throw DataApiErrorFactory.dataInconsistent('KnowledgeItem', `Leaf descendant row missing for id '${id}'`)
      }

      return rowToKnowledgeItem(row)
    })
  }

  async getDescendantItems(baseId: string, rootIds: string[]): Promise<KnowledgeItem[]> {
    const descendantIds = await this.getDescendantIds(baseId, rootIds)

    if (descendantIds.length === 0) {
      return []
    }

    const rows = await this.db
      .select()
      .from(knowledgeItemTable)
      .where(and(eq(knowledgeItemTable.baseId, baseId), inArray(knowledgeItemTable.id, descendantIds)))
    const rowsById = new Map(rows.map((row) => [row.id, row]))

    return descendantIds.map((id) => {
      const row = rowsById.get(id)

      if (!row) {
        throw DataApiErrorFactory.dataInconsistent('KnowledgeItem', `Descendant row missing for id '${id}'`)
      }

      return rowToKnowledgeItem(row)
    })
  }

  private async getDescendantIds(baseId: string, rootIds: string[]): Promise<string[]> {
    const uniqueRootIds = [...new Set(rootIds)]

    if (uniqueRootIds.length === 0) {
      return []
    }

    const rows = await this.db.all<{ id: string }>(sql`
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
      SELECT DISTINCT id
      FROM subtree
      WHERE id NOT IN (${sql.join(
        uniqueRootIds.map((id) => sql`${id}`),
        sql`, `
      )})
    `)

    return rows.map((row) => row.id)
  }

  async deleteLeafDescendantItems(baseId: string, rootIds: string[]): Promise<void> {
    const uniqueRootIds = [...new Set(rootIds)]

    if (uniqueRootIds.length === 0) {
      return
    }

    await this.db.run(sql`
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
      DELETE FROM knowledge_item
      WHERE base_id = ${baseId}
        AND id IN (SELECT id FROM subtree)
        AND id NOT IN (${sql.join(
          uniqueRootIds.map((id) => sql`${id}`),
          sql`, `
        )})
    `)
  }

  private async getLeafDescendantIds(baseId: string, rootIds: string[]): Promise<string[]> {
    const uniqueRootIds = [...new Set(rootIds)]

    if (uniqueRootIds.length === 0) {
      return []
    }

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
      WHERE type IN ('file', 'url', 'note')
    `)

    return rows.map((row) => row.id)
  }

  async updateStatus(id: string, status: 'idle' | 'completed'): Promise<KnowledgeItem>
  async updateStatus(id: string, status: 'processing', update?: KnowledgeItemStatusUpdate): Promise<KnowledgeItem>
  async updateStatus(id: string, status: 'failed', update: FailedKnowledgeItemStatusUpdate): Promise<KnowledgeItem>
  async updateStatus(
    id: string,
    status: KnowledgeItemStatus,
    update: KnowledgeItemStatusUpdate | FailedKnowledgeItemStatusUpdate = {}
  ): Promise<KnowledgeItem> {
    const phase = status === 'processing' && 'phase' in update ? (update.phase ?? null) : null
    const error = status === 'failed' && 'error' in update ? update.error.trim() : null

    if (status === 'failed' && !error) {
      throw DataApiErrorFactory.validation({
        error: ['Failed knowledge items must include a non-empty error']
      })
    }

    const { item, startContainerIds } = await this.db.transaction(async (tx) => {
      const [existingRow] = await tx.select().from(knowledgeItemTable).where(eq(knowledgeItemTable.id, id)).limit(1)

      if (!existingRow) {
        throw DataApiErrorFactory.notFound('KnowledgeItem', id)
      }

      const [updatedRow] = await tx
        .update(knowledgeItemTable)
        .set({ status, phase, error })
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
        startContainerIds: [updatedRow.id, existingRow.groupId]
      }
    })

    await this.reconcileContainers(item.baseId, startContainerIds)
    logger.info('Updated knowledge item status', { id, status, phase })
    return item
  }

  async reconcileContainers(baseId: string, startContainerIds: Array<string | null | undefined>): Promise<void> {
    await this.db.transaction(async (tx) => {
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

        if (containerRow.phase !== null) {
          await tx
            .update(knowledgeItemTable)
            .set({ status: 'processing', error: null })
            .where(and(eq(knowledgeItemTable.baseId, baseId), eq(knowledgeItemTable.id, containerId)))

          if (containerRow.groupId) {
            queue.push(containerRow.groupId)
          }
          continue
        }

        const [stats] = await tx
          .select({
            activeCount: sql<number>`sum(case when ${knowledgeItemTable.status} not in ('completed', 'failed') then 1 else 0 end)`,
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
    const deleted = await this.db.transaction(async (tx) => {
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
