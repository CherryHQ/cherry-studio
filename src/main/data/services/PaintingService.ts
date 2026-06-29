/**
 * Painting Service — painting CRUD, list, and reorder
 *
 * Provides business logic for:
 * - Listing and filtering paintings
 * - Row to API Painting conversion
 *
 * Output / input files are stored in `file_ref` (not on the painting row).
 * `create` writes the refs; `get` / `list` hydrate them via a single
 * `IN (...)` query, then group by sourceId + role. `delete` derefs through
 * `fileRefService.cleanupBySourceTx`.
 */

import { application } from '@application'
import { fileEntryTable, fileRefTable } from '@data/db/schemas/file'
import { type InsertPaintingRow, type PaintingRow, paintingTable } from '@data/db/schemas/painting'
import { defaultHandlersFor, withSqliteErrors } from '@data/db/sqliteErrors'
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
import { PAINTINGS_DEFAULT_LIMIT, PAINTINGS_MAX_LIMIT } from '@shared/data/api/schemas/paintings'
import { paintingSourceType } from '@shared/data/types/file/ref'
import { createUniqueModelId, isUniqueModelId } from '@shared/data/types/model'
import type { Painting, PaintingFiles } from '@shared/data/types/painting'
import type { SQL } from 'drizzle-orm'
import { and, eq, inArray, sql } from 'drizzle-orm'

import { fileRefService } from './FileRefService'
import { asStringKey, decodeListCursor, encodeCursor, keysetOrdering } from './utils/keysetCursor'
import { applyMoves, insertWithOrderKey } from './utils/orderKey'
import { timestampToISO } from './utils/rowMappers'

const logger = loggerService.withContext('DataApi:PaintingService')

const EMPTY_FILES: PaintingFiles = { output: [], input: [] }

/**
 * Mapping from UpdatePaintingDto field → DB column for the update path.
 * Exported for test coverage — ensures no DTO field is silently dropped.
 *
 * `files` is intentionally NOT in this map: file membership is owned by
 * `file_ref`, not the painting row. The update path handles it separately.
 */
export const UPDATE_PAINTING_FIELD_MAP: Array<keyof UpdatePaintingDto> = ['providerId', 'modelId', 'prompt']

function rowToPainting(row: PaintingRow, files: PaintingFiles): Painting {
  return {
    id: row.id,
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

/**
 * Batch-load file_ref rows for a set of painting ids and group them by
 * painting id and role. Returns a Map from painting id → { output, input }.
 * Paintings with no refs simply don't appear in the map.
 */
async function loadFilesForPaintings(paintingIds: readonly string[]): Promise<Map<string, PaintingFiles>> {
  if (paintingIds.length === 0) return new Map()
  const db = application.get('DbService').getDb()
  const refs = await db
    .select({
      sourceId: fileRefTable.sourceId,
      fileEntryId: fileRefTable.fileEntryId,
      role: fileRefTable.role
    })
    .from(fileRefTable)
    .where(and(eq(fileRefTable.sourceType, paintingSourceType), inArray(fileRefTable.sourceId, [...paintingIds])))

  const grouped = new Map<string, PaintingFiles>()
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

class PaintingService {
  async list(query: ListPaintingsQuery): Promise<PaintingListResponse> {
    const db = application.get('DbService').getDb()
    const conditions: SQL[] = []
    const filterConditions: SQL[] = []
    const limit = Math.min(query.limit ?? PAINTINGS_DEFAULT_LIMIT, PAINTINGS_MAX_LIMIT)
    const ordering = keysetOrdering(paintingTable.orderKey, paintingTable.id, { major: 'asc', tie: 'asc' })
    const cursor = decodeListCursor(query.cursor, asStringKey, 'painting')

    if (query.providerId) {
      filterConditions.push(eq(paintingTable.providerId, query.providerId))
    }

    conditions.push(...filterConditions)

    if (cursor) {
      conditions.push(ordering.where(cursor))
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined

    const [rows, countResult] = await Promise.all([
      db
        .select()
        .from(paintingTable)
        .where(whereClause)
        .orderBy(...ordering.orderBy)
        .limit(limit + 1),
      db
        .select({ count: sql<number>`count(*)` })
        .from(paintingTable)
        .where(filterConditions.length > 0 ? and(...filterConditions) : undefined)
    ])
    const pageRows = rows.slice(0, limit)
    const filesByPainting = await loadFilesForPaintings(pageRows.map((r) => r.id))

    return {
      items: pageRows.map((row) => rowToPainting(row, filesByPainting.get(row.id) ?? EMPTY_FILES)),
      total: countResult[0]?.count ?? 0,
      nextCursor:
        rows.length > limit
          ? encodeCursor(pageRows[pageRows.length - 1].orderKey, pageRows[pageRows.length - 1].id)
          : undefined
    }
  }

  async getById(id: string): Promise<Painting> {
    const db = application.get('DbService').getDb()
    const [row] = await db.select().from(paintingTable).where(eq(paintingTable.id, id)).limit(1)

    if (!row) {
      throw DataApiErrorFactory.notFound('Painting', id)
    }

    const filesByPainting = await loadFilesForPaintings([row.id])
    return rowToPainting(row, filesByPainting.get(row.id) ?? EMPTY_FILES)
  }

  async create(dto: CreatePaintingDto): Promise<Painting> {
    const db = application.get('DbService').getDb()

    const row = await withSqliteErrors(
      () =>
        db.transaction(async (tx) => {
          const inserted = await insertWithOrderKey(
            tx,
            paintingTable,
            {
              id: dto.id,
              providerId: dto.providerId,
              modelId: normalizeModelId(dto.providerId, dto.modelId),
              prompt: dto.prompt
            },
            {
              pkColumn: paintingTable.id,
              position: 'first'
            }
          )

          const insertedRow = inserted as PaintingRow
          const now = Date.now()
          const refRows = await buildPaintingRefRowsFiltered(tx, insertedRow.id, dto.files, now)
          if (refRows.length > 0) {
            await tx.insert(fileRefTable).values(refRows).onConflictDoNothing()
          }
          return insertedRow
        }),
      defaultHandlersFor('Painting', dto.id ?? '')
    )

    logger.info('Created painting', {
      id: row.id,
      providerId: row.providerId
    })

    // Return the requested `dto.files`, NOT the persisted refs. During the
    // v1→v2 transition the renderer attaches outputs through the legacy
    // FileManager path, so their `file_entry` rows don't exist yet and
    // `buildPaintingRefRowsFiltered` drops every id — re-hydrating here would
    // hand back empty files for a painting the caller just populated. The
    // divergence from `list`/`get` (which read `file_ref`) is intentional and
    // disappears once the renderer cuts over to `createInternalEntry`.
    return rowToPainting(row, dto.files)
  }

  async update(id: string, dto: UpdatePaintingDto): Promise<Painting> {
    const db = application.get('DbService').getDb()
    const [existing] = await db.select().from(paintingTable).where(eq(paintingTable.id, id)).limit(1)
    if (!existing) {
      throw DataApiErrorFactory.notFound('Painting', id)
    }

    const updates: Partial<InsertPaintingRow> = {}
    for (const key of UPDATE_PAINTING_FIELD_MAP) {
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
      const filesByPainting = await loadFilesForPaintings([existing.id])
      return rowToPainting(existing, filesByPainting.get(existing.id) ?? EMPTY_FILES)
    }

    const row = await withSqliteErrors(
      () =>
        db.transaction(async (tx) => {
          let target = existing
          if (Object.keys(updates).length > 0) {
            const [updated] = await tx.update(paintingTable).set(updates).where(eq(paintingTable.id, id)).returning()
            if (!updated) {
              throw DataApiErrorFactory.notFound('Painting', id)
            }
            target = updated
          }

          if (filesDirty) {
            // Replace the painting's file refs wholesale: clear existing refs,
            // then insert the new set. Wholesale replacement matches DTO
            // semantics — `files` is the complete final state — and avoids
            // per-id diffing that would also need to honor the UNIQUE
            // (fileEntryId, sourceType, sourceId, role) constraint.
            await fileRefService.cleanupBySourceTx(tx, { sourceType: paintingSourceType, sourceId: id })
            const refRows = await buildPaintingRefRowsFiltered(tx, id, dto.files, Date.now())
            if (refRows.length > 0) {
              await tx.insert(fileRefTable).values(refRows).onConflictDoNothing()
            }
          }
          return target
        }),
      defaultHandlersFor('Painting', id)
    )

    logger.info('Updated painting', { id, changes: Object.keys(dto) })
    // On a files write, echo the requested `dto.files` for the same reason as
    // `create` (transition-era ids aren't in `file_entry` yet, so the persisted
    // refs would under-report). Otherwise hydrate from the stored refs.
    const files = filesDirty ? dto.files! : ((await loadFilesForPaintings([row.id])).get(row.id) ?? EMPTY_FILES)
    return rowToPainting(row, files)
  }

  async delete(id: string): Promise<void> {
    const db = application.get('DbService').getDb()
    await this.getById(id)
    // Delete the painting row and its file refs in one atomic boundary.
    await withSqliteErrors(
      () =>
        db.transaction(async (tx) => {
          await tx.delete(paintingTable).where(eq(paintingTable.id, id))
          await fileRefService.cleanupBySourceTx(tx, { sourceType: paintingSourceType, sourceId: id })
        }),
      defaultHandlersFor('Painting', id)
    )
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

/**
 * Build the `file_ref` rows for a painting, **filtered against `file_entry`**
 * so dangling ids don't trip the FK constraint.
 *
 * During the v1→v2 transition the renderer still writes new painting outputs
 * through the legacy `FileManager.addFiles` path (Dexie + disk only), so the
 * v2 `file_entry` row doesn't exist for those ids yet. Pre-filtering keeps
 * the painting create/update succeeding for v2-migrated paintings (whose ids
 * are already in `file_entry`) while letting v1-side ids drop silently —
 * matches the same defensive pattern the `PaintingMigrator` uses on backfill.
 *
 * The dropped ids are logged so the gap is visible in dev consoles until
 * the renderer cuts over to `window.api.file.createInternalEntry`. After
 * that cutover all ids should resolve and the filter becomes a no-op.
 */
async function buildPaintingRefRowsFiltered(
  tx: Pick<DbType, 'select'>,
  paintingId: string,
  files: PaintingFiles | undefined,
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
      sourceType: paintingSourceType,
      sourceId: paintingId,
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
      sourceType: paintingSourceType,
      sourceId: paintingId,
      role: 'input',
      createdAt: now,
      updatedAt: now
    })
  }
  if (dropped > 0) {
    logger.warn('Dropped painting file refs without matching file_entry', {
      paintingId,
      dropped,
      total: requested.size
    })
  }
  return rows
}

export const paintingService = new PaintingService()
