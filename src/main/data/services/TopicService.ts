// Topic CRUD, branch switching, ordering.

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
    isNameManuallyEdited: row.isNameManuallyEdited,
    assistantId: row.assistantId,
    activeNodeId: row.activeNodeId,
    groupId: row.groupId,
    orderKey: row.orderKey,
    createdAt: timestampToISO(row.createdAt),
    updatedAt: timestampToISO(row.updatedAt)
  }
}

function topicScopePredicate(groupId: string | null): SQL {
  return groupId === null ? isNull(topicTable.groupId) : eq(topicTable.groupId, groupId)
}

// Wire format: `pin:<orderKey>` / `topic:<updatedAt>:<id>` / `topic:` (pin exhausted).
type Cursor =
  | { section: 'pin'; orderKey: string }
  | { section: 'topic'; updatedAt: number; id: string }
  | { section: 'topic'; updatedAt: null; id: null }

const FIRST_PAGE_CURSOR: Cursor = { section: 'pin', orderKey: '' }

// Stale/legacy cursors fall back to first page (warn) instead of throwing —
// cursors are opaque server-issued tokens, a 422 here would lock out renderers.
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

function buildSearchPredicate(q: string | undefined): SQL | undefined {
  const trimmed = q?.trim()
  if (!trimmed) return undefined
  const escaped = trimmed.replace(/[\\%_]/g, '\\$&')
  const pattern = `%${escaped}%`
  return sql`${topicTable.name} LIKE ${pattern} ESCAPE '\\'`
}

export class TopicService {
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

  async create(dto: CreateTopicDto): Promise<Topic> {
    const db = application.get('DbService').getDb()
    const groupId = dto.groupId ?? null

    const row = (await db.transaction(async (tx) => {
      // In-tx so a concurrent delete can't slip between check and insert;
      // inlined because messageService.getById has no tx-aware overload.
      if (dto.sourceNodeId) {
        const [src] = await tx
          .select({ id: messageTable.id })
          .from(messageTable)
          .where(and(eq(messageTable.id, dto.sourceNodeId), isNull(messageTable.deletedAt)))
          .limit(1)
        if (!src) throw DataApiErrorFactory.notFound('Message', dto.sourceNodeId)
      }

      return insertWithOrderKey(
        tx,
        topicTable,
        {
          name: dto.name,
          assistantId: dto.assistantId,
          groupId,
          activeNodeId: dto.sourceNodeId ?? null
        },
        {
          pkColumn: topicTable.id,
          scope: topicScopePredicate(groupId)
        }
      )
    })) as TopicRow

    if (dto.sourceNodeId) {
      logger.info('Created forked topic', { id: row.id, sourceNodeId: dto.sourceNodeId })
    } else {
      logger.info('Created empty topic', { id: row.id })
    }

    return rowToTopic(row)
  }

  /** Pin state and ordering go through `/pins` and `/topics/:id/order` — not this DTO. */
  async update(id: string, dto: UpdateTopicDto): Promise<Topic> {
    const db = application.get('DbService').getDb()

    const topic = await db.transaction(async (tx) => {
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
      if (!row) throw DataApiErrorFactory.notFound('Topic', id)

      return rowToTopic(row)
    })

    logger.info('Updated topic', { id, changes: Object.keys(dto) })

    return topic
  }

  /**
   * Hard delete + tag/pin purge. Any future soft-delete path MUST also
   * call `pinService.purgeForEntity(tx, 'topic', id)` — a surviving pin row
   * makes `listByCursor`'s JOIN silently hide the topic from both sections.
   *
   * TODO: Clean up associated files (images, attachments) from disk.
   */
  async delete(id: string): Promise<void> {
    const db = application.get('DbService').getDb()

    await this.getById(id)

    await db.transaction(async (tx) => {
      await tx.delete(messageTable).where(eq(messageTable.topicId, id))
      await tagService.purgeForEntity(tx, 'topic', id)
      await pinService.purgeForEntity(tx, 'topic', id)
      await tx.delete(topicTable).where(eq(topicTable.id, id))
    })

    logger.info('Deleted topic', { id })
  }

  async setActiveNode(topicId: string, nodeId: string): Promise<{ activeNodeId: string }> {
    const db = application.get('DbService').getDb()

    await db.transaction(async (tx) => {
      const [topic] = await tx
        .select({ id: topicTable.id })
        .from(topicTable)
        .where(and(eq(topicTable.id, topicId), isNull(topicTable.deletedAt)))
        .limit(1)
      if (!topic) throw DataApiErrorFactory.notFound('Topic', topicId)

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

  /**
   * Two-section page: pinned topics (via `pin` JOIN, ordered by pin.orderKey)
   * then unpinned (ordered by `updatedAt DESC, id ASC`). A partial pin page
   * spills into the unpinned section to fill `limit`. `topic.orderKey` is
   * maintained but unused at read time — it's there for a future drag-mode
   * toggle.
   */
  async listByCursor(query: ListTopicsQuery = {}): Promise<CursorPaginationResponse<Topic>> {
    const db = application.get('DbService').getDb()
    const limit = Math.min(query.limit ?? DEFAULT_LIMIT, MAX_LIMIT)
    const cursor: Cursor = query.cursor ? decodeCursor(query.cursor) : { section: 'pin', orderKey: '' }
    const search = buildSearchPredicate(query.q)

    const items: Array<{ topic: Topic; pinOrderKey?: string }> = []

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
        return {
          items: items.map((i) => i.topic),
          nextCursor: encodeTopicSectionStart()
        }
      }
    }

    // Tuple cursor `(updatedAt, id)` over `ORDER BY updatedAt DESC, id ASC`:
    // the id tiebreaker prevents dedup/skip across pages when two rows share
    // an updatedAt.
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

  /** Cross-scope (mixed `groupId`) batches are rejected with VALIDATION_ERROR. */
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
}

export const topicService = new TopicService()
