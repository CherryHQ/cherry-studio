/**
 * Knowledge Item Service (DataApi v2).
 *
 * Handles CRUD operations for knowledge items stored in SQLite.
 */

import { application } from '@application'
import { knowledgeItemTable } from '@data/db/schemas/knowledge'
import { loggerService } from '@logger'
import type { OffsetPaginationResponse } from '@shared/data/api'
import { DataApiErrorFactory } from '@shared/data/api'
import type {
  CreateKnowledgeItemDto,
  CreateKnowledgeItemsDto,
  KnowledgeItemsQuery,
  UpdateKnowledgeItemDto
} from '@shared/data/api/schemas/knowledges'
import {
  DirectoryItemDataSchema,
  FileItemDataSchema,
  type KnowledgeItem,
  type KnowledgeItemStatus,
  NoteItemDataSchema,
  SitemapItemDataSchema,
  UrlItemDataSchema
} from '@shared/data/types/knowledge'
import { and, desc, eq, inArray, sql } from 'drizzle-orm'

import { knowledgeBaseService } from './KnowledgeBaseService'
import { timestampToISO } from './utils/rowMappers'

const logger = loggerService.withContext('DataApi:KnowledgeItemService')

const KNOWLEDGE_ITEM_DATA_SCHEMAS = {
  file: FileItemDataSchema,
  url: UrlItemDataSchema,
  note: NoteItemDataSchema,
  sitemap: SitemapItemDataSchema,
  directory: DirectoryItemDataSchema
} as const

type PlannedKnowledgeItemInsert = CreateKnowledgeItemsDto['items'][number] & {
  parsedData: CreateKnowledgeItemsDto['items'][number]['data']
  status?: KnowledgeItemStatus
}

type CreateKnowledgeItemsOptions = {
  status?: KnowledgeItemStatus
}

type CreateKnowledgeItemInput = CreateKnowledgeItemDto & {
  status?: KnowledgeItemStatus
}

function rowToKnowledgeItem(row: typeof knowledgeItemTable.$inferSelect): KnowledgeItem {
  // Drizzle's `text({ mode: 'json' })` decoder already ran by the time we
  // get here, so `row.data` is either the decoded object, null (missing
  // blob), or in the legacy/bad-typing case a raw string. The JSON-parse
  // branch exists for defence-in-depth; the awaitKnowledgeItemRead wrapper
  // on the query side is what actually catches corrupt-blob SyntaxError
  // before it ever reaches this converter.
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
    createdAt: timestampToISO(row.createdAt),
    updatedAt: timestampToISO(row.updatedAt)
  } as KnowledgeItem
}

/**
 * Run a knowledge_item read query and translate any Drizzle JSON-decode
 * SyntaxError into a domain-typed DATA_INCONSISTENT response.
 *
 * Rationale: Drizzle's `text({ mode: 'json' })` calls JSON.parse as part of
 * row materialisation. If a `data` blob in the DB is corrupt (bit rot, manual
 * SQL edit, bad migration), the `await db.select()` call throws a bare
 * SyntaxError from inside the driver, *before* rowToKnowledgeItem runs. The
 * service would then leak `SyntaxError: Expected property name or '}' ...`
 * to callers instead of a DataApiError. Wrapping the read here converts it.
 */
async function awaitKnowledgeItemRead<T>(fn: () => PromiseLike<T>, context: string): Promise<T> {
  try {
    return await fn()
  } catch (e) {
    if (e instanceof SyntaxError) {
      throw DataApiErrorFactory.dataInconsistent('KnowledgeItem', `Corrupted data in knowledge item ${context}`)
    }
    throw e
  }
}

export class KnowledgeItemService {
  private get db() {
    const dbService = application.get('DbService')
    return dbService.getDb()
  }

  async list(baseId: string, query: KnowledgeItemsQuery): Promise<OffsetPaginationResponse<KnowledgeItem>> {
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
      awaitKnowledgeItemRead(
        () =>
          this.db
            .select()
            .from(knowledgeItemTable)
            .where(where)
            .orderBy(desc(knowledgeItemTable.createdAt), desc(knowledgeItemTable.id))
            .limit(limit)
            .offset(offset),
        `in base '${baseId}'`
      ),
      this.db.select({ count: sql<number>`count(*)` }).from(knowledgeItemTable).where(where)
    ])

    return {
      items: rows.map((row) => rowToKnowledgeItem(row)),
      total: count,
      page: query.page
    }
  }

  async createMany(
    baseId: string,
    dto: CreateKnowledgeItemsDto,
    options: CreateKnowledgeItemsOptions = {}
  ): Promise<{ items: KnowledgeItem[] }> {
    await knowledgeBaseService.getById(baseId)
    return await this.createManyInBase(baseId, dto.items, options)
  }

  async createManyInBase(
    baseId: string,
    items: CreateKnowledgeItemInput[],
    options: CreateKnowledgeItemsOptions = {}
  ): Promise<{ items: KnowledgeItem[] }> {
    const itemsToCreate = items.map((item, index) => {
      const parsed = KNOWLEDGE_ITEM_DATA_SCHEMAS[item.type].safeParse(item.data)
      if (!parsed.success) {
        throw DataApiErrorFactory.validation({
          [`items.${index}.data`]: [`Data payload does not match knowledge item type '${item.type}'`]
        })
      }

      return {
        ...item,
        parsedData: parsed.data,
        status: item.status ?? options.status
      }
    })

    const requestedGroupIds = [
      ...new Set(itemsToCreate.flatMap((item) => (item.groupId != null ? [item.groupId] : [])))
    ]
    const existingGroupIds = await this.getExistingGroupIdsInBase(baseId, requestedGroupIds)
    const missingGroupIds = requestedGroupIds.filter((groupId) => !existingGroupIds.has(groupId))

    if (missingGroupIds.length > 0) {
      throw DataApiErrorFactory.validation({
        groupId: [`Knowledge item group owner not found in base '${baseId}': ${missingGroupIds.join(', ')}`]
      })
    }

    const createdRows = await this.createBatch(baseId, itemsToCreate)
    const createdItems = createdRows.map((row) => rowToKnowledgeItem(row))

    logger.info('Created knowledge items', { baseId, count: createdItems.length })
    return { items: createdItems }
  }

  async getById(id: string): Promise<KnowledgeItem> {
    const [row] = await awaitKnowledgeItemRead(
      () => this.db.select().from(knowledgeItemTable).where(eq(knowledgeItemTable.id, id)).limit(1),
      `'${id}'`
    )

    if (!row) {
      throw DataApiErrorFactory.notFound('KnowledgeItem', id)
    }

    return rowToKnowledgeItem(row)
  }

  async getByIdsInBase(baseId: string, itemIds: string[]): Promise<KnowledgeItem[]> {
    const uniqueItemIds = [...new Set(itemIds)]

    if (uniqueItemIds.length === 0) {
      return []
    }

    const rows = await awaitKnowledgeItemRead(
      () =>
        this.db
          .select()
          .from(knowledgeItemTable)
          .where(and(eq(knowledgeItemTable.baseId, baseId), inArray(knowledgeItemTable.id, uniqueItemIds))),
      `in base '${baseId}'`
    )

    const itemsById = new Map(rows.map((row) => [row.id, rowToKnowledgeItem(row)]))

    for (const itemId of uniqueItemIds) {
      if (!itemsById.has(itemId)) {
        throw DataApiErrorFactory.notFound('KnowledgeItem', itemId)
      }
    }

    return uniqueItemIds.map((itemId) => itemsById.get(itemId)!)
  }

  async getByIds(itemIds: string[]): Promise<KnowledgeItem[]> {
    const uniqueItemIds = [...new Set(itemIds)]

    if (uniqueItemIds.length === 0) {
      return []
    }

    const rows = await awaitKnowledgeItemRead(
      () => this.db.select().from(knowledgeItemTable).where(inArray(knowledgeItemTable.id, uniqueItemIds)),
      `'${uniqueItemIds.join(', ')}'`
    )
    const itemsById = new Map(rows.map((row) => [row.id, rowToKnowledgeItem(row)]))

    for (const itemId of uniqueItemIds) {
      if (!itemsById.has(itemId)) {
        throw DataApiErrorFactory.notFound('KnowledgeItem', itemId)
      }
    }

    return uniqueItemIds.map((itemId) => itemsById.get(itemId)!)
  }

  async getCascadeIdsInBase(baseId: string, rootIds: string[]): Promise<string[]> {
    const uniqueRootIds = [...new Set(rootIds)]

    if (uniqueRootIds.length === 0) {
      return []
    }

    await this.getByIdsInBase(baseId, uniqueRootIds)
    const descendantRows = await this.db.all<{ id: string }>(sql`
      WITH RECURSIVE descendants AS (
        SELECT id
        FROM knowledge_item
        WHERE base_id = ${baseId}
          AND group_id IN (${sql.join(
            uniqueRootIds.map((id) => sql`${id}`),
            sql`, `
          )})

        UNION ALL

        SELECT child.id
        FROM knowledge_item child
        INNER JOIN descendants parent ON child.group_id = parent.id
        WHERE child.base_id = ${baseId}
      )
      SELECT DISTINCT id FROM descendants
    `)
    const descendantIds = descendantRows.map((row) => row.id)

    const rootIdSet = new Set(uniqueRootIds)
    return [...uniqueRootIds, ...descendantIds.filter((id) => !rootIdSet.has(id))]
  }

  async update(id: string, dto: UpdateKnowledgeItemDto): Promise<KnowledgeItem> {
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

    const [row] = await this.db.update(knowledgeItemTable).set(updates).where(eq(knowledgeItemTable.id, id)).returning()
    if (!row) {
      throw DataApiErrorFactory.dataInconsistent('KnowledgeItem', `Knowledge item update result missing for id '${id}'`)
    }
    logger.info('Updated knowledge item', { id, changes: Object.keys(dto) })
    return rowToKnowledgeItem(row)
  }

  async updateStatuses(
    itemIds: string[],
    dto: Pick<UpdateKnowledgeItemDto, 'status' | 'error'>
  ): Promise<KnowledgeItem[]> {
    const uniqueItemIds = [...new Set(itemIds)]

    if (uniqueItemIds.length === 0) {
      return []
    }

    const updates: Partial<typeof knowledgeItemTable.$inferInsert> = {}
    if (dto.status !== undefined) updates.status = dto.status
    if (dto.error !== undefined) updates.error = dto.error

    if (Object.keys(updates).length === 0) {
      return await this.getByIds(uniqueItemIds)
    }

    const rows = await this.db
      .update(knowledgeItemTable)
      .set(updates)
      .where(inArray(knowledgeItemTable.id, uniqueItemIds))
      .returning()
    const itemsById = new Map(rows.map((row) => [row.id, rowToKnowledgeItem(row)]))

    for (const itemId of uniqueItemIds) {
      if (!itemsById.has(itemId)) {
        throw DataApiErrorFactory.notFound('KnowledgeItem', itemId)
      }
    }

    logger.info('Updated knowledge item statuses', { count: uniqueItemIds.length, changes: Object.keys(dto) })
    return uniqueItemIds.map((itemId) => itemsById.get(itemId)!)
  }

  async refreshContainerStatuses(containerIds: string[]): Promise<void> {
    const uniqueContainerIds = [...new Set(containerIds)]

    for (const containerId of uniqueContainerIds) {
      await this.refreshContainerStatus(containerId)
    }
  }

  async delete(id: string): Promise<void> {
    await this.getById(id)
    await this.db.delete(knowledgeItemTable).where(eq(knowledgeItemTable.id, id))
    logger.info('Deleted knowledge item', { id })
  }

  private async createBatch(
    baseId: string,
    itemsToCreate: PlannedKnowledgeItemInsert[]
  ): Promise<Array<typeof knowledgeItemTable.$inferSelect>> {
    if (itemsToCreate.length === 0) {
      return []
    }

    return await this.db
      .insert(knowledgeItemTable)
      .values(
        itemsToCreate.map((item) => ({
          baseId,
          groupId: item.groupId ?? null,
          type: item.type,
          data: item.parsedData,
          status: item.status ?? 'idle',
          error: null
        }))
      )
      .returning()
  }

  private async getExistingGroupIdsInBase(baseId: string, groupIds: string[]): Promise<Set<string>> {
    const uniqueGroupIds = [...new Set(groupIds)]

    if (uniqueGroupIds.length === 0) {
      return new Set()
    }

    const rows = await this.db
      .select({ id: knowledgeItemTable.id })
      .from(knowledgeItemTable)
      .where(and(eq(knowledgeItemTable.baseId, baseId), inArray(knowledgeItemTable.id, uniqueGroupIds)))

    return new Set(rows.map((row) => row.id))
  }

  private async refreshContainerStatus(containerId: string): Promise<void> {
    const container = await this.getById(containerId)
    if (container.type !== 'directory' && container.type !== 'sitemap') {
      return
    }

    const children = await awaitKnowledgeItemRead(
      () => this.db.select().from(knowledgeItemTable).where(eq(knowledgeItemTable.groupId, containerId)),
      `children of '${containerId}'`
    )

    if (children.length === 0) {
      return
    }

    const failedChild = children.find((child) => child.status === 'failed')
    const nextStatus: KnowledgeItemStatus = failedChild
      ? 'failed'
      : children.every((child) => child.status === 'completed')
        ? 'completed'
        : children.some((child) => child.status === 'embed')
          ? 'embed'
          : children.some((child) => child.status === 'read')
            ? 'read'
            : children.some((child) => child.status === 'file_processing')
              ? 'file_processing'
              : 'pending'
    const nextError = failedChild ? (failedChild.error ?? `Child knowledge item '${failedChild.id}' failed`) : null

    if (container.status === nextStatus && container.error === nextError) {
      return
    }

    await this.updateContainerStatus(containerId, nextStatus, nextError)
    if (container.groupId != null) {
      await this.refreshContainerStatus(container.groupId)
    }
  }

  private async updateContainerStatus(id: string, status: KnowledgeItemStatus, error: string | null): Promise<void> {
    const [row] = await this.db
      .update(knowledgeItemTable)
      .set({ status, error })
      .where(eq(knowledgeItemTable.id, id))
      .returning()

    if (!row) {
      throw DataApiErrorFactory.dataInconsistent('KnowledgeItem', `Knowledge item update result missing for id '${id}'`)
    }
  }
}

export const knowledgeItemService = new KnowledgeItemService()
