/**
 * Pin Service - handles polymorphic pin CRUD and scoped reorder operations
 *
 * Pins are a non-destructive "promote to top" marker for any entity type
 * listed in the shared `EntityType` enum. Ordering within an entityType bucket
 * is preserved via a fractional-indexing `orderKey`.
 *
 * USAGE GUIDANCE:
 * - `listByEntityType` is the canonical read path; `entityType` is always required.
 * - `pin` is idempotent AND concurrent-safe: repeat calls for the same
 *   (entityType, entityId) resolve to the same row, even under parallel writes.
 * - `unpin` is a hard delete. There is no soft-delete / audit column.
 * - `reorder` / `reorderBatch` delegate to `applyScopedMoves`, which performs
 *   scope inference and enforces "batch stays within one entityType".
 * - `purgeForEntityTx` MUST be called from consumer services' delete paths
 *   (mirrors `tagService.purgeForEntityTx`). The `pin` table has no FK to
 *   consumer tables by design; application-level purge is the contract.
 * - For cascading deletes where a parent owns N entities of the same type,
 *   prefer `purgeForEntitiesTx` over a loop of `purgeForEntityTx`. The bulk
 *   variant emits a single aggregated log line and a single SQL round trip.
 */

import { application } from '@application'
import { type PinSelect, pinTable } from '@data/db/schemas/pin'
import { classifySqliteError } from '@data/db/sqliteErrors'
import type { DbType } from '@data/db/types'
import { loggerService } from '@logger'
import { DataApiErrorFactory } from '@shared/data/api'
import type { OrderRequest } from '@shared/data/api/schemas/_endpointHelpers'
import type { CreatePinDto } from '@shared/data/api/schemas/pins'
import type { EntityType } from '@shared/data/types/entityType'
import type { Pin } from '@shared/data/types/pin'
import { and, asc, eq, inArray } from 'drizzle-orm'

import { applyScopedMoves, insertWithOrderKey } from './utils/orderKey'
import { timestampToISO } from './utils/rowMappers'

const logger = loggerService.withContext('DataApi:PinService')

function rowToPin(row: PinSelect): Pin {
  return {
    id: row.id,
    entityType: row.entityType as EntityType,
    entityId: row.entityId,
    orderKey: row.orderKey,
    createdAt: timestampToISO(row.createdAt),
    updatedAt: timestampToISO(row.updatedAt)
  }
}

export class PinService {
  private get db() {
    return application.get('DbService').getDb()
  }

  /**
   * List pins for a given entityType, ordered by orderKey ASC.
   */
  async listByEntityType(entityType: EntityType): Promise<Pin[]> {
    const rows = await this.db
      .select()
      .from(pinTable)
      .where(eq(pinTable.entityType, entityType))
      .orderBy(asc(pinTable.orderKey))
    return rows.map(rowToPin)
  }

  /**
   * Get a pin by ID.
   */
  async getById(id: string): Promise<Pin> {
    const [row] = await this.db.select().from(pinTable).where(eq(pinTable.id, id)).limit(1)

    if (!row) {
      throw DataApiErrorFactory.notFound('Pin', id)
    }

    return rowToPin(row)
  }

  /**
   * Idempotent, concurrent-safe pin. Two sequential calls with the same
   * (entityType, entityId) return the same row; two concurrent calls also
   * converge to one row without leaking a UNIQUE violation to the caller.
   *
   * Strategy: fast-path SELECT first; if nothing is there, INSERT with scoped
   * orderKey. Under concurrency the INSERT may race a peer's INSERT and hit
   * the UNIQUE(entityType, entityId) index — in that case classify the error
   * as `unique` and re-SELECT to return the winner's row. Any non-UNIQUE
   * error is re-thrown unchanged.
   *
   * See sqliteErrors.ts "Discipline: do not replace pre-validation" — the
   * fast-path SELECT IS the pre-validation here; the UNIQUE catch is purely
   * the TOCTOU concurrency fallback.
   */
  async pin(dto: CreatePinDto): Promise<Pin> {
    return this.db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(pinTable)
        .where(and(eq(pinTable.entityType, dto.entityType), eq(pinTable.entityId, dto.entityId)))
        .limit(1)
      if (existing) return rowToPin(existing)

      try {
        const inserted = await insertWithOrderKey(
          tx,
          pinTable,
          { entityType: dto.entityType, entityId: dto.entityId },
          {
            pkColumn: pinTable.id,
            scope: eq(pinTable.entityType, dto.entityType)
          }
        )
        const mapped = rowToPin(inserted as PinSelect)
        logger.info('Created pin', {
          id: mapped.id,
          entityType: mapped.entityType,
          entityId: mapped.entityId
        })
        return mapped
      } catch (e) {
        if (classifySqliteError(e)?.kind !== 'unique') throw e

        const [winner] = await tx
          .select()
          .from(pinTable)
          .where(and(eq(pinTable.entityType, dto.entityType), eq(pinTable.entityId, dto.entityId)))
          .limit(1)
        if (!winner) throw e
        return rowToPin(winner)
      }
    })
  }

  /**
   * Unpin by pin id. Hard delete.
   */
  async unpin(id: string): Promise<void> {
    const [row] = await this.db.delete(pinTable).where(eq(pinTable.id, id)).returning({ id: pinTable.id })

    if (!row) {
      throw DataApiErrorFactory.notFound('Pin', id)
    }

    logger.info('Deleted pin', { id })
  }

  /**
   * Move a single pin relative to an anchor. Scope (entityType) is inferred
   * from the target row — callers do not pass scope.
   */
  async reorder(id: string, anchor: OrderRequest): Promise<void> {
    await this.db.transaction(async (tx) =>
      applyScopedMoves(tx, pinTable, [{ id, anchor }], {
        pkColumn: pinTable.id,
        scopeColumn: pinTable.entityType
      })
    )
  }

  /**
   * Apply a batch of moves atomically. `applyScopedMoves` rejects batches that
   * span multiple entityTypes with a VALIDATION_ERROR.
   */
  async reorderBatch(moves: Array<{ id: string; anchor: OrderRequest }>): Promise<void> {
    await this.db.transaction(async (tx) =>
      applyScopedMoves(tx, pinTable, moves, {
        pkColumn: pinTable.id,
        scopeColumn: pinTable.entityType
      })
    )
  }

  /**
   * Remove all pin rows targeting a given (entityType, entityId).
   * Must be called by consumer services (TopicService, AssistantService, ...)
   * when deleting the underlying entity, since `pin` has no FK to entity
   * tables.
   *
   * Because pin is hard-deleted row-by-row (no bulk orderKey rewrite), the
   * remaining rows' orderKeys are not mutated — neighbors retain their
   * existing keys and relative ordering.
   *
   * Signature is tx-first (mainstream ORM convention) — mirrors
   * `tagService.purgeForEntityTx`.
   */
  async purgeForEntityTx(tx: Pick<DbType, 'delete'>, entityType: EntityType, entityId: string): Promise<void> {
    await tx.delete(pinTable).where(and(eq(pinTable.entityType, entityType), eq(pinTable.entityId, entityId)))

    logger.info('Purged pins for entity', { entityType, entityId })
  }

  /**
   * Bulk variant of `purgeForEntityTx` for callers that already hold a list of
   * entity ids (e.g. cascading deletes from a parent that owns many entities
   * of the same type). Empty input is a no-op. Emits a single aggregated log
   * line so a large cascade does not produce per-id log entries.
   */
  async purgeForEntitiesTx(tx: Pick<DbType, 'delete'>, entityType: EntityType, entityIds: string[]): Promise<void> {
    if (entityIds.length === 0) return
    await tx.delete(pinTable).where(and(eq(pinTable.entityType, entityType), inArray(pinTable.entityId, entityIds)))

    logger.info('Purged pins for entities', { entityType, count: entityIds.length })
  }
}

export const pinService = new PinService()
