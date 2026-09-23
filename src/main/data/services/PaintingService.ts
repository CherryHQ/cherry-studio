/**
 * Painting Service — painting CRUD, list, and reorder
 *
 * Provides business logic for:
 * - Listing and filtering paintings
 * - Row to API Painting conversion
 *
 * Output / input files are stored in `painting_file_ref` (not on the painting
 * row). `create` writes the refs; `get` / `list` hydrate them via a single
 * `IN (...)` query, then group by sourceId + role. `delete` moves to the Recycle Bin by
 * default (soft delete — refs untouched, so the orphan sweep keeps the disk
 * images); `permanent: true` hard-deletes only an already-trashed row, while
 * `purgeExpiredTx` hard-deletes expired rows. Both rely on the DB-level cascade
 * from `painting_file_ref.sourceId`.
 */

import type { SQL } from 'drizzle-orm'
import { and, asc, eq, getTableColumns, inArray, isNotNull, isNull, lt, or, sql } from 'drizzle-orm'

import { application } from '@application'
import { notifyDataApiDataChange } from '@data/dataApiDataChange'
import { fileEntryTable } from '@data/db/schemas/file'
import { paintingFileRefTable } from '@data/db/schemas/fileRelations'
import { type InsertPaintingRow, type PaintingRow, paintingTable } from '@data/db/schemas/painting'
import { defaultHandlersFor, withSqliteErrors } from '@data/db/sqliteErrors'
import type { DbOrTx, DbType } from '@data/db/types'
import { loggerService } from '@logger'
import { DataApiErrorFactory } from '@shared/data/api/errors'
import type { OrderRequest } from '@shared/data/api/schemas/_endpointHelpers'
import type {
  CreatePaintingDto,
  ListPaintingsQuery,
  PaintingListResponse,
  UpdatePaintingDto
} from '@shared/data/api/schemas/paintings'
import { PAINTINGS_DEFAULT_LIMIT, PAINTINGS_MAX_LIMIT } from '@shared/data/api/schemas/paintings'
import { createUniqueModelId, isUniqueModelId } from '@shared/data/types/model'
import type { Painting, PaintingFiles } from '@shared/data/types/painting'

import { asStringKey, decodeListCursor, encodeCursor, keysetOrdering } from './utils/keysetCursor'
import { applyMoves, insertWithOrderKey } from './utils/orderKey'
import { timestampToISO } from './utils/rowMappers'

const logger = loggerService.withContext('DataApi:PaintingService')

const EMPTY_FILES: PaintingFiles = { output: [], input: [] }

interface PaintingFileSnapshot {
  files: PaintingFiles
  fingerprint: string
}

/**
 * Mapping from UpdatePaintingDto field → DB column for the update path.
 * Exported for test coverage — ensures no DTO field is silently dropped.
 *
 * `files` is intentionally NOT in this map: file membership is owned by
 * `painting_file_ref`, not the painting row. The update path handles it separately.
 */
export const UPDATE_PAINTING_FIELD_MAP: Array<keyof UpdatePaintingDto> = [
  'providerId',
  'modelId',
  'prompt',
  'stepStatus',
  'stepError'
]

function rowToPainting(
  row: PaintingRow & { previewFileId?: string | null },
  files: PaintingFiles,
  fileDataFingerprint?: string
): Painting {
  return {
    id: row.id,
    providerId: row.providerId,
    modelId: row.modelId,
    prompt: row.prompt,
    projectId: row.projectId,
    stepNumber: row.stepNumber,
    parentId: row.parentId,
    sourceFileId: row.sourceFileId,
    operation: row.operation,
    params: row.params,
    stepStatus: row.stepStatus,
    stepError: row.stepError,
    selectedStepId: row.selectedStepId,
    selectedFileId: row.selectedFileId,
    files,
    ...(row.previewFileId ? { previewFileId: row.previewFileId } : {}),
    ...(fileDataFingerprint ? { fileDataFingerprint } : {}),
    orderKey: row.orderKey,
    createdAt: timestampToISO(row.createdAt),
    updatedAt: timestampToISO(row.updatedAt),
    deletedAt: row.deletedAt != null ? timestampToISO(row.deletedAt) : undefined
  }
}

function normalizeModelId(providerId: string, modelId: string | null | undefined): string | null {
  if (!modelId) return null
  return isUniqueModelId(modelId) ? modelId : createUniqueModelId(providerId, modelId)
}

/**
 * Batch-load painting_file_ref rows for a set of painting ids and group them
 * by painting id and role. Returns a Map from painting id → { output, input }.
 * Paintings with no refs simply don't appear in the map.
 */
function loadFilesForPaintings(paintingIds: readonly string[]): Map<string, PaintingFileSnapshot> {
  if (paintingIds.length === 0) return new Map()
  const db = application.get('DbService').getDb()
  const refs = db
    .select({
      sourceId: paintingFileRefTable.sourceId,
      fileEntryId: paintingFileRefTable.fileEntryId,
      role: paintingFileRefTable.role,
      entryOrigin: fileEntryTable.origin,
      entryName: fileEntryTable.name,
      entryExt: fileEntryTable.ext,
      entrySize: fileEntryTable.size,
      entryExternalPath: fileEntryTable.externalPath,
      entryCreatedAt: fileEntryTable.createdAt,
      entryDeletedAt: fileEntryTable.deletedAt
    })
    .from(paintingFileRefTable)
    .innerJoin(fileEntryTable, eq(fileEntryTable.id, paintingFileRefTable.fileEntryId))
    .where(inArray(paintingFileRefTable.sourceId, [...paintingIds]))
    // The legacy ref schema has no explicit ordinal. Every writer inserts refs
    // in DTO order, so SQLite's persisted insertion order is the only faithful
    // tie-breaker when a batch shares one timestamp; UUID v4 order is random.
    .orderBy(asc(paintingFileRefTable.createdAt), asc(sql`${paintingFileRefTable}.rowid`))
    .all()

  const grouped = new Map<string, { files: PaintingFiles; dependencies: unknown[] }>()
  for (const ref of refs) {
    let bucket = grouped.get(ref.sourceId)
    if (!bucket) {
      bucket = { files: { output: [], input: [] }, dependencies: [] }
      grouped.set(ref.sourceId, bucket)
    }
    if (ref.role === 'output') bucket.files.output.push(ref.fileEntryId)
    else if (ref.role === 'input') bucket.files.input.push(ref.fileEntryId)
    // Include only data consumed by painting hydration. In particular, omit
    // cleanup policy, content hash, and updatedAt so unrelated file maintenance
    // does not invalidate the expensive renderer cache.
    bucket.dependencies.push([
      ref.role,
      ref.fileEntryId,
      ref.entryOrigin,
      ref.entryName,
      ref.entryExt,
      ref.entrySize,
      ref.entryExternalPath,
      ref.entryCreatedAt,
      ref.entryDeletedAt
    ])
  }
  return new Map(
    [...grouped].map(([paintingId, snapshot]) => [
      paintingId,
      {
        files: snapshot.files,
        fingerprint: JSON.stringify(snapshot.dependencies)
      }
    ])
  )
}

class PaintingService {
  /**
   * Mark running steps that no longer have an active image-generation job.
   *
   * A running step is normally owned by either the renderer's synchronous
   * request or an `image-generation.generate` job. After a process restart the
   * former has no durable owner, so leaving it running would expose a stale
   * cancel/retry state forever. The caller supplies the active job-owned
   * painting ids; this method only transitions the remaining rows.
   */
  markOrphanedRunningSteps(activePaintingIds: ReadonlySet<string>): string[] {
    const dbService = application.get('DbService')
    const db = dbService.getDb()
    const runningIds = db
      .select({ id: paintingTable.id })
      .from(paintingTable)
      .where(and(eq(paintingTable.stepStatus, 'running'), isNull(paintingTable.deletedAt)))
      .all()
      .map(({ id }) => id)
    const orphanedIds = runningIds.filter((id) => !activePaintingIds.has(id))
    if (orphanedIds.length === 0) return []

    const stepError = 'Image generation was interrupted when the application stopped.'
    dbService.withWriteTx((tx) => {
      tx.update(paintingTable)
        .set({ stepStatus: 'interrupted', stepError, updatedAt: Date.now() })
        .where(and(inArray(paintingTable.id, orphanedIds), eq(paintingTable.stepStatus, 'running')))
        .run()
    })
    this.notifyReadModelChange(orphanedIds, 'projection')
    logger.info('Marked orphaned painting steps as interrupted', {
      count: orphanedIds.length
    })
    return orphanedIds
  }

  notifyReadModelChange(paintingIds: readonly string[], kind: 'membership' | 'projection'): void {
    if (paintingIds.length === 0) return
    const entityIds = [...new Set(paintingIds)]
    notifyDataApiDataChange([
      { endpoint: '/paintings', kind, entityIds },
      { endpoint: '/paintings/:id', entityIds }
    ])
  }

  list(query: ListPaintingsQuery): PaintingListResponse {
    const db = application.get('DbService').getDb()
    const conditions: SQL[] = []
    const filterConditions: SQL[] = []
    const limit = Math.min(query.limit ?? PAINTINGS_DEFAULT_LIMIT, PAINTINGS_MAX_LIMIT)
    const ordering = keysetOrdering(paintingTable.orderKey, paintingTable.id, {
      major: 'asc',
      tie: 'asc'
    })
    const cursor = decodeListCursor(query.cursor, asStringKey, 'painting')

    if (query.providerId) {
      filterConditions.push(eq(paintingTable.providerId, query.providerId))
    }

    if (query.projectsOnly || query.inTrash) filterConditions.push(isNull(paintingTable.projectId))
    if (query.projectId)
      filterConditions.push(or(eq(paintingTable.id, query.projectId), eq(paintingTable.projectId, query.projectId))!)
    // Trash filter lives in filterConditions so the page query AND the
    // count(*) query below honor it — total must match the visible set.
    filterConditions.push(query.inTrash === true ? isNotNull(paintingTable.deletedAt) : isNull(paintingTable.deletedAt))

    conditions.push(...filterConditions)

    if (cursor) {
      conditions.push(ordering.where(cursor))
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined

    const rows = db
      .select({
        ...getTableColumns(paintingTable),
        previewFileId: query.projectsOnly
          ? sql<string | null>`(
          SELECT refs.file_entry_id FROM painting AS steps
          JOIN painting AS project ON project.id = COALESCE(steps.project_id, steps.id)
          JOIN painting_file_ref AS refs ON refs.source_id = steps.id AND refs.role = 'output'
          JOIN file_entry AS files ON files.id = refs.file_entry_id AND files.deleted_at IS NULL
          WHERE (steps.id = painting.id OR steps.project_id = painting.id)
            AND steps.step_status = 'completed'
          ORDER BY (steps.id = COALESCE(project.selected_step_id, '')) DESC,
            steps.step_number DESC,
            (refs.file_entry_id = COALESCE(project.selected_file_id, '')) DESC,
            refs.created_at ASC, refs.rowid ASC
          LIMIT 1
        )`
          : sql<null>`NULL`
      })
      .from(paintingTable)
      .where(whereClause)
      .orderBy(...ordering.orderBy)
      .limit(limit + 1)
      .all()
    const countResult = db
      .select({ count: sql<number>`count(*)` })
      .from(paintingTable)
      .where(filterConditions.length > 0 ? and(...filterConditions) : undefined)
      .all()
    const pageRows = rows.slice(0, limit)
    const filesByPainting = loadFilesForPaintings(pageRows.map((r) => r.id))

    return {
      items: pageRows.map((row) => {
        const snapshot = filesByPainting.get(row.id)
        return rowToPainting(row, snapshot?.files ?? EMPTY_FILES, snapshot?.fingerprint)
      }),
      total: countResult[0]?.count ?? 0,
      nextCursor:
        rows.length > limit
          ? encodeCursor(pageRows[pageRows.length - 1].orderKey, pageRows[pageRows.length - 1].id)
          : undefined
    }
  }

  getById(id: string): Painting {
    const db = application.get('DbService').getDb()
    const [row] = db
      .select()
      .from(paintingTable)
      .where(and(eq(paintingTable.id, id), isNull(paintingTable.deletedAt)))
      .limit(1)
      .all()

    if (!row) {
      throw DataApiErrorFactory.notFound('Painting', id)
    }

    const filesByPainting = loadFilesForPaintings([row.id])
    const snapshot = filesByPainting.get(row.id)
    return rowToPainting(row, snapshot?.files ?? EMPTY_FILES, snapshot?.fingerprint)
  }

  getProjectStepIds(projectId: string): string[] {
    const project = this.getById(projectId)
    if (project.projectId) throw DataApiErrorFactory.invalidOperation('Expected a project root')
    return application
      .get('DbService')
      .getDb()
      .select({ id: paintingTable.id })
      .from(paintingTable)
      .where(
        and(
          or(eq(paintingTable.id, projectId), eq(paintingTable.projectId, projectId)),
          isNull(paintingTable.deletedAt)
        )
      )
      .all()
      .map(({ id }) => id)
  }

  create(dto: CreatePaintingDto): Painting {
    const dbService = application.get('DbService')

    const row = withSqliteErrors(
      () =>
        dbService.withWriteTx((tx) => {
          if (dto.projectId) {
            const project = this.getById(dto.projectId)
            if (project.projectId) throw DataApiErrorFactory.invalidOperation('Expected a project root')
          }
          if (dto.parentId) {
            const parent = this.getById(dto.parentId)
            if ((parent.projectId ?? parent.id) !== dto.projectId)
              throw DataApiErrorFactory.invalidOperation('Parent belongs to a different project')
            if (dto.sourceFileId && !parent.files.output.includes(dto.sourceFileId))
              throw DataApiErrorFactory.invalidOperation('Source image is not an output of the parent step')
          }
          if (dto.operation === 'edit' && (!dto.sourceFileId || !dto.files.input.includes(dto.sourceFileId)))
            throw DataApiErrorFactory.invalidOperation('Editing requires the referenced source image')
          const stepNumber = dto.projectId
            ? (tx
                .select({
                  number: sql<number>`max(${paintingTable.stepNumber})`
                })
                .from(paintingTable)
                .where(or(eq(paintingTable.id, dto.projectId), eq(paintingTable.projectId, dto.projectId)))
                .get()?.number ?? 0) + 1
            : 1
          const inserted = insertWithOrderKey(
            tx,
            paintingTable,
            {
              id: dto.id,
              providerId: dto.providerId,
              modelId: normalizeModelId(dto.providerId, dto.modelId),
              prompt: dto.prompt,
              projectId: dto.projectId,
              stepNumber,
              parentId: dto.parentId,
              sourceFileId: dto.sourceFileId,
              operation: dto.operation,
              params: dto.params,
              stepStatus: dto.stepStatus
            },
            {
              pkColumn: paintingTable.id,
              position: 'first'
            }
          )

          const insertedRow = inserted as PaintingRow
          const now = Date.now()
          const refRows = buildPaintingRefRowsFiltered(tx, insertedRow.id, dto.files, now)
          if (refRows.length > 0) {
            tx.insert(paintingFileRefTable).values(refRows).onConflictDoNothing().run()
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
    // divergence from `list`/`get` (which read `painting_file_ref`) is intentional and
    // disappears once the renderer cuts over to `createInternalEntry`.
    return rowToPainting(row, dto.files)
  }

  update(id: string, dto: UpdatePaintingDto): Painting {
    const dbService = application.get('DbService')
    const db = dbService.getDb()
    // Trashed paintings are not updatable — restore first.
    const [existing] = db
      .select()
      .from(paintingTable)
      .where(and(eq(paintingTable.id, id), isNull(paintingTable.deletedAt)))
      .limit(1)
      .all()
    if (!existing) {
      throw DataApiErrorFactory.notFound('Painting', id)
    }

    const existingFiles = dto.files && loadFilesForPaintings([existing.id]).get(existing.id)?.files
    const isIdempotentCompletedReplay =
      existing.stepStatus === 'completed' &&
      dto.stepStatus === 'completed' &&
      dto.files !== undefined &&
      existingFiles !== undefined &&
      JSON.stringify(existingFiles) === JSON.stringify(dto.files)

    if (
      existing.projectId &&
      existing.stepStatus !== 'running' &&
      (dto.prompt !== undefined ||
        dto.providerId !== undefined ||
        dto.modelId !== undefined ||
        (dto.files !== undefined && !isIdempotentCompletedReplay))
    ) {
      throw DataApiErrorFactory.invalidOperation('Completed steps are immutable; create a new step')
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
      const filesByPainting = loadFilesForPaintings([existing.id])
      const snapshot = filesByPainting.get(existing.id)
      return rowToPainting(existing, snapshot?.files ?? EMPTY_FILES, snapshot?.fingerprint)
    }

    const row = withSqliteErrors(
      () =>
        dbService.withWriteTx((tx) => {
          let target = existing
          if (Object.keys(updates).length > 0) {
            const [updated] = tx.update(paintingTable).set(updates).where(eq(paintingTable.id, id)).returning().all()
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
            // (fileEntryId, sourceId, role) constraint.
            tx.delete(paintingFileRefTable).where(eq(paintingFileRefTable.sourceId, id)).run()
            const refRows = buildPaintingRefRowsFiltered(tx, id, dto.files, Date.now())
            if (refRows.length > 0) {
              tx.insert(paintingFileRefTable).values(refRows).onConflictDoNothing().run()
            }
          }
          return target
        }),
      defaultHandlersFor('Painting', id)
    )

    logger.info('Updated painting', { id, changes: Object.keys(dto) })
    this.notifyReadModelChange([id, ...(row.projectId ? [row.projectId] : [])], 'projection')
    // On a files write, echo the requested `dto.files` for the same reason as
    // `create` (transition-era ids aren't in `file_entry` yet, so the persisted
    // refs would under-report). Otherwise hydrate from the stored refs.
    if (filesDirty) return rowToPainting(row, dto.files!)
    const snapshot = loadFilesForPaintings([row.id]).get(row.id)
    return rowToPainting(row, snapshot?.files ?? EMPTY_FILES, snapshot?.fingerprint)
  }

  selectStep(projectId: string, stepId: string, fileId?: string): Painting {
    return application.get('DbService').withWriteTx((tx) => {
      const project = this.getById(projectId)
      const step = this.getById(stepId)
      if (project.projectId || (step.projectId ?? step.id) !== projectId)
        throw DataApiErrorFactory.invalidOperation('Step belongs to a different project')
      if (fileId && !step.files.output.includes(fileId))
        throw DataApiErrorFactory.invalidOperation('Image is not an output of the selected step')
      tx.update(paintingTable)
        .set({
          selectedStepId: stepId,
          selectedFileId: fileId ?? step.files.output[0] ?? null
        })
        .where(eq(paintingTable.id, projectId))
        .run()
      return this.getById(projectId)
    })
  }

  /**
   * Delete a painting.
   *
   * Default (Delete): move the entire project and its version history to the Recycle Bin.
   * `painting_file_ref` rows are untouched (no row delete → no FK cascade), so
   * the file orphan sweep still sees the generated images as owned and the
   * disk files stay safe while the painting sits in the trash.
   *
   * `permanent: true`: hard-delete the DB row only while it remains in the Recycle Bin.
   * The FK cascade clears `painting_file_ref`; disk images are reclaimed later
   * by the file orphan sweep. DB-only — no filesystem work in DataApi.
   */
  delete(id: string, options: { permanent?: boolean } = {}): void {
    const db = application.get('DbService').getDb()
    const target = db
      .select({ projectId: paintingTable.projectId })
      .from(paintingTable)
      .where(eq(paintingTable.id, id))
      .get()
    if (!target) throw DataApiErrorFactory.notFound('Painting', id)
    if (target.projectId)
      throw DataApiErrorFactory.invalidOperation('Delete the whole project to preserve version history')

    if (options.permanent === true) {
      const result = withSqliteErrors(
        () =>
          db
            .delete(paintingTable)
            .where(and(eq(paintingTable.id, id), isNotNull(paintingTable.deletedAt)))
            .run(),
        defaultHandlersFor('Painting', id)
      )
      if (result.changes === 0) {
        throw DataApiErrorFactory.notFound('Painting', id)
      }
      this.notifyReadModelChange([id], 'membership')
      logger.info('Permanently deleted painting', { id })
      return
    }

    const result = db
      .update(paintingTable)
      .set({ deletedAt: Date.now() })
      .where(and(or(eq(paintingTable.id, id), eq(paintingTable.projectId, id)), isNull(paintingTable.deletedAt)))
      .run()
    if (result.changes === 0) {
      throw DataApiErrorFactory.notFound('Painting', id)
    }
    this.notifyReadModelChange([id], 'membership')
    logger.info('Moved painting to Recycle Bin', { id })
  }

  /**
   * Restore a trashed painting (clear `deletedAt`). Moving it to the Recycle Bin never touched
   * the `painting_file_ref` rows, so the returned entity's files are intact.
   * NOT_FOUND when the painting doesn't exist or is not in the trash.
   */
  restore(id: string): Painting {
    const db = application.get('DbService').getDb()
    const root = db
      .select()
      .from(paintingTable)
      .where(and(eq(paintingTable.id, id), isNull(paintingTable.projectId), isNotNull(paintingTable.deletedAt)))
      .get()
    if (!root) throw DataApiErrorFactory.notFound('Painting', id)
    const rows = db
      .update(paintingTable)
      .set({ deletedAt: null })
      .where(and(or(eq(paintingTable.id, id), eq(paintingTable.projectId, id)), isNotNull(paintingTable.deletedAt)))
      .returning()
      .all()
    const row = rows.find((item) => item.id === id)
    if (!row) throw DataApiErrorFactory.notFound('Painting', id)

    this.notifyReadModelChange([id], 'membership')
    logger.info('Restored painting', { id })
    const snapshot = loadFilesForPaintings([row.id]).get(row.id)
    return rowToPainting(row, snapshot?.files ?? EMPTY_FILES, snapshot?.fingerprint)
  }

  /**
   * Hard-delete trashed paintings whose `deletedAt` is older than `cutoffMs`,
   * up to `limit` rows. Called by the trash purge job inside its own
   * `withWriteTx` — the callback stays synchronous per better-sqlite3.
   *
   * Returns the purged painting ids. The FK cascade clears `painting_file_ref`;
   * disk images are reclaimed later by the file orphan sweep (no filesystem
   * work here).
   */
  purgeExpiredTx(tx: DbOrTx, cutoffMs: number, limit: number): string[] {
    const rows = tx
      .select({ id: paintingTable.id })
      .from(paintingTable)
      .where(
        and(isNull(paintingTable.projectId), isNotNull(paintingTable.deletedAt), lt(paintingTable.deletedAt, cutoffMs))
      )
      .limit(limit)
      .all()

    const ids = rows.map((row) => row.id)
    if (ids.length === 0) return ids

    tx.delete(paintingTable).where(inArray(paintingTable.id, ids)).run()
    logger.info('Purged expired paintings', { count: ids.length })
    return ids
  }

  reorder(id: string, anchor: OrderRequest): void {
    const dbService = application.get('DbService')

    dbService.withWriteTx((tx) => {
      const [target] = tx
        .select()
        .from(paintingTable)
        .where(and(eq(paintingTable.id, id), isNull(paintingTable.deletedAt)))
        .limit(1)
        .all()
      if (!target) {
        throw DataApiErrorFactory.notFound('Painting', id)
      }

      applyMoves(tx, paintingTable, [{ id, anchor }], {
        pkColumn: paintingTable.id
      })

      logger.info('Reordered paintings', {
        count: 1
      })
    })
  }

  reorderBatch(moves: Array<{ id: string; anchor: OrderRequest }>): void {
    if (moves.length === 0) return

    const dbService = application.get('DbService')

    dbService.withWriteTx((tx) => {
      for (const move of moves) {
        const [target] = tx
          .select()
          .from(paintingTable)
          .where(and(eq(paintingTable.id, move.id), isNull(paintingTable.deletedAt)))
          .limit(1)
          .all()
        if (!target) {
          throw DataApiErrorFactory.notFound('Painting', move.id)
        }
      }

      applyMoves(tx, paintingTable, moves, {
        pkColumn: paintingTable.id
      })

      logger.info('Reordered paintings', {
        count: moves.length
      })
    })
  }
}

/**
 * Build the `painting_file_ref` rows for a painting, **filtered against `file_entry`**
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
function buildPaintingRefRowsFiltered(
  tx: Pick<DbType, 'select'>,
  paintingId: string,
  files: PaintingFiles | undefined,
  now: number
): Array<typeof paintingFileRefTable.$inferInsert> {
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

  const rows: Array<typeof paintingFileRefTable.$inferInsert> = []
  let dropped = 0
  for (const fileId of files.output) {
    if (!existingIds.has(fileId)) {
      dropped += 1
      continue
    }
    rows.push({
      fileEntryId: fileId,
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
