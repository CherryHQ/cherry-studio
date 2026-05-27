import { application } from '@application'
import { fileEntryTable, fileRefTable } from '@data/db/schemas/file'
import { paintingTable } from '@data/db/schemas/painting'
import type { DbOrTx } from '@data/db/types'
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
import type { FileEntry, FileEntryId } from '@shared/data/types/file'
import { FileEntrySchema, paintingSourceType } from '@shared/data/types/file'
import type { Painting } from '@shared/data/types/painting'
import { PaintingSchema } from '@shared/data/types/painting'
import { and, asc, desc, eq, inArray, type SQL, sql } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'

import { insertWithOrderKey, resetOrder } from './utils/orderKey'
import { nullsToUndefined, timestampToISO } from './utils/rowMappers'

const logger = loggerService.withContext('DataApi:PaintingService')
const PAINTING_FILE_ROLE = 'image'
const SQLITE_INARRAY_CHUNK = 500

type PaintingRow = typeof paintingTable.$inferSelect
type FileEntryRow = typeof fileEntryTable.$inferSelect

function rowToFileEntry(row: FileEntryRow): FileEntry {
  if (row.origin === 'internal') {
    return FileEntrySchema.parse({
      id: row.id,
      origin: 'internal',
      name: row.name,
      ext: row.ext,
      size: row.size,
      ...(row.deletedAt !== null ? { deletedAt: row.deletedAt } : {}),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt
    })
  }

  return FileEntrySchema.parse({
    id: row.id,
    origin: 'external',
    name: row.name,
    ext: row.ext,
    externalPath: row.externalPath,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  })
}

function rowToPainting(row: PaintingRow, files: FileEntry[] = []): Painting {
  const clean = nullsToUndefined(row)
  return PaintingSchema.parse({
    ...clean,
    model: clean.model,
    prompt: clean.prompt,
    negativePrompt: clean.negativePrompt,
    status: clean.status,
    files,
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

function uniqueFileEntryIds(fileEntryIds: readonly FileEntryId[]): FileEntryId[] {
  return [...new Set(fileEntryIds)]
}

export class PaintingService {
  private get db() {
    return application.get('DbService').getDb()
  }

  async list(query: ListPaintingsQuery): Promise<OffsetPaginationResponse<Painting>> {
    const offset = (query.page - 1) * query.limit
    const conditions = buildConditions(query)
    const fileEntryId = query.fileEntryId

    if (fileEntryId !== undefined) {
      conditions.push(
        sql`EXISTS (
          SELECT 1 FROM ${fileRefTable}
          WHERE ${fileRefTable.sourceType} = ${paintingSourceType}
            AND ${fileRefTable.sourceId} = ${paintingTable.id}
            AND ${fileRefTable.fileEntryId} = ${fileEntryId}
        )`
      )
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined
    const orderBy =
      query.provider !== undefined && query.mode !== undefined
        ? asc(paintingTable.orderKey)
        : desc(paintingTable.createdAt)
    const [rows, [{ count }]] = await Promise.all([
      this.db.select().from(paintingTable).where(where).orderBy(orderBy).limit(query.limit).offset(offset),
      this.db.select({ count: sql<number>`count(*)` }).from(paintingTable).where(where)
    ])

    const filesByPaintingId = await this.getFilesByPaintingIds(rows.map((row) => row.id))

    return {
      items: rows.map((row) => rowToPainting(row, filesByPaintingId.get(row.id))),
      total: count,
      page: query.page
    }
  }

  async getById(id: string): Promise<Painting> {
    const [row] = await this.db.select().from(paintingTable).where(eq(paintingTable.id, id)).limit(1)
    if (!row) {
      throw DataApiErrorFactory.notFound('Painting', id)
    }
    const filesByPaintingId = await this.getFilesByPaintingIds([id])
    return rowToPainting(row, filesByPaintingId.get(id))
  }

  async create(dto: CreatePainting): Promise<Painting> {
    const row = await application.get('DbService').withWriteTx(async (tx) => {
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
          params: dto.params
        },
        {
          pkColumn: paintingTable.id,
          scope: buildOrderScope(dto)
        }
      )
      const row = inserted as PaintingRow
      await this.replaceFileRefs(tx, row.id, dto.fileEntryIds)
      logger.info('Created painting', { id: row.id, provider: row.provider, mode: row.mode })
      return row
    })

    const filesByPaintingId = await this.getFilesByPaintingIds([row.id])
    return rowToPainting(row, filesByPaintingId.get(row.id))
  }

  async update(id: string, dto: UpdatePaintingDto): Promise<Painting> {
    const row = await application.get('DbService').withWriteTx(async (tx) => {
      const updates: Partial<typeof paintingTable.$inferInsert> = {}
      if (dto.provider !== undefined) updates.provider = dto.provider
      if (dto.mode !== undefined) updates.mode = dto.mode
      if (dto.model !== undefined) updates.model = dto.model
      if (dto.prompt !== undefined) updates.prompt = dto.prompt
      if (dto.negativePrompt !== undefined) updates.negativePrompt = dto.negativePrompt
      if (dto.status !== undefined) updates.status = dto.status
      if (dto.urls !== undefined) updates.urls = dto.urls
      if (dto.params !== undefined) updates.params = dto.params

      if (Object.keys(updates).length > 0) {
        const result = await tx.update(paintingTable).set(updates).where(eq(paintingTable.id, id))
        if (result.rowsAffected === 0) {
          throw DataApiErrorFactory.notFound('Painting', id)
        }
      }

      const [row] = await tx.select().from(paintingTable).where(eq(paintingTable.id, id)).limit(1)
      if (!row) {
        throw DataApiErrorFactory.notFound('Painting', id)
      }

      if (dto.fileEntryIds !== undefined) {
        await this.replaceFileRefs(tx, id, dto.fileEntryIds)
      }

      logger.info('Updated painting', { id, changes: Object.keys(dto) })
      return row
    })

    const filesByPaintingId = await this.getFilesByPaintingIds([id])
    return rowToPainting(row, filesByPaintingId.get(id))
  }

  async delete(id: string): Promise<void> {
    await application.get('DbService').withWriteTx(async (tx) => {
      await tx
        .delete(fileRefTable)
        .where(and(eq(fileRefTable.sourceType, paintingSourceType), eq(fileRefTable.sourceId, id)))

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

  async getFileUsage(fileEntryId: FileEntryId): Promise<PaintingFileUsage> {
    const rows = await this.db
      .select({ id: fileRefTable.sourceId })
      .from(fileRefTable)
      .where(
        and(
          eq(fileRefTable.sourceType, paintingSourceType),
          eq(fileRefTable.fileEntryId, fileEntryId),
          eq(fileRefTable.role, PAINTING_FILE_ROLE)
        )
      )
      .orderBy(asc(fileRefTable.createdAt), asc(fileRefTable.id))
    const paintingIds = rows.map((row) => row.id)
    return {
      fileEntryId,
      paintingIds,
      count: paintingIds.length
    }
  }

  private async getFilesByPaintingIds(paintingIds: readonly string[]): Promise<Map<string, FileEntry[]>> {
    const filesByPaintingId = new Map<string, FileEntry[]>()
    if (paintingIds.length === 0) return filesByPaintingId

    for (let i = 0; i < paintingIds.length; i += SQLITE_INARRAY_CHUNK) {
      const chunk = paintingIds.slice(i, i + SQLITE_INARRAY_CHUNK)
      const rows = await this.db
        .select({
          sourceId: fileRefTable.sourceId,
          entry: fileEntryTable
        })
        .from(fileRefTable)
        .innerJoin(fileEntryTable, eq(fileEntryTable.id, fileRefTable.fileEntryId))
        .where(
          and(
            eq(fileRefTable.sourceType, paintingSourceType),
            eq(fileRefTable.role, PAINTING_FILE_ROLE),
            inArray(fileRefTable.sourceId, chunk)
          )
        )
        .orderBy(asc(fileRefTable.createdAt), asc(fileRefTable.id))

      for (const row of rows) {
        const files = filesByPaintingId.get(row.sourceId)
        const entry = rowToFileEntry(row.entry)
        if (files) {
          files.push(entry)
        } else {
          filesByPaintingId.set(row.sourceId, [entry])
        }
      }
    }

    return filesByPaintingId
  }

  private async replaceFileRefs(
    tx: Pick<DbOrTx, 'delete' | 'insert'>,
    paintingId: string,
    fileEntryIds: readonly FileEntryId[]
  ): Promise<void> {
    await tx
      .delete(fileRefTable)
      .where(
        and(
          eq(fileRefTable.sourceType, paintingSourceType),
          eq(fileRefTable.sourceId, paintingId),
          eq(fileRefTable.role, PAINTING_FILE_ROLE)
        )
      )

    const uniqueIds = uniqueFileEntryIds(fileEntryIds)
    if (uniqueIds.length === 0) return

    const now = Date.now()
    await tx.insert(fileRefTable).values(
      uniqueIds.map((fileEntryId, index) => ({
        id: uuidv4(),
        fileEntryId,
        sourceType: paintingSourceType,
        sourceId: paintingId,
        role: PAINTING_FILE_ROLE,
        createdAt: now + index,
        updatedAt: now + index
      }))
    )
  }
}

export const paintingService = new PaintingService()
