/**
 * Group Service - handles group CRUD and scoped reorder operations
 *
 * Groups are user-managed flat containers keyed by `entityType`. Ordering within
 * an entityType bucket is preserved via a fractional-indexing `orderKey`.
 *
 * USAGE GUIDANCE:
 * - `listByEntityType` is the canonical read path; `entityType` is always required.
 * - `create` auto-assigns `orderKey` via `insertWithOrderKey` (scope=entityType)
 *   so consumers never touch the column directly.
 * - `reorder` / `reorderBatch` delegate to `applyScopedMoves`, which performs
 *   scope inference and enforces "batch stays within one entityType".
 */

import { application } from '@application'
import { groupTable } from '@data/db/schemas/group'
import { defaultHandlersFor, withSqliteErrors } from '@data/db/sqliteErrors'
import { loggerService } from '@logger'
import { DataApiErrorFactory } from '@shared/data/api'
import type { OrderRequest } from '@shared/data/api/schemas/_endpointHelpers'
import type { CreateGroupDto, UpdateGroupDto } from '@shared/data/api/schemas/groups'
import type { EntityType } from '@shared/data/types/entityType'
import type { Group } from '@shared/data/types/group'
import { asc, eq } from 'drizzle-orm'

import { applyScopedMoves, insertWithOrderKey } from './utils/orderKey'
import { timestampToISO } from './utils/rowMappers'

const logger = loggerService.withContext('DataApi:GroupService')

type GroupRow = typeof groupTable.$inferSelect

function rowToGroup(row: GroupRow): Group {
  return {
    id: row.id,
    entityType: row.entityType as EntityType,
    name: row.name,
    orderKey: row.orderKey,
    createdAt: timestampToISO(row.createdAt),
    updatedAt: timestampToISO(row.updatedAt)
  }
}

export class GroupService {
  private get db() {
    return application.get('DbService').getDb()
  }

  /**
   * List groups for a given entityType, ordered by orderKey ASC.
   */
  async listByEntityType(entityType: EntityType): Promise<Group[]> {
    const rows = await this.db
      .select()
      .from(groupTable)
      .where(eq(groupTable.entityType, entityType))
      .orderBy(asc(groupTable.orderKey))
    return rows.map(rowToGroup)
  }

  /**
   * Get a group by ID.
   */
  async getById(id: string): Promise<Group> {
    const [row] = await this.db.select().from(groupTable).where(eq(groupTable.id, id)).limit(1)

    if (!row) {
      throw DataApiErrorFactory.notFound('Group', id)
    }

    return rowToGroup(row)
  }

  /**
   * Create a new group. The new row is appended to the end of its entityType
   * bucket with a fresh fractional-indexing orderKey.
   */
  async create(dto: CreateGroupDto): Promise<Group> {
    const row = await withSqliteErrors(
      () =>
        this.db.transaction(async (tx) =>
          insertWithOrderKey(
            tx,
            groupTable,
            { entityType: dto.entityType, name: dto.name },
            {
              pkColumn: groupTable.id,
              scope: eq(groupTable.entityType, dto.entityType)
            }
          )
        ),
      defaultHandlersFor('Group', dto.name)
    )

    const mapped = rowToGroup(row as GroupRow)
    logger.info('Created group', { id: mapped.id, entityType: mapped.entityType })
    return mapped
  }

  /**
   * Update an existing group. `entityType` is immutable — only `name` can change.
   */
  async update(id: string, dto: UpdateGroupDto): Promise<Group> {
    const updates: Partial<typeof groupTable.$inferInsert> = {}
    if (dto.name !== undefined) updates.name = dto.name

    if (Object.keys(updates).length === 0) {
      return this.getById(id)
    }

    const [row] = await withSqliteErrors(
      () => this.db.update(groupTable).set(updates).where(eq(groupTable.id, id)).returning(),
      defaultHandlersFor('Group', dto.name ?? id)
    )

    if (!row) {
      throw DataApiErrorFactory.notFound('Group', id)
    }

    logger.info('Updated group', { id, changes: Object.keys(dto) })
    return rowToGroup(row)
  }

  /**
   * Delete a group.
   */
  async delete(id: string): Promise<void> {
    const [row] = await this.db.delete(groupTable).where(eq(groupTable.id, id)).returning({ id: groupTable.id })

    if (!row) {
      throw DataApiErrorFactory.notFound('Group', id)
    }

    logger.info('Deleted group', { id })
  }

  /**
   * Move a single group relative to an anchor. Scope (entityType) is inferred
   * from the target row — callers do not pass scope.
   */
  async reorder(id: string, anchor: OrderRequest): Promise<void> {
    await this.db.transaction(async (tx) =>
      applyScopedMoves(tx, groupTable, [{ id, anchor }], {
        pkColumn: groupTable.id,
        scopeColumn: groupTable.entityType
      })
    )
  }

  /**
   * Apply a batch of moves atomically. `applyScopedMoves` rejects batches that
   * span multiple entityTypes with a VALIDATION_ERROR.
   */
  async reorderBatch(moves: Array<{ id: string; anchor: OrderRequest }>): Promise<void> {
    await this.db.transaction(async (tx) =>
      applyScopedMoves(tx, groupTable, moves, {
        pkColumn: groupTable.id,
        scopeColumn: groupTable.entityType
      })
    )
  }
}

export const groupService = new GroupService()
