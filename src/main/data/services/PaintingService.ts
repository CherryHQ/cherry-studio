/**
 * Painting Service — painting CRUD, list, and reorder
 *
 * Provides business logic for:
 * - Listing and filtering paintings
 * - Row to API Painting conversion
 */

import { application } from '@application'
import { type NewPainting, type Painting as PaintingRow, paintingTable } from '@data/db/schemas/painting'
import { userModelTable } from '@data/db/schemas/userModel'
import type { DbType } from '@data/db/types'
import { loggerService } from '@logger'
import { DataApiErrorFactory } from '@shared/data/api'
import type { OrderRequest } from '@shared/data/api/schemas/_endpointHelpers'
import type {
  CreatePaintingDto,
  ListPaintingsQuery,
  PaintingListResponse,
  UpdatePaintingDto
} from '@shared/data/api/schemas/paintings'
import { createUniqueModelId, isUniqueModelId } from '@shared/data/types/model'
import type { Painting } from '@shared/data/types/painting'
import type { SQL } from 'drizzle-orm'
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm'

import { applyMoves, insertWithOrderKey } from './utils/orderKey'
import { timestampToISO } from './utils/rowMappers'

const logger = loggerService.withContext('DataApi:PaintingService')

/**
 * Mapping from UpdatePaintingDto field → DB column for the update path.
 * Exported for test coverage — ensures no DTO field is silently dropped.
 */
export const UPDATE_PAINTING_FIELD_MAP: Array<keyof UpdatePaintingDto> = [
  'providerId',
  'modelId',
  'mode',
  'mediaType',
  'prompt',
  'params',
  'files'
]

function rowToPainting(row: PaintingRow, validModelIds: ReadonlySet<string>): Painting {
  return {
    id: row.id,
    providerId: row.providerId,
    modelId: row.modelId && validModelIds.has(row.modelId) ? row.modelId : null,
    mode: row.mode,
    mediaType: row.mediaType,
    prompt: row.prompt,
    params: row.params,
    files: row.files,
    orderKey: row.orderKey,
    createdAt: timestampToISO(row.createdAt),
    updatedAt: timestampToISO(row.updatedAt)
  }
}

type ModelLookupDb = Pick<DbType, 'select'>

async function loadValidModelIds(db: ModelLookupDb, rows: PaintingRow[]): Promise<ReadonlySet<string>> {
  const modelIds = [...new Set(rows.map((row) => row.modelId).filter((id): id is string => Boolean(id)))]
  if (modelIds.length === 0) {
    return new Set()
  }

  const models = await db
    .select({ id: userModelTable.id })
    .from(userModelTable)
    .where(inArray(userModelTable.id, modelIds))
  return new Set(models.map((model) => model.id))
}

async function rowsToPaintings(db: ModelLookupDb, rows: PaintingRow[]): Promise<Painting[]> {
  const validModelIds = await loadValidModelIds(db, rows)
  return rows.map((row) => rowToPainting(row, validModelIds))
}

function resolveCandidateModelId(providerId: string, modelId: string | null | undefined): string | null {
  if (!modelId) {
    return null
  }

  return isUniqueModelId(modelId) ? modelId : createUniqueModelId(providerId, modelId)
}

async function resolveExistingModelId(
  db: ModelLookupDb,
  providerId: string,
  modelId: string | null | undefined
): Promise<string | null> {
  const candidate = resolveCandidateModelId(providerId, modelId)
  if (!candidate) {
    return null
  }

  const [model] = await db
    .select({ id: userModelTable.id })
    .from(userModelTable)
    .where(eq(userModelTable.id, candidate))
    .limit(1)
  return model?.id ?? null
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

    if (query.mediaType) {
      conditions.push(eq(paintingTable.mediaType, query.mediaType))
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
      items: await rowsToPaintings(db, rows),
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

    return (await rowsToPaintings(db, [row]))[0]
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
          modelId: await resolveExistingModelId(tx, dto.providerId, dto.modelId),
          mode: dto.mode,
          mediaType: dto.mediaType ?? 'image',
          prompt: dto.prompt ?? '',
          params: dto.params ?? {},
          files: { output: dto.files?.output ?? [], input: dto.files?.input ?? [] }
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

    return (await rowsToPaintings(db, [row as PaintingRow]))[0]
  }

  async update(id: string, dto: UpdatePaintingDto): Promise<Painting> {
    const db = application.get('DbService').getDb()
    const [existing] = await db.select().from(paintingTable).where(eq(paintingTable.id, id)).limit(1)
    if (!existing) {
      throw DataApiErrorFactory.notFound('Painting', id)
    }

    const updates: Partial<NewPainting> = {}
    for (const key of UPDATE_PAINTING_FIELD_MAP) {
      if (dto[key] !== undefined) {
        ;(updates as Record<string, unknown>)[key] = dto[key]
      }
    }

    if (dto.modelId !== undefined) {
      updates.modelId = await resolveExistingModelId(db, updates.providerId ?? existing.providerId, dto.modelId)
    }

    if (Object.keys(updates).length === 0) {
      return (await rowsToPaintings(db, [existing]))[0]
    }

    const [row] = await db.update(paintingTable).set(updates).where(eq(paintingTable.id, id)).returning()
    if (!row) {
      throw DataApiErrorFactory.notFound('Painting', id)
    }

    logger.info('Updated painting', { id, changes: Object.keys(dto) })
    return (await rowsToPaintings(db, [row]))[0]
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
