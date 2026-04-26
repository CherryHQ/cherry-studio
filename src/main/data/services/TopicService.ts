/**
 * Topic Service - handles topic CRUD, branch switching, and ordering.
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
import { and, asc, desc, eq, gt, inArray, isNull, like, lt, notInArray, or, sql } from 'drizzle-orm'

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
 *   `pin:<pin.orderKey>`           — boundary inside the pin section
 *   `topic:<updatedAt>:<id>`       — boundary inside the unpinned section
 *                                    (sorted by updatedAt DESC, id ASC tie-break)
 *   `topic:`                       — pin section exhausted, start of unpinned
 */
type Cursor =
  | { section: 'pin'; orderKey: string }
  | { section: 'topic'; updatedAt: number; id: string }
  | { section: 'topic'; updatedAt: null; id: null }

function decodeCursor(raw: string): Cursor {
  const firstColon = raw.indexOf(':')
  if (firstColon < 0) throw DataApiErrorFactory.validation({ cursor: ['malformed cursor'] })
  const section = raw.slice(0, firstColon)
  const rest = raw.slice(firstColon + 1)

  if (section === 'pin') {
    return { section: 'pin', orderKey: rest }
  }
  if (section === 'topic') {
    if (rest === '') return { section: 'topic', updatedAt: null, id: null }
    const sep = rest.indexOf(':')
    if (sep < 0) throw DataApiErrorFactory.validation({ cursor: ['malformed topic cursor'] })
    const updatedAt = Number(rest.slice(0, sep))
    const id = rest.slice(sep + 1)
    if (!Number.isFinite(updatedAt) || !id) {
      throw DataApiErrorFactory.validation({ cursor: ['malformed topic cursor'] })
    }
    return { section: 'topic', updatedAt, id }
  }
  throw DataApiErrorFactory.validation({ cursor: ['unknown cursor section'] })
}

function encodePinCursor(orderKey: string): string {
  return `pin:${orderKey}`
}

function encodeTopicCursor(updatedAt: number, id: string): string {
  return `topic:${updatedAt}:${id}`
}

function encodeTopicSectionStart(): string {
  return 'topic:'
}

/**
 * Extract the anchor id from an `OrderRequest` shape (`before` / `after`),
 * or `null` for sentinel positions (`first` / `last`).
 */
function anchorIdOf(anchor: OrderRequest): string | null {
  if ('before' in anchor) return anchor.before
  if ('after' in anchor) return anchor.after
  return null
}

/**
 * Translate `applyMoves`/`computeNewOrderKey` plain-Error throws into
 * `DataApiError`s matching the ordering spec
 * (`docs/references/data/data-ordering-guide.md` §1):
 *   - missing anchor id     → `NOT_FOUND` on Topic
 *   - anchor equals self    → `VALIDATION_ERROR` with field `anchor`
 *
 * Unknown errors (including the missing-target throw, which is pre-checked
 * by callers) are rethrown as-is so failures aren't silently masked.
 */
function translateApplyMovesError(err: unknown, moveId: string, anchor: OrderRequest): unknown {
  if (!(err instanceof Error)) return err
  const msg = err.message

  if (msg.includes('computeNewOrderKey: anchor id')) {
    const anchorId = anchorIdOf(anchor)
    if (anchorId !== null) {
      return DataApiErrorFactory.notFound('Topic', anchorId)
    }
  }

  if (msg.includes(`cannot equal the move's own id`)) {
    const message = `anchor id cannot equal target id ("${moveId}")`
    return DataApiErrorFactory.validation({ anchor: ['anchor id cannot equal target id'] }, message)
  }

  return err
}

/**
 * Batch variant: `applyMoves` throws on the first failing move and quotes the
 * offending id in the message. We extract that quoted id directly rather than
 * trying to correlate it back to a specific entry in `moves` — the moves list
 * is still passed in to provide a defensive fallback id (first move) on the
 * unlikely path where the message format changes and the regex misses.
 */
function translateApplyMovesBatchError(err: unknown, moves: Array<{ id: string; anchor: OrderRequest }>): unknown {
  if (!(err instanceof Error)) return err
  const msg = err.message

  if (msg.includes('computeNewOrderKey: anchor id')) {
    const match = msg.match(/anchor id "([^"]+)"/)
    const quotedId = match?.[1]
    if (quotedId) {
      return DataApiErrorFactory.notFound('Topic', quotedId)
    }
  }

  if (msg.includes(`cannot equal the move's own id`)) {
    const match = msg.match(/\("([^"]+)"\)/)
    const quotedId = match?.[1] ?? moves[0]?.id ?? ''
    const message = `anchor id cannot equal target id ("${quotedId}")`
    return DataApiErrorFactory.validation({ anchor: ['anchor id cannot equal target id'] }, message)
  }

  return err
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
   * The view is composed:
   *  1. Pinned topics, joined through `pin` on `entityType='topic'`, ordered
   *     by `pin.orderKey` ASC. Pin order is user-controlled (drag-to-reorder).
   *  2. Unpinned topics, ordered by `topic.updatedAt DESC, topic.id ASC`.
   *     Recency-by-default matches the v1 list-time sort and what users
   *     intuitively expect ("new conversation goes to the top"). `topic.orderKey`
   *     is still maintained on the row for a future drag-mode toggle (see
   *     data-ordering-guide §"Why no dual-mode sort"), but the default list
   *     reads ignore it for unpinned rows.
   *
   * The cursor encodes which section the caller is in so subsequent pages
   * continue from the right boundary, and a partial pin page that fits into
   * the limit transparently spills into the unpinned section to fill the
   * remainder.
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
          nextCursor: encodePinCursor(last.pinOrderKey ?? '')
        }
      }

      if (items.length >= limit) {
        // Pin section exactly filled the page; next page starts the unpinned section.
        return {
          items: items.map((i) => i.topic),
          nextCursor: encodeTopicSectionStart()
        }
      }
      // Pin section exhausted with room to spare — fall through.
    }

    // ── Section 2: unpinned topics ───────────────────────────────────────
    // Tuple cursor `(updatedAt, id)` over `ORDER BY updatedAt DESC, id ASC`:
    // the next page contains rows with smaller `updatedAt`, OR rows tied on
    // `updatedAt` with a strictly larger `id`. Without the id tiebreaker
    // pages would dedup or skip rows whenever two topics share a timestamp.
    const remaining = limit - items.length
    const pinnedSubquery = db.select({ id: pinTable.entityId }).from(pinTable).where(eq(pinTable.entityType, 'topic'))

    let topicAfter: SQL | undefined
    if (cursor.section === 'topic' && cursor.updatedAt !== null) {
      topicAfter = or(
        lt(topicTable.updatedAt, cursor.updatedAt),
        and(eq(topicTable.updatedAt, cursor.updatedAt), gt(topicTable.id, cursor.id))
      )
    }

    const topicRows = await db
      .select()
      .from(topicTable)
      .where(and(isNull(topicTable.deletedAt), notInArray(topicTable.id, pinnedSubquery), topicAfter, search))
      .orderBy(desc(topicTable.updatedAt), asc(topicTable.id))
      .limit(remaining + 1)

    const hasMoreInTopic = topicRows.length > remaining
    for (const row of topicRows.slice(0, remaining)) {
      items.push({ topic: rowToTopic(row) })
    }

    let nextCursor: string | undefined
    if (hasMoreInTopic) {
      const last = topicRows[remaining - 1]
      nextCursor = encodeTopicCursor(last.updatedAt, last.id)
    }

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

    const topic = await db.transaction(async (tx) => {
      // Verify topic exists (inline check — getById has no tx-aware overload).
      const [existing] = await tx
        .select({ id: topicTable.id })
        .from(topicTable)
        .where(and(eq(topicTable.id, id), isNull(topicTable.deletedAt)))
        .limit(1)
      if (!existing) throw DataApiErrorFactory.notFound('Topic', id)

      const updates: Partial<typeof topicTable.$inferInsert> = {}
      if (dto.name !== undefined) updates.name = dto.name
      if (dto.isNameManuallyEdited !== undefined) updates.isNameManuallyEdited = dto.isNameManuallyEdited
      if (dto.assistantId !== undefined) updates.assistantId = dto.assistantId
      if (dto.groupId !== undefined) updates.groupId = dto.groupId

      const [row] = await tx.update(topicTable).set(updates).where(eq(topicTable.id, id)).returning()
      // Defensive: the transaction collapses the getById-then-write race, but
      // surface a clean NOT_FOUND if the row vanished anyway instead of letting
      // rowToTopic crash on undefined.
      if (!row) throw DataApiErrorFactory.notFound('Topic', id)

      return rowToTopic(row)
    })

    logger.info('Updated topic', { id, changes: Object.keys(dto) })

    return topic
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
        .where(and(eq(topicTable.id, id), isNull(topicTable.deletedAt)))
        .limit(1)
      if (!target) throw DataApiErrorFactory.notFound('Topic', id)

      // Pattern-match on applyMoves's plain Error messages — they're part of
      // its de-facto contract (see orderKey.ts JSDoc on applyMoves /
      // computeNewOrderKey). Translate the two anchor-related throws into the
      // spec-required NOT_FOUND / VALIDATION codes (data-ordering-guide §1).
      // The missing-target case is already pre-checked above, so it's not
      // re-handled here.
      try {
        await applyMoves(tx, topicTable, [{ id, anchor }], {
          pkColumn: topicTable.id,
          scope: topicScopePredicate(target.groupId)
        })
      } catch (err) {
        throw translateApplyMovesError(err, id, anchor)
      }
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
        .where(and(inArray(topicTable.id, ids), isNull(topicTable.deletedAt)))

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
      // Pattern-match on applyMoves's plain Error messages — they're part of
      // its de-facto contract (see orderKey.ts JSDoc on applyMoves /
      // computeNewOrderKey). Translate the two anchor-related throws into the
      // spec-required NOT_FOUND / VALIDATION codes (data-ordering-guide §1).
      // applyMoves stops on the first failing move, so we walk the input list
      // to find the offending move whose anchor id matches the error.
      try {
        await applyMoves(tx, topicTable, moves, {
          pkColumn: topicTable.id,
          scope: topicScopePredicate(scopeValue ?? null)
        })
      } catch (err) {
        throw translateApplyMovesBatchError(err, moves)
      }
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
