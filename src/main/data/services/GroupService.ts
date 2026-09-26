/**
 * Group Service - handles group CRUD and scoped reorder operations
 *
 * Groups are user-managed flat containers keyed by `entityType`. Ordering within
 * an entityType bucket is preserved via a fractional-indexing `orderKey`.
 *
 * USAGE GUIDANCE:
 * - `listByEntityType` is the canonical read path; `entityType` is always required.
 * - `findByIdTx` is the cross-service lookup for relation validation inside a
 *   caller-owned write transaction; the caller owns its expected entityType.
 * - `findOrCreateByNameTx` supports legacy imports that must resolve a named
 *   group and create their entity in one caller-owned transaction.
 * - `create` auto-assigns `orderKey` via `insertWithOrderKey` (scope=entityType)
 *   so consumers never touch the column directly.
 * - `reorder` / `reorderBatch` delegate to `applyScopedMoves`, which performs
 *   scope inference and enforces "batch stays within one entityType".
 */

import { and, asc, eq } from 'drizzle-orm'

import { application } from '@application'
import { notifyDataApiDataChange } from '@data/dataApiDataChange'
import { agentTable } from '@data/db/schemas/agent'
import { assistantTable } from '@data/db/schemas/assistant'
import { groupTable } from '@data/db/schemas/group'
import { knowledgeBaseTable } from '@data/db/schemas/knowledge'
import { defaultHandlersFor, withSqliteErrors } from '@data/db/sqliteErrors'
import type { DbOrTx, DbType } from '@data/db/types'
import { loggerService } from '@logger'
import { DataApiErrorFactory } from '@shared/data/api/errors'
import type { OrderRequest } from '@shared/data/api/schemas/_endpointHelpers'
import type { CreateGroupDto, UpdateGroupDto } from '@shared/data/api/schemas/groups'
import type { CollectionGetPaths, DataApiDataChangeEffect } from '@shared/data/api/types'
import type { EntityType } from '@shared/data/types/entityType'
import type { Group } from '@shared/data/types/group'

import { applyScopedMoves, insertWithOrderKey } from './utils/orderKey'
import { timestampToISO } from './utils/rowMappers'

const logger = loggerService.withContext('DataApi:GroupService')

type GroupRow = typeof groupTable.$inferSelect

/**
 * Where each entityType's group membership lives: the table carrying the
 * `group_id` FK (ON DELETE SET NULL) and the list endpoint whose group buckets
 * the members move between. Entity types without a member column resolve to
 * undefined — deleting their groups unbinds nothing.
 */
const GROUP_MEMBER_SOURCES: Partial<
  Record<EntityType, { endpoint: CollectionGetPaths; memberIds: (tx: DbOrTx, groupId: string) => string[] }>
> = {
  agent: {
    endpoint: '/agents',
    memberIds: (tx, groupId) =>
      tx
        .select({ id: agentTable.id })
        .from(agentTable)
        .where(eq(agentTable.groupId, groupId))
        .all()
        .map((row) => row.id)
  },
  assistant: {
    endpoint: '/assistants',
    memberIds: (tx, groupId) =>
      tx
        .select({ id: assistantTable.id })
        .from(assistantTable)
        .where(eq(assistantTable.groupId, groupId))
        .all()
        .map((row) => row.id)
  },
  knowledge: {
    endpoint: '/knowledge-bases',
    memberIds: (tx, groupId) =>
      tx
        .select({ id: knowledgeBaseTable.id })
        .from(knowledgeBaseTable)
        .where(eq(knowledgeBaseTable.groupId, groupId))
        .all()
        .map((row) => row.id)
  }
}

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
  listByEntityType(entityType: EntityType): Group[] {
    const rows = this.db
      .select()
      .from(groupTable)
      .where(eq(groupTable.entityType, entityType))
      .orderBy(asc(groupTable.orderKey))
      .all()
    return rows.map(rowToGroup)
  }

  /**
   * Get a group by ID.
   */
  getById(id: string): Group {
    const group = this.findByIdTx(this.db, id)

    if (!group) {
      throw DataApiErrorFactory.notFound('Group', id)
    }

    return group
  }

  /**
   * Nullable lookup for services composing Group validation inside their own
   * write transaction. The caller owns its domain-specific entityType and
   * validation error contract.
   */
  findByIdTx(tx: Pick<DbType, 'select'>, id: string): Group | null {
    const [row] = tx.select().from(groupTable).where(eq(groupTable.id, id)).limit(1).all()
    return row ? rowToGroup(row) : null
  }

  /**
   * Resolve an exact group name inside a caller-owned write transaction,
   * creating the group when no match exists.
   *
   * Names intentionally remain non-unique for normal group management. If
   * historical data already contains duplicates, imports consistently reuse
   * the first group in display order.
   */
  findOrCreateByNameTx(tx: DbOrTx, entityType: EntityType, name: string): Group {
    const [existing] = tx
      .select()
      .from(groupTable)
      .where(and(eq(groupTable.entityType, entityType), eq(groupTable.name, name)))
      .orderBy(asc(groupTable.orderKey), asc(groupTable.id))
      .limit(1)
      .all()

    if (existing) {
      return rowToGroup(existing)
    }

    const inserted = insertWithOrderKey(
      tx,
      groupTable,
      { entityType, name },
      {
        pkColumn: groupTable.id,
        scope: eq(groupTable.entityType, entityType)
      }
    )

    return rowToGroup(inserted as GroupRow)
  }

  /**
   * Create a new group. The new row is appended to the end of its entityType
   * bucket with a fresh fractional-indexing orderKey.
   */
  create(dto: CreateGroupDto): Group {
    const row = withSqliteErrors(
      () =>
        this.db.transaction((tx) =>
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
    notifyDataApiDataChange([
      { endpoint: '/groups', kind: 'membership', entityIds: [mapped.id] },
      { endpoint: '/groups/:id', routeParams: { id: mapped.id }, entityIds: [mapped.id] }
    ])
    logger.info('Created group', { id: mapped.id, entityType: mapped.entityType })
    return mapped
  }

  /**
   * Update an existing group. `entityType` is immutable — only `name` can change.
   */
  update(id: string, dto: UpdateGroupDto): Group {
    const updates: Partial<typeof groupTable.$inferInsert> = {}
    if (dto.name !== undefined) updates.name = dto.name

    if (Object.keys(updates).length === 0) {
      return this.getById(id)
    }

    const [row] = withSqliteErrors(
      () => this.db.update(groupTable).set(updates).where(eq(groupTable.id, id)).returning().all(),
      defaultHandlersFor('Group', dto.name ?? id)
    )

    if (!row) {
      throw DataApiErrorFactory.notFound('Group', id)
    }

    notifyDataApiDataChange([
      { endpoint: '/groups', kind: 'projection', entityIds: [id] },
      { endpoint: '/groups/:id', routeParams: { id }, entityIds: [id] }
    ])
    logger.info('Updated group', { id, changes: Object.keys(dto) })
    return rowToGroup(row)
  }

  /**
   * Delete a group. Members unbind through their `group_id` FK (ON DELETE SET
   * NULL); their ids are read first so the unbind can be broadcast.
   */
  delete(id: string): void {
    let unbindEffect: DataApiDataChangeEffect | undefined
    this.db.transaction((tx) => {
      const [row] = tx.select({ entityType: groupTable.entityType }).from(groupTable).where(eq(groupTable.id, id)).all()
      const source = row ? GROUP_MEMBER_SOURCES[row.entityType as EntityType] : undefined
      const memberIds = source?.memberIds(tx, id) ?? []
      if (source && memberIds.length > 0) {
        unbindEffect = { endpoint: source.endpoint, kind: 'membership', entityIds: memberIds }
      }

      const deleted = tx.delete(groupTable).where(eq(groupTable.id, id)).returning({ id: groupTable.id }).all()

      if (deleted.length === 0) {
        throw DataApiErrorFactory.notFound('Group', id)
      }
    })

    notifyDataApiDataChange([
      { endpoint: '/groups', kind: 'membership', entityIds: [id] },
      { endpoint: '/groups/:id', routeParams: { id }, entityIds: [id] },
      ...(unbindEffect ? [unbindEffect] : [])
    ])

    logger.info('Deleted group', { id })
  }

  /**
   * Move a single group relative to an anchor. Scope (entityType) is inferred
   * from the target row — callers do not pass scope.
   */
  reorder(id: string, anchor: OrderRequest): void {
    this.db.transaction((tx) =>
      applyScopedMoves(tx, groupTable, [{ id, anchor }], {
        pkColumn: groupTable.id,
        scopeColumn: groupTable.entityType
      })
    )

    notifyDataApiDataChange([{ endpoint: '/groups', kind: 'order', dimension: 'orderKey', entityIds: [id] }])
  }

  /**
   * Apply a batch of moves atomically. `applyScopedMoves` rejects batches that
   * span multiple entityTypes with a VALIDATION_ERROR.
   */
  reorderBatch(moves: Array<{ id: string; anchor: OrderRequest }>): void {
    if (moves.length === 0) return
    this.db.transaction((tx) =>
      applyScopedMoves(tx, groupTable, moves, {
        pkColumn: groupTable.id,
        scopeColumn: groupTable.entityType
      })
    )

    notifyDataApiDataChange([
      { endpoint: '/groups', kind: 'order', dimension: 'orderKey', entityIds: moves.map((move) => move.id) }
    ])
  }
}

export const groupService = new GroupService()
