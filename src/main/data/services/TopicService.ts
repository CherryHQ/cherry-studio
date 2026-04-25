/**
 * Topic Service - handles topic CRUD, branch switching, and ordering.
 *
 * Order is partitioned by `groupId` via a fractional-indexing `orderKey`
 * (see `data-ordering-guide.md`). Pin state is NOT a topic column — it lives
 * in the polymorphic `pin` table (`entityType = 'topic'`), so list views
 * compose two segments: pinned topics (joined via `pin`, ordered by
 * `pin.orderKey`) followed by unpinned topics (ordered by `topic.orderKey`).
 *
 * `applyScopedMoves` does not support nullable scope columns
 * (`eq(scopeColumn, NULL)` never matches in SQL). Topic.groupId is nullable —
 * NULL is a real "ungrouped" partition, distinct from any non-null group —
 * so reorder paths build the scope predicate inline (`isNull` vs `eq`)
 * instead of going through the convenience wrapper.
 */

import { application } from '@application'
import { messageTable } from '@data/db/schemas/message'
import { pinTable } from '@data/db/schemas/pin'
import { topicTable } from '@data/db/schemas/topic'
import { loggerService } from '@logger'
import { DataApiErrorFactory } from '@shared/data/api'
import type { CursorPaginationResponse } from '@shared/data/api/apiTypes'
import type { OrderRequest } from '@shared/data/api/schemas/_endpointHelpers'
import type { CreateTopicDto, ListTopicsQuery, UpdateTopicDto } from '@shared/data/api/schemas/topics'
import type { Topic } from '@shared/data/types/topic'
import type { SQL } from 'drizzle-orm'
import { and, asc, eq, gt, inArray, isNull, like, notInArray, sql } from 'drizzle-orm'

import { messageService } from './MessageService'
import { pinService } from './PinService'
import { tagService } from './TagService'
import { applyMoves, insertWithOrderKey } from './utils/orderKey'
import { timestampToISO } from './utils/rowMappers'

const logger = loggerService.withContext('DataApi:TopicService')

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200

type TopicRow = typeof topicTable.$inferSelect

function rowToTopic(row: TopicRow): Topic {
  return {
    id: row.id,
    name: row.name,
    isNameManuallyEdited: row.isNameManuallyEdited ?? false,
    assistantId: row.assistantId,
    activeNodeId: row.activeNodeId,
    groupId: row.groupId,
    orderKey: row.orderKey,
    createdAt: timestampToISO(row.createdAt),
    updatedAt: timestampToISO(row.updatedAt)
  }
}

/** Build the scope predicate for a topic's groupId (nullable-aware). */
function topicScopePredicate(groupId: string | null): SQL {
  return groupId === null ? isNull(topicTable.groupId) : eq(topicTable.groupId, groupId)
}

/**
 * Cursor format:
 *   `pin:<orderKey>`    — boundary at this pin.orderKey, still in pin section
 *   `topic:<orderKey>`  — boundary at this topic.orderKey, in unpinned section
 *   `topic:`            — pin section exhausted, unpinned section starts
 */
type Cursor = { section: 'pin' | 'topic'; orderKey: string }

function decodeCursor(raw: string): Cursor {
  const colonIdx = raw.indexOf(':')
  if (colonIdx < 0) throw DataApiErrorFactory.validation({ cursor: ['malformed cursor'] })
  const section = raw.slice(0, colonIdx)
  if (section !== 'pin' && section !== 'topic') {
    throw DataApiErrorFactory.validation({ cursor: ['unknown cursor section'] })
  }
  return { section, orderKey: raw.slice(colonIdx + 1) }
}

function encodeCursor(c: Cursor): string {
  return `${c.section}:${c.orderKey}`
}

export class TopicService {
  /**
   * Get a topic by ID
   */
  async getById(id: string): Promise<Topic> {
    const db = application.get('DbService').getDb()

    const [row] = await db
      .select()
      .from(topicTable)
      .where(and(eq(topicTable.id, id), isNull(topicTable.deletedAt)))
      .limit(1)

    if (!row) {
      throw DataApiErrorFactory.notFound('Topic', id)
    }

    return rowToTopic(row)
  }

  /**
   * Cursor-paginated topic list with optional name search.
   *
   * The view is composed: pinned topics first (joined through `pin` on
   * `entityType='topic'`, ordered by `pin.orderKey`), then unpinned topics
   * (ordered by `topic.orderKey`). The cursor encodes which section the
   * caller is in so subsequent pages continue from the right boundary, and
   * a partial pin page that fits into the limit transparently spills into
   * the unpinned section to fill the remainder.
   */
  async listByCursor(query: ListTopicsQuery = {}): Promise<CursorPaginationResponse<Topic>> {
    const db = application.get('DbService').getDb()
    const limit = Math.min(query.limit ?? DEFAULT_LIMIT, MAX_LIMIT)
    const cursor: Cursor = query.cursor ? decodeCursor(query.cursor) : { section: 'pin', orderKey: '' }
    const search = query.q?.trim() ? like(topicTable.name, `%${query.q.trim()}%`) : undefined

    const items: Array<{ topic: Topic; pinOrderKey?: string }> = []

    // ── Section 1: pinned topics ─────────────────────────────────────────
    if (cursor.section === 'pin') {
      const pinAfter = cursor.orderKey ? gt(pinTable.orderKey, cursor.orderKey) : undefined
      const pinRows = await db
        .select({ topic: topicTable, pinOrderKey: pinTable.orderKey })
        .from(topicTable)
        .innerJoin(pinTable, and(eq(pinTable.entityType, 'topic'), eq(pinTable.entityId, topicTable.id)))
        .where(and(isNull(topicTable.deletedAt), pinAfter, search))
        .orderBy(asc(pinTable.orderKey), asc(topicTable.id))
        .limit(limit + 1)

      const hasMoreInPin = pinRows.length > limit
      for (const row of pinRows.slice(0, limit)) {
        items.push({ topic: rowToTopic(row.topic), pinOrderKey: row.pinOrderKey })
      }

      if (hasMoreInPin) {
        const last = items[items.length - 1]
        return {
          items: items.map((i) => i.topic),
          nextCursor: encodeCursor({ section: 'pin', orderKey: last.pinOrderKey ?? '' })
        }
      }

      if (items.length >= limit) {
        // Pin section exactly filled the page; next page starts the unpinned section.
        return {
          items: items.map((i) => i.topic),
          nextCursor: encodeCursor({ section: 'topic', orderKey: '' })
        }
      }
      // Pin section exhausted with room to spare — fall through.
    }

    // ── Section 2: unpinned topics ───────────────────────────────────────
    const remaining = limit - items.length
    const pinnedSubquery = db.select({ id: pinTable.entityId }).from(pinTable).where(eq(pinTable.entityType, 'topic'))
    const topicAfter =
      cursor.section === 'topic' && cursor.orderKey ? gt(topicTable.orderKey, cursor.orderKey) : undefined

    const topicRows = await db
      .select()
      .from(topicTable)
      .where(and(isNull(topicTable.deletedAt), notInArray(topicTable.id, pinnedSubquery), topicAfter, search))
      .orderBy(asc(topicTable.orderKey), asc(topicTable.id))
      .limit(remaining + 1)

    const hasMoreInTopic = topicRows.length > remaining
    for (const row of topicRows.slice(0, remaining)) {
      items.push({ topic: rowToTopic(row) })
    }

    const nextCursor = hasMoreInTopic
      ? encodeCursor({ section: 'topic', orderKey: items[items.length - 1].topic.orderKey })
      : undefined

    return { items: items.map((i) => i.topic), nextCursor }
  }

  /**
   * Create a new topic.
   *
   * When `sourceNodeId` is set, the new topic **shares** the ancestor chain
   * leading to that message — no message copies are made. The new topic
   * simply records `activeNodeId = sourceNodeId`, and `getBranchMessages`
   * walks `parent_id` across topics to reconstruct the shared history. The
   * caller's first new message in the forked topic will attach to the shared
   * node, diverging the tree from that point on.
   */
  async create(dto: CreateTopicDto): Promise<Topic> {
    const db = application.get('DbService').getDb()

    let activeNodeId: string | null = null
    if (dto.sourceNodeId) {
      // Verify source exists (surface NOT_FOUND cleanly instead of FK violation)
      await messageService.getById(dto.sourceNodeId)
      activeNodeId = dto.sourceNodeId
    }

    const groupId = dto.groupId ?? null
    const row = (await db.transaction(async (tx) =>
      insertWithOrderKey(
        tx,
        topicTable,
        {
          name: dto.name,
          assistantId: dto.assistantId,
          groupId,
          activeNodeId
        },
        {
          pkColumn: topicTable.id,
          scope: topicScopePredicate(groupId)
        }
      )
    )) as TopicRow

    if (dto.sourceNodeId) {
      logger.info('Created forked topic', { id: row.id, sourceNodeId: dto.sourceNodeId })
    } else {
      logger.info('Created empty topic', { id: row.id })
    }

    return rowToTopic(row)
  }

  /**
   * Update a topic.
   *
   * Pin state and ordering are NOT mutable through this DTO — pin/unpin goes
   * through `POST /pins` / `DELETE /pins/:id`, and reorder goes through
   * `PATCH /topics/:id/order`.
   */
  async update(id: string, dto: UpdateTopicDto): Promise<Topic> {
    const db = application.get('DbService').getDb()

    // Verify topic exists
    await this.getById(id)

    const updates: Partial<typeof topicTable.$inferInsert> = {}
    if (dto.name !== undefined) updates.name = dto.name
    if (dto.isNameManuallyEdited !== undefined) updates.isNameManuallyEdited = dto.isNameManuallyEdited
    if (dto.assistantId !== undefined) updates.assistantId = dto.assistantId
    if (dto.groupId !== undefined) updates.groupId = dto.groupId

    const [row] = await db.update(topicTable).set(updates).where(eq(topicTable.id, id)).returning()

    logger.info('Updated topic', { id, changes: Object.keys(dto) })

    return rowToTopic(row)
  }

  /**
   * Delete a topic and all its messages (hard delete).
   *
   * Purges the polymorphic pin row alongside the topic so unpinning and
   * deletion stay consistent — see `pinTable` JSDoc for the consumer-side
   * `purgeForEntity` contract.
   *
   * TODO: Clean up associated files (images, attachments) from disk.
   */
  async delete(id: string): Promise<void> {
    const db = application.get('DbService').getDb()

    // Verify topic exists
    await this.getById(id)

    await db.transaction(async (tx) => {
      // Hard delete all messages first (due to foreign key)
      await tx.delete(messageTable).where(eq(messageTable.topicId, id))
      await tagService.purgeForEntity(tx, 'topic', id)
      await pinService.purgeForEntity(tx, 'topic', id)

      // Hard delete topic
      await tx.delete(topicTable).where(eq(topicTable.id, id))
    })

    logger.info('Deleted topic', { id })
  }

  /**
   * Move a single topic relative to an anchor. Scope (groupId) is inferred
   * from the target row.
   */
  async reorder(id: string, anchor: OrderRequest): Promise<void> {
    const db = application.get('DbService').getDb()
    await db.transaction(async (tx) => {
      const [target] = await tx
        .select({ groupId: topicTable.groupId })
        .from(topicTable)
        .where(eq(topicTable.id, id))
        .limit(1)
      if (!target) throw DataApiErrorFactory.notFound('Topic', id)

      await applyMoves(tx, topicTable, [{ id, anchor }], {
        pkColumn: topicTable.id,
        scope: topicScopePredicate(target.groupId)
      })
    })
  }

  /**
   * Apply a batch of reorder moves atomically. Cross-scope batches (mixing
   * topics from different groupId partitions) are rejected with
   * VALIDATION_ERROR — reorder is a same-scope operation. `groupId = NULL`
   * is its own scope (the "ungrouped" partition).
   */
  async reorderBatch(moves: Array<{ id: string; anchor: OrderRequest }>): Promise<void> {
    if (moves.length === 0) return

    const db = application.get('DbService').getDb()
    await db.transaction(async (tx) => {
      const ids = moves.map((m) => m.id)
      const targets = await tx
        .select({ id: topicTable.id, groupId: topicTable.groupId })
        .from(topicTable)
        .where(inArray(topicTable.id, ids))

      if (targets.length !== ids.length) {
        const found = new Set(targets.map((t) => t.id))
        const missing = ids.find((id) => !found.has(id)) ?? ids[0]
        throw DataApiErrorFactory.notFound('Topic', missing)
      }

      const scopeValues = new Set(targets.map((t) => t.groupId))
      if (scopeValues.size > 1) {
        const scopeList = [...scopeValues].map((s) => (s === null ? '<null>' : s)).join(', ')
        const message = `reorderBatch: batch spans multiple groupId scopes (${scopeList})`
        throw DataApiErrorFactory.validation({ _root: [message] }, message)
      }

      const [scopeValue] = [...scopeValues]
      await applyMoves(tx, topicTable, moves, {
        pkColumn: topicTable.id,
        scope: topicScopePredicate(scopeValue ?? null)
      })
    })
  }

  /**
   * Set the active node for a topic.
   *
   * Two modes:
   *   - `descend: true` (navigator semantics) — walk down from `nodeId` to
   *     any leaf and pin that as active.
   *   - `descend: false` (default, branch semantics) — pin `nodeId` itself
   *     as active. The conversation view truncates at that node.
   */
  async setActiveNode(
    topicId: string,
    nodeId: string,
    options: { descend?: boolean } = {}
  ): Promise<{ activeNodeId: string }> {
    const db = application.get('DbService').getDb()
    const { descend = false } = options

    // Verify topic exists
    await this.getById(topicId)

    // Verify node exists within this topic.
    const [message] = await db.select().from(messageTable).where(eq(messageTable.id, nodeId)).limit(1)

    if (!message || message.topicId !== topicId) {
      throw DataApiErrorFactory.notFound('Message', nodeId)
    }

    let targetId = nodeId
    if (descend) {
      const [leaf] = await db.all<{ id: string }>(sql`
        WITH RECURSIVE subtree AS (
          SELECT id FROM message WHERE id = ${nodeId} AND deleted_at IS NULL
          UNION ALL
          SELECT m.id FROM message m
          INNER JOIN subtree s ON m.parent_id = s.id
          WHERE m.deleted_at IS NULL
        )
        SELECT s.id FROM subtree s
        WHERE NOT EXISTS (
          SELECT 1 FROM message c
          WHERE c.parent_id = s.id AND c.deleted_at IS NULL
        )
        LIMIT 1
      `)
      targetId = leaf?.id ?? nodeId
    }

    await db.update(topicTable).set({ activeNodeId: targetId }).where(eq(topicTable.id, topicId))

    logger.info('Set active node', { topicId, requestedNodeId: nodeId, activeNodeId: targetId, descend })

    return { activeNodeId: targetId }
  }
}

export const topicService = new TopicService()
