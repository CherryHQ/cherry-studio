/**
 * Painting Service — painting CRUD, list, and reorder
 *
 * Provides business logic for:
 * - Listing and filtering paintings
 * - Row to API Painting conversion
 */

import { application } from '@application'
import { type NewPainting, type Painting as PaintingRow, paintingTable } from '@data/db/schemas/painting'
import { loggerService } from '@logger'
import { DataApiErrorFactory } from '@shared/data/api'
import type { OrderRequest } from '@shared/data/api/schemas/_endpointHelpers'
import type {
  CreatePaintingDto,
  ListPaintingsQuery,
  PaintingListResponse,
  UpdatePaintingDto
} from '@shared/data/api/schemas/paintings'
import type { Painting } from '@shared/data/types/painting'
import type { SQL } from 'drizzle-orm'
import { and, asc, desc, eq, sql } from 'drizzle-orm'

import { applyMoves, insertWithOrderKey } from './utils/orderKey'
import { timestampToISO } from './utils/rowMappers'

const logger = loggerService.withContext('DataApi:PaintingService')

/**
 * Mapping from UpdatePaintingDto field → DB column for the update path.
 * Exported for test coverage — ensures no DTO field is silently dropped.
 */
export const UPDATE_PAINTING_FIELD_MAP: Array<keyof UpdatePaintingDto> = [
  'providerId',
  'mode',
  'model',
  'prompt',
  'params',
  'files',
  'parentId'
]

function rowToPainting(row: PaintingRow): Painting {
  return {
    id: row.id,
    providerId: row.providerId,
    mode: row.mode,
    model: row.model ?? null,
    prompt: row.prompt ?? '',
    params: row.params ?? {},
    files: { output: row.files?.output ?? [], input: row.files?.input ?? [] },
    parentId: row.parentId ?? null,
    orderKey: row.orderKey,
    createdAt: timestampToISO(row.createdAt),
    updatedAt: timestampToISO(row.updatedAt)
  }
}

class PaintingService {
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
        .orderBy(asc(paintingTable.orderKey), desc(paintingTable.createdAt), desc(paintingTable.id))
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

    const row = await db.transaction(async (tx) =>
      insertWithOrderKey(
        tx,
        paintingTable,
        {
          id: dto.id,
          providerId: dto.providerId,
          mode: dto.mode,
          model: dto.model ?? null,
          prompt: dto.prompt ?? '',
          params: dto.params ?? {},
          files: { output: dto.files?.output ?? [], input: dto.files?.input ?? [] },
          parentId: dto.parentId ?? null
        },
        {
          pkColumn: paintingTable.id,
          position: 'first'
        }
      )
    )

    logger.info('Created painting', {
      id: row.id,
      providerId: row.providerId,
      mode: row.mode
    })

    return rowToPainting(row as PaintingRow)
  }

  async update(id: string, dto: UpdatePaintingDto): Promise<Painting> {
    const db = application.get('DbService').getDb()
    const existing = await this.getById(id)

    const updates: Partial<NewPainting> = {}
    for (const key of UPDATE_PAINTING_FIELD_MAP) {
      if (dto[key] !== undefined) {
        ;(updates as Record<string, unknown>)[key] = dto[key]
      }
    }

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

  async reorder(id: string, anchor: OrderRequest): Promise<void> {
    const db = application.get('DbService').getDb()

    await db.transaction(async (tx) => {
      const [target] = await tx.select().from(paintingTable).where(eq(paintingTable.id, id)).limit(1)
      if (!target) {
        throw DataApiErrorFactory.notFound('Painting', id)
      }

      await applyMoves(tx, paintingTable, [{ id, anchor }], {
        pkColumn: paintingTable.id
      })

      logger.info('Reordered paintings', {
        count: 1
      })
    })
  }

  async reorderBatch(moves: Array<{ id: string; anchor: OrderRequest }>): Promise<void> {
    if (moves.length === 0) return

    const db = application.get('DbService').getDb()

    await db.transaction(async (tx) => {
      for (const move of moves) {
        const [target] = await tx.select().from(paintingTable).where(eq(paintingTable.id, move.id)).limit(1)
        if (!target) {
          throw DataApiErrorFactory.notFound('Painting', move.id)
        }
      }

      await applyMoves(tx, paintingTable, moves, {
        pkColumn: paintingTable.id
      })

      logger.info('Reordered paintings', {
        count: moves.length
      })
    })
  }
}

export const paintingService = new PaintingService()
