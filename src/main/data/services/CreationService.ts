/**
 * Creation Service — generation-receipt CRUD, list, and reorder. Unifies the
 * former PaintingService + VideoService behind one `creation` table with a
 * `kind: 'image' | 'video'` discriminator.
 *
 * Output / input files are stored in `creation_file_ref` (not on the creation
 * row). `create` writes the refs; `get` / `list` hydrate them via a single
 * `IN (...)` query, then group by sourceId + role. `delete` relies on DB-level
 * cascade from `creation_file_ref.sourceId`.
 */

import { application } from '@application'
import { type CreationRow, creationTable, type InsertCreationRow } from '@data/db/schemas/creation'
import { fileEntryTable } from '@data/db/schemas/file'
import { creationFileRefTable } from '@data/db/schemas/fileRelations'
import { defaultHandlersFor, withSqliteErrors } from '@data/db/sqliteErrors'
import type { DbType } from '@data/db/types'
import { loggerService } from '@logger'
import { DataApiErrorFactory } from '@shared/data/api/errors'
import type { OrderRequest } from '@shared/data/api/schemas/_endpointHelpers'
import type {
  CreateCreationDto,
  CreationListResponse,
  ListCreationsQuery,
  UpdateCreationDto
} from '@shared/data/api/schemas/creations'
import { CREATIONS_DEFAULT_LIMIT, CREATIONS_MAX_LIMIT } from '@shared/data/api/schemas/creations'
import type { Creation, CreationFiles, CreationKind } from '@shared/data/types/creation'
import { createUniqueModelId, isUniqueModelId } from '@shared/data/types/model'
import type { SQL } from 'drizzle-orm'
import { and, eq, inArray, sql } from 'drizzle-orm'

import { asStringKey, decodeListCursor, encodeCursor, keysetOrdering } from './utils/keysetCursor'
import { applyMoves, insertWithOrderKey } from './utils/orderKey'
import { timestampToISO } from './utils/rowMappers'

const logger = loggerService.withContext('DataApi:CreationService')

const EMPTY_FILES: CreationFiles = { output: [], input: [] }

/**
 * Mapping from UpdateCreationDto field → DB column for the update path.
 * Exported for test coverage — ensures no DTO field is silently dropped.
 *
 * `files` is intentionally NOT in this map: file membership is owned by
 * `creation_file_ref`, not the creation row. The update path handles it
 * separately. `kind` is excluded because it is immutable.
 */
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

/**
 * Batch-load creation_file_ref rows for a set of creation ids and group them
 * by creation id and role. Returns a Map from creation id → { output, input }.
 * Creations with no refs simply don't appear in the map.
 */
function loadFilesForCreations(creationIds: readonly string[]): Map<string, CreationFiles> {
  if (creationIds.length === 0) return new Map()
  const db = application.get('DbService').getDb()
  const refs = db
    .select({
      sourceId: creationFileRefTable.sourceId,
      fileEntryId: creationFileRefTable.fileEntryId,
      role: creationFileRefTable.role
    })
    .from(creationFileRefTable)
    .where(inArray(creationFileRefTable.sourceId, [...creationIds]))
    .all()

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
  list(query: ListCreationsQuery): CreationListResponse {
    const db = application.get('DbService').getDb()
    const conditions: SQL[] = []
    const filterConditions: SQL[] = []
    const limit = Math.min(query.limit ?? CREATIONS_DEFAULT_LIMIT, CREATIONS_MAX_LIMIT)
    const ordering = keysetOrdering(creationTable.orderKey, creationTable.id, { major: 'asc', tie: 'asc' })
    const cursor = decodeListCursor(query.cursor, asStringKey, 'creation')

    if (query.kind) {
      filterConditions.push(eq(creationTable.kind, query.kind))
    }
    if (query.providerId) {
      filterConditions.push(eq(creationTable.providerId, query.providerId))
    }

    conditions.push(...filterConditions)

    if (cursor) {
      conditions.push(ordering.where(cursor))
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined

    const rows = db
      .select()
      .from(creationTable)
      .where(whereClause)
      .orderBy(...ordering.orderBy)
      .limit(limit + 1)
      .all()
    const countResult = db
      .select({ count: sql<number>`count(*)` })
      .from(creationTable)
      .where(filterConditions.length > 0 ? and(...filterConditions) : undefined)
      .all()
    const pageRows = rows.slice(0, limit)
    const filesByCreation = loadFilesForCreations(pageRows.map((r) => r.id))

    return {
      items: pageRows.map((row) => rowToCreation(row, filesByCreation.get(row.id) ?? EMPTY_FILES)),
      total: countResult[0]?.count ?? 0,
      nextCursor:
        rows.length > limit
          ? encodeCursor(pageRows[pageRows.length - 1].orderKey, pageRows[pageRows.length - 1].id)
          : undefined
    }
  }

  getById(id: string): Creation {
    const db = application.get('DbService').getDb()
    const [row] = db.select().from(creationTable).where(eq(creationTable.id, id)).limit(1).all()

    if (!row) {
      throw DataApiErrorFactory.notFound('Creation', id)
    }

    const filesByCreation = loadFilesForCreations([row.id])
    return rowToCreation(row, filesByCreation.get(row.id) ?? EMPTY_FILES)
  }

  create(dto: CreateCreationDto): Creation {
    const dbService = application.get('DbService')

    const row = withSqliteErrors(
      () =>
        dbService.withWriteTx((tx) => {
          const inserted = insertWithOrderKey(
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
          const refRows = buildCreationRefRowsFiltered(tx, insertedRow.id, dto.files, now)
          if (refRows.length > 0) {
            tx.insert(creationFileRefTable).values(refRows).onConflictDoNothing().run()
          }
          return insertedRow
        }),
      defaultHandlersFor('Creation', dto.id ?? '')
    )

    logger.info('Created creation', {
      id: row.id,
      kind: row.kind,
      providerId: row.providerId
    })

    // Return the requested `dto.files`, NOT the persisted refs. During the
    // v1→v2 transition the renderer attaches outputs through the legacy
    // FileManager path, so their `file_entry` rows don't exist yet and
    // `buildCreationRefRowsFiltered` drops every id — re-hydrating here would
    // hand back empty files for a creation the caller just populated. The
    // divergence from `list`/`get` (which read `creation_file_ref`) is intentional
    // and disappears once the renderer cuts over to `createInternalEntry`.
    return rowToCreation(row, dto.files)
  }

  update(id: string, dto: UpdateCreationDto): Creation {
    const dbService = application.get('DbService')
    const db = dbService.getDb()
    const [existing] = db.select().from(creationTable).where(eq(creationTable.id, id)).limit(1).all()
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
      const filesByCreation = loadFilesForCreations([existing.id])
      return rowToCreation(existing, filesByCreation.get(existing.id) ?? EMPTY_FILES)
    }

    const row = withSqliteErrors(
      () =>
        dbService.withWriteTx((tx) => {
          let target = existing
          if (Object.keys(updates).length > 0) {
            const [updated] = tx.update(creationTable).set(updates).where(eq(creationTable.id, id)).returning().all()
            if (!updated) {
              throw DataApiErrorFactory.notFound('Creation', id)
            }
            target = updated
          }

          if (filesDirty) {
            // Replace the creation's file refs wholesale: clear existing refs,
            // then insert the new set. Wholesale replacement matches DTO
            // semantics — `files` is the complete final state — and avoids
            // per-id diffing that would also need to honor the UNIQUE
            // (fileEntryId, sourceId, role) constraint.
            tx.delete(creationFileRefTable).where(eq(creationFileRefTable.sourceId, id)).run()
            const refRows = buildCreationRefRowsFiltered(tx, id, dto.files, Date.now())
            if (refRows.length > 0) {
              tx.insert(creationFileRefTable).values(refRows).onConflictDoNothing().run()
            }
          }
          return target
        }),
      defaultHandlersFor('Creation', id)
    )

    logger.info('Updated creation', { id, changes: Object.keys(dto) })
    // On a files write, echo the requested `dto.files` for the same reason as
    // `create` (transition-era ids aren't in `file_entry` yet, so the persisted
    // refs would under-report). Otherwise hydrate from the stored refs.
    const files = filesDirty ? dto.files! : (loadFilesForCreations([row.id]).get(row.id) ?? EMPTY_FILES)
    return rowToCreation(row, files)
  }

  delete(id: string): void {
    this.getById(id)
    // creation_file_ref rows are removed by the FK cascade.
    withSqliteErrors(
      () => application.get('DbService').getDb().delete(creationTable).where(eq(creationTable.id, id)).run(),
      defaultHandlersFor('Creation', id)
    )
    logger.info('Deleted creation', { id })
  }

  reorder(id: string, anchor: OrderRequest): void {
    const dbService = application.get('DbService')

    dbService.withWriteTx((tx) => {
      const [target] = tx.select().from(creationTable).where(eq(creationTable.id, id)).limit(1).all()
      if (!target) {
        throw DataApiErrorFactory.notFound('Creation', id)
      }

      applyMoves(tx, creationTable, [{ id, anchor }], {
        pkColumn: creationTable.id
      })

      logger.info('Reordered creations', {
        count: 1
      })
    })
  }

  reorderBatch(moves: Array<{ id: string; anchor: OrderRequest }>): void {
    if (moves.length === 0) return

    const dbService = application.get('DbService')

    dbService.withWriteTx((tx) => {
      for (const move of moves) {
        const [target] = tx.select().from(creationTable).where(eq(creationTable.id, move.id)).limit(1).all()
        if (!target) {
          throw DataApiErrorFactory.notFound('Creation', move.id)
        }
      }

      applyMoves(tx, creationTable, moves, {
        pkColumn: creationTable.id
      })

      logger.info('Reordered creations', {
        count: moves.length
      })
    })
  }
}

/**
 * Build the `creation_file_ref` rows for a creation, **filtered against `file_entry`**
 * so dangling ids don't trip the FK constraint.
 *
 * During the v1→v2 transition the renderer still writes new creation outputs
 * through the legacy `FileManager.addFiles` path (Dexie + disk only), so the
 * v2 `file_entry` row doesn't exist for those ids yet. Pre-filtering keeps
 * the creation create/update succeeding for v2-migrated creations (whose ids
 * are already in `file_entry`) while letting v1-side ids drop silently —
 * matches the same defensive pattern the `PaintingMigrator` uses on backfill.
 *
 * The dropped ids are logged so the gap is visible in dev consoles until
 * the renderer cuts over to `window.api.file.createInternalEntry`. After
 * that cutover all ids should resolve and the filter becomes a no-op.
 */
function buildCreationRefRowsFiltered(
  tx: Pick<DbType, 'select'>,
  creationId: string,
  files: CreationFiles | undefined,
  now: number
): Array<typeof creationFileRefTable.$inferInsert> {
  if (!files) return []
  const requested = new Set<string>()
  for (const id of files.output) requested.add(id)
  for (const id of files.input) requested.add(id)
  if (requested.size === 0) return []

  const existing = tx
    .select({ id: fileEntryTable.id })
    .from(fileEntryTable)
    .where(inArray(fileEntryTable.id, [...requested]))
    .all()
  const existingIds = new Set(existing.map((r) => r.id))

  const rows: Array<typeof creationFileRefTable.$inferInsert> = []
  let dropped = 0
  for (const fileId of files.output) {
    if (!existingIds.has(fileId)) {
      dropped += 1
      continue
    }
    rows.push({
      fileEntryId: fileId,
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
