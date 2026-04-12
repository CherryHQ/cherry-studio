import { paintingTable } from '@data/db/schemas/painting'
import { loggerService } from '@logger'
import { application } from '@main/core/application'
import { DataApiErrorFactory } from '@shared/data/api'
import type {
  CreatePaintingDto,
  ListPaintingsQuery,
  PaintingListResponse,
  ReorderPaintingsDto,
  UpdatePaintingDto
} from '@shared/data/api/schemas/paintings'
import type { Painting } from '@shared/data/types/painting'
import type { SQL } from 'drizzle-orm'
import { and, desc, eq, sql } from 'drizzle-orm'

const logger = loggerService.withContext('DataApi:PaintingService')

function rowToPainting(row: typeof paintingTable.$inferSelect): Painting {
  return {
    id: row.id,
    providerId: row.providerId,
    mode: row.mode,
    model: row.model ?? null,
    prompt: row.prompt ?? '',
    params: row.params ?? {},
    fileIds: row.fileIds ?? [],
    inputFileIds: row.inputFileIds ?? [],
    parentId: row.parentId ?? null,
    sortOrder: row.sortOrder ?? 0,
    createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : new Date().toISOString(),
    updatedAt: row.updatedAt ? new Date(row.updatedAt).toISOString() : new Date().toISOString()
  }
}

function buildScopeWhere(providerId: string, mode: Painting['mode']) {
  return and(eq(paintingTable.providerId, providerId), eq(paintingTable.mode, mode))
}

function hasDuplicateIds(ids: string[]): boolean {
  return new Set(ids).size !== ids.length
}

export class PaintingService {
  async list(query: ListPaintingsQuery): Promise<PaintingListResponse> {
    const db = application.get('DbService').getDb()
    const conditions: SQL[] = []

    if (query.providerId) {
      conditions.push(eq(paintingTable.providerId, query.providerId))
    }

    if (query.mode) {
      conditions.push(eq(paintingTable.mode, query.mode))
    }

    if (query.parentId) {
      conditions.push(eq(paintingTable.parentId, query.parentId))
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined

    const [rows, countResult] = await Promise.all([
      db
        .select()
        .from(paintingTable)
        .where(whereClause)
        .orderBy(desc(paintingTable.sortOrder), desc(paintingTable.createdAt), desc(paintingTable.id))
        .limit(query.limit)
        .offset(query.offset),
      db.select({ count: sql<number>`count(*)` }).from(paintingTable).where(whereClause)
    ])

    return {
      items: rows.map((row) => rowToPainting(row)),
      total: countResult[0]?.count ?? 0,
      limit: query.limit,
      offset: query.offset
    }
  }

  async getById(id: string): Promise<Painting> {
    const db = application.get('DbService').getDb()
    const [row] = await db.select().from(paintingTable).where(eq(paintingTable.id, id)).limit(1)

    if (!row) {
      throw DataApiErrorFactory.notFound('Painting', id)
    }

    return rowToPainting(row)
  }

  async create(dto: CreatePaintingDto): Promise<Painting> {
    const db = application.get('DbService').getDb()

    const row = await db.transaction(async (tx) => {
      const maxSortRow = await tx
        .select({ maxSortOrder: sql<number>`coalesce(max(${paintingTable.sortOrder}), 0)` })
        .from(paintingTable)
        .where(buildScopeWhere(dto.providerId, dto.mode))
        .get()

      const [created] = await tx
        .insert(paintingTable)
        .values({
          providerId: dto.providerId,
          mode: dto.mode,
          model: dto.model ?? null,
          prompt: dto.prompt ?? '',
          params: dto.params ?? {},
          fileIds: dto.fileIds ?? [],
          inputFileIds: dto.inputFileIds ?? [],
          parentId: dto.parentId ?? null,
          sortOrder: (maxSortRow?.maxSortOrder ?? 0) + 1
        })
        .returning()

      return created
    })

    logger.info('Created painting', {
      id: row.id,
      providerId: row.providerId,
      mode: row.mode
    })

    return rowToPainting(row)
  }

  async update(id: string, dto: UpdatePaintingDto): Promise<Painting> {
    const db = application.get('DbService').getDb()
    const existing = await this.getById(id)

    const updates: Partial<typeof paintingTable.$inferInsert> = {}
    if (dto.model !== undefined) updates.model = dto.model
    if (dto.prompt !== undefined) updates.prompt = dto.prompt
    if (dto.params !== undefined) updates.params = dto.params
    if (dto.fileIds !== undefined) updates.fileIds = dto.fileIds
    if (dto.inputFileIds !== undefined) updates.inputFileIds = dto.inputFileIds
    if (dto.parentId !== undefined) updates.parentId = dto.parentId

    if (Object.keys(updates).length === 0) {
      return existing
    }

    const [row] = await db.update(paintingTable).set(updates).where(eq(paintingTable.id, id)).returning()

    logger.info('Updated painting', { id, changes: Object.keys(dto) })
    return rowToPainting(row)
  }

  async delete(id: string): Promise<void> {
    const db = application.get('DbService').getDb()
    await this.getById(id)
    await db.delete(paintingTable).where(eq(paintingTable.id, id))
    logger.info('Deleted painting', { id })
  }

  async reorder(dto: ReorderPaintingsDto): Promise<{ reorderedCount: number }> {
    if (hasDuplicateIds(dto.orderedIds)) {
      throw DataApiErrorFactory.validation({
        orderedIds: ['Painting reorder payload contains duplicate ids']
      })
    }

    const db = application.get('DbService').getDb()

    return await db.transaction(async (tx) => {
      const rows = await tx
        .select({ id: paintingTable.id })
        .from(paintingTable)
        .where(buildScopeWhere(dto.providerId, dto.mode))
        .all()

      const existingIds = rows.map((row) => row.id)
      if (existingIds.length !== dto.orderedIds.length) {
        throw DataApiErrorFactory.validation({
          orderedIds: ['Painting reorder payload must include every record in the target scope exactly once']
        })
      }

      const existingIdSet = new Set(existingIds)
      const containsUnknownId = dto.orderedIds.some((id) => !existingIdSet.has(id))
      if (containsUnknownId) {
        throw DataApiErrorFactory.validation({
          orderedIds: ['Painting reorder payload contains ids outside the target scope']
        })
      }

      for (let index = 0; index < dto.orderedIds.length; index++) {
        await tx
          .update(paintingTable)
          .set({ sortOrder: dto.orderedIds.length - index })
          .where(eq(paintingTable.id, dto.orderedIds[index]))
      }

      logger.info('Reordered paintings', {
        providerId: dto.providerId,
        mode: dto.mode,
        count: dto.orderedIds.length
      })

      return { reorderedCount: dto.orderedIds.length }
    })
  }
}

export const paintingService = new PaintingService()
