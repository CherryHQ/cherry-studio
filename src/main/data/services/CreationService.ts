/**
 * Creation Service — generation-receipt CRUD, list, and reorder. Unifies the
 * former PaintingService + VideoService behind one `creation` table with a
 * `kind: 'image' | 'video'` discriminator.
 *
 * Output / input files are stored in `file_ref` (not on the creation row).
 * `create` writes the refs; `get` / `list` hydrate them via a single
 * `IN (...)` query, then group by sourceId + role. `delete` derefs through
 * `fileRefService.cleanupBySourceTx`.
 */

import { application } from '@application'
import { type CreationRow, creationTable, type InsertCreationRow } from '@data/db/schemas/creation'
import { fileEntryTable, fileRefTable } from '@data/db/schemas/file'
import { defaultHandlersFor, withSqliteErrors } from '@data/db/sqliteErrors'
import type { DbType } from '@data/db/types'
import { loggerService } from '@logger'
import { DataApiErrorFactory } from '@shared/data/api'
import type { OrderRequest } from '@shared/data/api/schemas/_endpointHelpers'
import type {
  CreateCreationDto,
  CreationListResponse,
  ListCreationsQuery,
  UpdateCreationDto
} from '@shared/data/api/schemas/creations'
import { CREATIONS_DEFAULT_LIMIT, CREATIONS_MAX_LIMIT } from '@shared/data/api/schemas/creations'
import type { Creation, CreationFiles, CreationKind } from '@shared/data/types/creation'
import { creationSourceType } from '@shared/data/types/file/ref'
import { createUniqueModelId, isUniqueModelId } from '@shared/data/types/model'
import type { SQL } from 'drizzle-orm'
import { and, asc, eq, gt, inArray, sql } from 'drizzle-orm'

import { fileRefService } from './FileRefService'
import { applyMoves, insertWithOrderKey } from './utils/orderKey'
import { timestampToISO } from './utils/rowMappers'

const logger = loggerService.withContext('DataApi:CreationService')

type CreationCursor = string | null

const EMPTY_FILES: CreationFiles = { output: [], input: [] }

/** UpdateCreationDto field → DB column. `files`/`kind` are excluded: files live in `file_ref`; kind is immutable. */
export const UPDATE_CREATION_FIELD_MAP: Array<keyof UpdateCreationDto> = ['providerId', 'modelId', 'prompt']

function rowToCreation(row: CreationRow, files: CreationFiles): Creation {
  return {
    id: row.id,
    kind: row.kind as CreationKind,
    providerId: row.providerId,
    modelId: row.modelId,
    prompt: row.prompt,
    files,
    orderKey: row.orderKey,
    createdAt: timestampToISO(row.createdAt),
    updatedAt: timestampToISO(row.updatedAt)
  }
}

function normalizeModelId(providerId: string, modelId: string | null | undefined): string | null {
  if (!modelId) return null
  return isUniqueModelId(modelId) ? modelId : createUniqueModelId(providerId, modelId)
}

function decodeCursor(raw: string | undefined): CreationCursor {
  if (!raw) return null
  return raw
}

function encodeCursor(row: CreationRow): string {
  return row.orderKey
}

function cursorPredicate(cursor: CreationCursor): SQL | undefined {
  if (!cursor) return undefined
  return gt(creationTable.orderKey, cursor)
}

/**
 * Batch-load file_ref rows for a set of creation ids and group them by creation
 * id and role. Returns a Map from creation id → { output, input }.
 */
async function loadFilesForCreations(creationIds: readonly string[]): Promise<Map<string, CreationFiles>> {
  if (creationIds.length === 0) return new Map()
  const db = application.get('DbService').getDb()
  const refs = await db
    .select({
      sourceId: fileRefTable.sourceId,
      fileEntryId: fileRefTable.fileEntryId,
      role: fileRefTable.role
    })
    .from(fileRefTable)
    .where(and(eq(fileRefTable.sourceType, creationSourceType), inArray(fileRefTable.sourceId, [...creationIds])))

  const grouped = new Map<string, CreationFiles>()
  for (const ref of refs) {
    let bucket = grouped.get(ref.sourceId)
    if (!bucket) {
      bucket = { output: [], input: [] }
      grouped.set(ref.sourceId, bucket)
    }
    if (ref.role === 'output') bucket.output.push(ref.fileEntryId)
    else if (ref.role === 'input') bucket.input.push(ref.fileEntryId)
  }
  return grouped
}

class CreationService {
  async list(query: ListCreationsQuery): Promise<CreationListResponse> {
    const db = application.get('DbService').getDb()
    const conditions: SQL[] = []
    const filterConditions: SQL[] = []
    const limit = Math.min(query.limit ?? CREATIONS_DEFAULT_LIMIT, CREATIONS_MAX_LIMIT)
    const cursor = decodeCursor(query.cursor)

    if (query.kind) {
      filterConditions.push(eq(creationTable.kind, query.kind))
    }
    if (query.providerId) {
      filterConditions.push(eq(creationTable.providerId, query.providerId))
    }

    conditions.push(...filterConditions)

    const afterCursor = cursorPredicate(cursor)
    if (afterCursor) {
      conditions.push(afterCursor)
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined

    const [rows, countResult] = await Promise.all([
      db
        .select()
        .from(creationTable)
        .where(whereClause)
        .orderBy(asc(creationTable.orderKey))
        .limit(limit + 1),
      db
        .select({ count: sql<number>`count(*)` })
        .from(creationTable)
        .where(filterConditions.length > 0 ? and(...filterConditions) : undefined)
    ])
    const pageRows = rows.slice(0, limit)
    const filesByCreation = await loadFilesForCreations(pageRows.map((r) => r.id))

    return {
      items: pageRows.map((row) => rowToCreation(row, filesByCreation.get(row.id) ?? EMPTY_FILES)),
      total: countResult[0]?.count ?? 0,
      nextCursor: rows.length > limit ? encodeCursor(pageRows[pageRows.length - 1]) : undefined
    }
  }

  async getById(id: string): Promise<Creation> {
    const db = application.get('DbService').getDb()
    const [row] = await db.select().from(creationTable).where(eq(creationTable.id, id)).limit(1)

    if (!row) {
      throw DataApiErrorFactory.notFound('Creation', id)
    }

    const filesByCreation = await loadFilesForCreations([row.id])
    return rowToCreation(row, filesByCreation.get(row.id) ?? EMPTY_FILES)
  }

  async create(dto: CreateCreationDto): Promise<Creation> {
    const db = application.get('DbService').getDb()

    const row = await withSqliteErrors(
      () =>
        db.transaction(async (tx) => {
          const inserted = await insertWithOrderKey(
            tx,
            creationTable,
            {
              id: dto.id,
              kind: dto.kind,
              providerId: dto.providerId,
              modelId: normalizeModelId(dto.providerId, dto.modelId),
              prompt: dto.prompt
            },
            {
              pkColumn: creationTable.id,
              position: 'first'
            }
          )

          const insertedRow = inserted as CreationRow
          const now = Date.now()
          const refRows = await buildCreationRefRowsFiltered(tx, insertedRow.id, dto.files, now)
          if (refRows.length > 0) {
            await tx.insert(fileRefTable).values(refRows).onConflictDoNothing()
          }
          return insertedRow
        }),
      defaultHandlersFor('Creation', dto.id ?? '')
    )

    logger.info('Created creation', { id: row.id, kind: row.kind, providerId: row.providerId })

    // Return the requested `dto.files` (not the persisted refs): until the renderer creates
    // outputs via `createInternalEntry`, some ids may lack `file_entry` rows and be dropped by
    // the ref filter. Mirrors the former PaintingService behavior.
    return rowToCreation(row, dto.files)
  }

  async update(id: string, dto: UpdateCreationDto): Promise<Creation> {
    const db = application.get('DbService').getDb()
    const [existing] = await db.select().from(creationTable).where(eq(creationTable.id, id)).limit(1)
    if (!existing) {
      throw DataApiErrorFactory.notFound('Creation', id)
    }

    const updates: Partial<InsertCreationRow> = {}
    for (const key of UPDATE_CREATION_FIELD_MAP) {
      if (dto[key] !== undefined) {
        ;(updates as Record<string, unknown>)[key] = dto[key]
      }
    }

    if (dto.modelId !== undefined) {
      updates.modelId = normalizeModelId(updates.providerId ?? existing.providerId, dto.modelId)
    } else if (dto.providerId !== undefined && dto.providerId !== existing.providerId) {
      updates.modelId = null
    }

    const filesDirty = dto.files !== undefined

    if (Object.keys(updates).length === 0 && !filesDirty) {
      const filesByCreation = await loadFilesForCreations([existing.id])
      return rowToCreation(existing, filesByCreation.get(existing.id) ?? EMPTY_FILES)
    }

    const row = await withSqliteErrors(
      () =>
        db.transaction(async (tx) => {
          let target = existing
          if (Object.keys(updates).length > 0) {
            const [updated] = await tx.update(creationTable).set(updates).where(eq(creationTable.id, id)).returning()
            if (!updated) {
              throw DataApiErrorFactory.notFound('Creation', id)
            }
            target = updated
          }

          if (filesDirty) {
            // Wholesale replacement: `files` is the complete final state.
            await fileRefService.cleanupBySourceTx(tx, { sourceType: creationSourceType, sourceId: id })
            const refRows = await buildCreationRefRowsFiltered(tx, id, dto.files, Date.now())
            if (refRows.length > 0) {
              await tx.insert(fileRefTable).values(refRows).onConflictDoNothing()
            }
          }
          return target
        }),
      defaultHandlersFor('Creation', id)
    )

    logger.info('Updated creation', { id, changes: Object.keys(dto) })
    const files = filesDirty ? dto.files! : ((await loadFilesForCreations([row.id])).get(row.id) ?? EMPTY_FILES)
    return rowToCreation(row, files)
  }

  async delete(id: string): Promise<void> {
    const db = application.get('DbService').getDb()
    await this.getById(id)
    await withSqliteErrors(
      () =>
        db.transaction(async (tx) => {
          await tx.delete(creationTable).where(eq(creationTable.id, id))
          await fileRefService.cleanupBySourceTx(tx, { sourceType: creationSourceType, sourceId: id })
        }),
      defaultHandlersFor('Creation', id)
    )
    logger.info('Deleted creation', { id })
  }

  async reorder(id: string, anchor: OrderRequest): Promise<void> {
    const db = application.get('DbService').getDb()

    await db.transaction(async (tx) => {
      const [target] = await tx.select().from(creationTable).where(eq(creationTable.id, id)).limit(1)
      if (!target) {
        throw DataApiErrorFactory.notFound('Creation', id)
      }

      await applyMoves(tx, creationTable, [{ id, anchor }], { pkColumn: creationTable.id })

      logger.info('Reordered creations', { count: 1 })
    })
  }

  async reorderBatch(moves: Array<{ id: string; anchor: OrderRequest }>): Promise<void> {
    if (moves.length === 0) return

    const db = application.get('DbService').getDb()

    await db.transaction(async (tx) => {
      for (const move of moves) {
        const [target] = await tx.select().from(creationTable).where(eq(creationTable.id, move.id)).limit(1)
        if (!target) {
          throw DataApiErrorFactory.notFound('Creation', move.id)
        }
      }

      await applyMoves(tx, creationTable, moves, { pkColumn: creationTable.id })

      logger.info('Reordered creations', { count: moves.length })
    })
  }
}

/**
 * Build the `file_ref` rows for a creation, **filtered against `file_entry`** so
 * dangling ids don't trip the FK constraint (matches the former PaintingService helper).
 */
async function buildCreationRefRowsFiltered(
  tx: Pick<DbType, 'select'>,
  creationId: string,
  files: CreationFiles | undefined,
  now: number
): Promise<Array<typeof fileRefTable.$inferInsert>> {
  if (!files) return []
  const requested = new Set<string>()
  for (const id of files.output) requested.add(id)
  for (const id of files.input) requested.add(id)
  if (requested.size === 0) return []

  const existing = await tx
    .select({ id: fileEntryTable.id })
    .from(fileEntryTable)
    .where(inArray(fileEntryTable.id, [...requested]))
  const existingIds = new Set(existing.map((r) => r.id))

  const rows: Array<typeof fileRefTable.$inferInsert> = []
  let dropped = 0
  for (const fileId of files.output) {
    if (!existingIds.has(fileId)) {
      dropped += 1
      continue
    }
    rows.push({
      fileEntryId: fileId,
      sourceType: creationSourceType,
      sourceId: creationId,
      role: 'output',
      createdAt: now,
      updatedAt: now
    })
  }
  for (const fileId of files.input) {
    if (!existingIds.has(fileId)) {
      dropped += 1
      continue
    }
    rows.push({
      fileEntryId: fileId,
      sourceType: creationSourceType,
      sourceId: creationId,
      role: 'input',
      createdAt: now,
      updatedAt: now
    })
  }
  if (dropped > 0) {
    logger.warn('Dropped creation file refs without matching file_entry', {
      creationId,
      dropped,
      total: requested.size
    })
  }
  return rows
}

export const creationService = new CreationService()
