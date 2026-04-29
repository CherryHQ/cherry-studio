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
import { and, asc, desc, eq, gt, inArray, isNull, lt, notInArray, or, sql } from 'drizzle-orm'

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

const FIRST_PAGE_CURSOR: Cursor = { section: 'pin', orderKey: '' }

/**
 * Cursors are server-issued opaque tokens. A renderer holding a stale cursor
 * (older app version, schema rotated) should not be locked out with a 422 —
 * fall back to the first page and warn so the renderer can transparently
 * recover. Throwing here surfaces as a permanent client-side error with no
 * recovery path.
 */
function decodeCursor(raw: string): Cursor {
  const firstColon = raw.indexOf(':')
  if (firstColon < 0) return warnAndFallback(raw, 'no section separator')
  const section = raw.slice(0, firstColon)
  const rest = raw.slice(firstColon + 1)

  if (section === 'pin') {
    return { section: 'pin', orderKey: rest }
  }
  if (section === 'topic') {
    if (rest === '') return { section: 'topic', updatedAt: null, id: null }
    const sep = rest.indexOf(':')
    if (sep < 0) return warnAndFallback(raw, 'malformed topic cursor (missing id separator)')
    const updatedAt = Number(rest.slice(0, sep))
    const id = rest.slice(sep + 1)
    if (!Number.isFinite(updatedAt) || !id) {
      return warnAndFallback(raw, 'malformed topic cursor (bad updatedAt or empty id)')
    }
    return { section: 'topic', updatedAt, id }
  }
  return warnAndFallback(raw, `unknown cursor section "${section}"`)
}

function warnAndFallback(raw: string, reason: string): Cursor {
  logger.warn('decodeCursor: cursor unparseable, falling back to first page', { cursor: raw, reason })
  return FIRST_PAGE_CURSOR
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
 * Build a SQL predicate for substring search over `topic.name`. Escapes the
 * SQL `LIKE` wildcards `%` and `_` (and the escape character `\` itself) so
 * that user input like `100%` or `a_b` is matched literally rather than
 * matching everything / matching `a-b` etc. Uses an explicit `ESCAPE '\'`
 * clause because drizzle-orm's `like()` builder does not expose ESCAPE.
 *
 * The `q` value is bound parameterically (no SQL injection); only the
 * wildcards are escaped to preserve LIKE semantics.
 */
function buildSearchPredicate(q: string | undefined): SQL | undefined {
  const trimmed = q?.trim()
  if (!trimmed) return undefined
  const escaped = trimmed.replace(/[\\%_]/g, '\\$&')
  const pattern = `%${escaped}%`
  return sql`${topicTable.name} LIKE ${pattern} ESCAPE '\\'`
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
    const search = buildSearchPredicate(query.q)

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
   * **Soft-delete invariant**: this service treats `deletedAt`-set rows as
   * not-existing for read paths (see `getById` / `listByCursor`'s `isNull`
   * filters). The current `delete()` is hard delete, so the column stays
   * NULL in practice. If a future caller introduces a soft-delete path for
   * topics, it MUST also call `pinService.purgeForEntity(tx, 'topic', id)`
   * in the same transaction — otherwise the pin row outlives the topic and
   * `listByCursor`'s pin section JOIN silently hides the row from BOTH the
   * pinned and unpinned sections, making the topic invisible with no log.
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
      await applyMoves(tx, topicTable, moves, {
        pkColumn: topicTable.id,
        scope: topicScopePredicate(scopeValue ?? null)
      })
    })
  }

  /**
   * Set the active node for a topic
   */
  async setActiveNode(topicId: string, nodeId: string): Promise<{ activeNodeId: string }> {
    const db = application.get('DbService').getDb()

    await db.transaction(async (tx) => {
      // Verify topic exists (in-tx, soft-delete excluded)
      const [topic] = await tx
        .select({ id: topicTable.id })
        .from(topicTable)
        .where(and(eq(topicTable.id, topicId), isNull(topicTable.deletedAt)))
        .limit(1)
      if (!topic) throw DataApiErrorFactory.notFound('Topic', topicId)

      // Verify node exists, belongs to this topic, and is not soft-deleted
      const [message] = await tx
        .select({ topicId: messageTable.topicId })
        .from(messageTable)
        .where(and(eq(messageTable.id, nodeId), isNull(messageTable.deletedAt)))
        .limit(1)
      if (!message || message.topicId !== topicId) {
        throw DataApiErrorFactory.notFound('Message', nodeId)
      }

      const updated = await tx
        .update(topicTable)
        .set({ activeNodeId: nodeId })
        .where(and(eq(topicTable.id, topicId), isNull(topicTable.deletedAt)))
        .returning({ id: topicTable.id })
      if (updated.length !== 1) throw DataApiErrorFactory.notFound('Topic', topicId)
    })

    logger.info('Set active node', { topicId, nodeId })

    return { activeNodeId: nodeId }
  }
}

export const topicService = new TopicService()
