import { application } from '@application'
import { paintingTable } from '@data/db/schemas/painting'
import { loggerService } from '@logger'
import { DataApiErrorFactory } from '@shared/data/api'
import type { OffsetPaginationResponse } from '@shared/data/api/apiTypes'
import type {
  CreatePainting,
  ListPaintingsQuery,
  PaintingFileUsage,
  ReorderPaintingsDto,
  UpdatePaintingDto
} from '@shared/data/api/schemas/paintings'
import type { Painting } from '@shared/data/types/painting'
import { PaintingSchema } from '@shared/data/types/painting'
import { and, asc, desc, eq, inArray, type SQL, sql } from 'drizzle-orm'

import { insertWithOrderKey, resetOrder } from './utils/orderKey'
import { nullsToUndefined, timestampToISO } from './utils/rowMappers'

const logger = loggerService.withContext('DataApi:PaintingService')

type PaintingRow = typeof paintingTable.$inferSelect

function rowToPainting(row: PaintingRow): Painting {
  const clean = nullsToUndefined(row)
  return PaintingSchema.parse({
    ...clean,
    model: clean.model,
    prompt: clean.prompt,
    negativePrompt: clean.negativePrompt,
    status: clean.status,
    createdAt: timestampToISO(row.createdAt),
    updatedAt: timestampToISO(row.updatedAt)
  })
}

function buildConditions(query: Partial<ListPaintingsQuery>): SQL[] {
  const conditions: SQL[] = []
  if (query.provider !== undefined) conditions.push(eq(paintingTable.provider, query.provider))
  if (query.mode !== undefined) conditions.push(eq(paintingTable.mode, query.mode))
  if (query.status !== undefined) conditions.push(eq(paintingTable.status, query.status))
  return conditions
}

function buildOrderScope(dto: Pick<CreatePainting, 'provider' | 'mode'>): SQL {
  return and(eq(paintingTable.provider, dto.provider), eq(paintingTable.mode, dto.mode))!
}

function hasFile(row: Pick<PaintingRow, 'files'>, fileId: string): boolean {
  return row.files.some((file) => file.id === fileId)
}

export class PaintingService {
  private get db() {
    return application.get('DbService').getDb()
  }

  async list(query: ListPaintingsQuery): Promise<OffsetPaginationResponse<Painting>> {
    const offset = (query.page - 1) * query.limit
    const conditions = buildConditions(query)
    const where = conditions.length > 0 ? and(...conditions) : undefined

    if (query.fileId !== undefined) {
      const rows = await this.db.select().from(paintingTable).where(where).orderBy(desc(paintingTable.createdAt))
      const filtered = rows.filter((row) => hasFile(row, query.fileId!))
      return {
        items: filtered.slice(offset, offset + query.limit).map(rowToPainting),
        total: filtered.length,
        page: query.page
      }
    }

    const orderBy =
      query.provider !== undefined && query.mode !== undefined
        ? asc(paintingTable.orderKey)
        : desc(paintingTable.createdAt)
    const [rows, [{ count }]] = await Promise.all([
      this.db.select().from(paintingTable).where(where).orderBy(orderBy).limit(query.limit).offset(offset),
      this.db.select({ count: sql<number>`count(*)` }).from(paintingTable).where(where)
    ])

    return {
      items: rows.map(rowToPainting),
      total: count,
      page: query.page
    }
  }

  async getById(id: string): Promise<Painting> {
    const [row] = await this.db.select().from(paintingTable).where(eq(paintingTable.id, id)).limit(1)
    if (!row) {
      throw DataApiErrorFactory.notFound('Painting', id)
    }
    return rowToPainting(row)
  }

  async create(dto: CreatePainting): Promise<Painting> {
    return application.get('DbService').withWriteTx(async (tx) => {
      const inserted = await insertWithOrderKey(
        tx,
        paintingTable,
        {
          ...(dto.id ? { id: dto.id } : {}),
          provider: dto.provider,
          mode: dto.mode,
          model: dto.model,
          prompt: dto.prompt,
          negativePrompt: dto.negativePrompt,
          status: dto.status,
          urls: dto.urls,
          files: dto.files,
          params: dto.params
        },
        {
          pkColumn: paintingTable.id,
          scope: buildOrderScope(dto)
        }
      )
      const row = inserted as PaintingRow
      logger.info('Created painting', { id: row.id, provider: row.provider, mode: row.mode })
      return rowToPainting(row)
    })
  }

  async update(id: string, dto: UpdatePaintingDto): Promise<Painting> {
    return application.get('DbService').withWriteTx(async (tx) => {
      const updates: Partial<typeof paintingTable.$inferInsert> = {}
      if (dto.provider !== undefined) updates.provider = dto.provider
      if (dto.mode !== undefined) updates.mode = dto.mode
      if (dto.model !== undefined) updates.model = dto.model
      if (dto.prompt !== undefined) updates.prompt = dto.prompt
      if (dto.negativePrompt !== undefined) updates.negativePrompt = dto.negativePrompt
      if (dto.status !== undefined) updates.status = dto.status
      if (dto.urls !== undefined) updates.urls = dto.urls
      if (dto.files !== undefined) updates.files = dto.files
      if (dto.params !== undefined) updates.params = dto.params

      const result = await tx.update(paintingTable).set(updates).where(eq(paintingTable.id, id))
      if (result.rowsAffected === 0) {
        throw DataApiErrorFactory.notFound('Painting', id)
      }

      const [row] = await tx.select().from(paintingTable).where(eq(paintingTable.id, id)).limit(1)
      if (!row) {
        throw DataApiErrorFactory.notFound('Painting', id)
      }

      logger.info('Updated painting', { id, changes: Object.keys(dto) })
      return rowToPainting(row)
    })
  }

  async delete(id: string): Promise<void> {
    await application.get('DbService').withWriteTx(async (tx) => {
      const result = await tx.delete(paintingTable).where(eq(paintingTable.id, id))
      if (result.rowsAffected === 0) {
        throw DataApiErrorFactory.notFound('Painting', id)
      }
    })
    logger.info('Deleted painting', { id })
  }

  async reorder(dto: ReorderPaintingsDto): Promise<void> {
    await application.get('DbService').withWriteTx(async (tx) => {
      const rows =
        dto.ids.length === 0
          ? []
          : await tx
              .select({ id: paintingTable.id })
              .from(paintingTable)
              .where(
                and(
                  eq(paintingTable.provider, dto.provider),
                  eq(paintingTable.mode, dto.mode),
                  inArray(paintingTable.id, dto.ids)
                )
              )

      const found = new Set(rows.map((row) => row.id))
      const orderedRows = dto.ids.map((id) => {
        if (!found.has(id)) {
          throw DataApiErrorFactory.notFound('Painting', id)
        }
        return { id }
      })

      await resetOrder(tx, paintingTable, orderedRows, { pkColumn: paintingTable.id })
    })
    logger.info('Reordered paintings', { provider: dto.provider, mode: dto.mode, count: dto.ids.length })
  }

  async getFileUsage(fileId: string): Promise<PaintingFileUsage> {
    const rows = await this.db.select({ id: paintingTable.id, files: paintingTable.files }).from(paintingTable)
    const paintingIds = rows.filter((row) => hasFile(row, fileId)).map((row) => row.id)
    return {
      fileId,
      paintingIds,
      count: paintingIds.length
    }
  }
}

export const paintingService = new PaintingService()
