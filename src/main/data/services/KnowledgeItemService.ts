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
  type KnowledgeItemStatus,
  type UpdateKnowledgeItemDto
} from '@shared/data/types/knowledge'
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm'

import { knowledgeBaseService } from './KnowledgeBaseService'
import { timestampToISO } from './utils/rowMappers'

const logger = loggerService.withContext('DataApi:KnowledgeItemService')

type KnowledgeItemRow = typeof knowledgeItemTable.$inferSelect

type KnowledgeItemStatusUpdate = {
  phase?: KnowledgeItemPhase | null
  error?: string | null
}

function rowToKnowledgeItem(row: KnowledgeItemRow): KnowledgeItem {
  return {
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
  } as KnowledgeItem
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

    const where = conditions.length === 1 ? conditions[0] : and(...conditions)
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

  async create(baseId: string, item: CreateKnowledgeItemDto): Promise<KnowledgeItem> {
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

  async update(id: string, dto: UpdateKnowledgeItemDto): Promise<KnowledgeItem> {
    const result = await this.db.transaction(async (tx) => {
      const [existingRow] = await tx.select().from(knowledgeItemTable).where(eq(knowledgeItemTable.id, id)).limit(1)

      if (!existingRow) {
        throw DataApiErrorFactory.notFound('KnowledgeItem', id)
      }

      const existing = rowToKnowledgeItem(existingRow)
      const updates: Partial<typeof knowledgeItemTable.$inferInsert> = {}

      if (dto.data !== undefined) {
        updates.data = dto.data
      }
      if (dto.status !== undefined) {
        updates.status = dto.status
      }
      if (dto.error !== undefined) {
        updates.error = dto.error
      }

      if (Object.keys(updates).length === 0) {
        return existing
      }

      const [row] = await withSqliteErrors(
        () => tx.update(knowledgeItemTable).set(updates).where(eq(knowledgeItemTable.id, id)).returning(),
        {
          foreignKey: () =>
            existing.groupId
              ? DataApiErrorFactory.validation({
                  groupId: [`Knowledge item group owner not found in base '${existing.baseId}': ${existing.groupId}`]
                })
              : DataApiErrorFactory.notFound('KnowledgeBase', existing.baseId),
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

      if (!row) {
        throw DataApiErrorFactory.dataInconsistent(
          'KnowledgeItem',
          `Knowledge item update result missing for id '${id}'`
        )
      }

      return rowToKnowledgeItem(row)
    })

    logger.info('Updated knowledge item', { id, changes: Object.keys(dto) })
    return result
  }

  async updateStatus(
    id: string,
    status: KnowledgeItemStatus,
    update: KnowledgeItemStatusUpdate = {}
  ): Promise<KnowledgeItem> {
    const phase = update.phase ?? null
    const error = update.error ?? null
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
          .set({ status: nextStatus, error: null })
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
