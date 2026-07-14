// Topic CRUD, branch switching, ordering.

import { randomBytes } from 'node:crypto'

import { application } from '@application'
import { assistantTable } from '@data/db/schemas/assistant'
import { chatMessageFileRefTable } from '@data/db/schemas/fileRelations'
import { messageTable } from '@data/db/schemas/message'
import { pinTable } from '@data/db/schemas/pin'
import { topicTable } from '@data/db/schemas/topic'
import { defaultHandlersFor, type SqliteErrorHandlers, withSqliteErrors } from '@data/db/sqliteErrors'
import type { DbOrTx } from '@data/db/types'
import { loggerService } from '@logger'
import { DataApiErrorFactory } from '@shared/data/api/errors'
import type { OrderRequest } from '@shared/data/api/schemas/_endpointHelpers'
import type { EntitySearchItem } from '@shared/data/api/schemas/search'
import type {
  CreateTopicDto,
  DeleteTopicsResult,
  DuplicateTopicDto,
  ListTopicsQuery,
  MoveTopicDto,
  TopicListItem,
  TopicSearchScope,
  TopicSortBy,
  TopicStats,
  TopicStatsQuery,
  UpdateTopicDto
} from '@shared/data/api/schemas/topics'
import type { CursorPaginationResponse } from '@shared/data/api/types'
import type { Topic } from '@shared/data/types/topic'
import type { SQL } from 'drizzle-orm'
import { and, asc, count, desc, eq, gte, inArray, isNull, notInArray, or, sql } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'

import { getDataService, registerDataService } from './dataServiceRegistry'
import { pinService } from './PinService'
import { tagService } from './TagService'
import { asNumericKey, asStringKey, decodeListCursor, encodeCursor, keysetOrdering } from './utils/keysetCursor'
import { applyMoves, insertWithOrderKey } from './utils/orderKey'
import { nullsToUndefined, timestampToISO } from './utils/rowMappers'

const logger = loggerService.withContext('DataApi:TopicService')

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200
const SQLITE_INARRAY_CHUNK = 500
const SQLITE_INSERT_CHUNK = 100

type TopicRow = typeof topicTable.$inferSelect
type TopicEntitySearchItem = Extract<EntitySearchItem, { type: 'topic' }>

function rowToTopic(row: TopicRow): Topic {
  // DB NULL ↔ domain `undefined` boundary — all of Topic's nullable columns are
  // `.optional()` (no `T | null`), so the `{...nullsToUndefined(row)}` skeleton
  // from data-api-in-main.md applies cleanly.
  const clean = nullsToUndefined(row)
  return {
    ...clean,
    createdAt: timestampToISO(row.createdAt),
    updatedAt: timestampToISO(row.updatedAt)
  }
}

function toTopicListItem(topic: Topic, pinId: string | null): TopicListItem {
  return { ...topic, pinned: pinId !== null, pinId }
}

function copyChatMessageFileRefsBySourceIdMapTx(tx: DbOrTx, sourceIdMap: ReadonlyMap<string, string>): void {
  if (sourceIdMap.size === 0) return
  const sourceIds = [...sourceIdMap.keys()]
  const now = Date.now()

  for (let i = 0; i < sourceIds.length; i += SQLITE_INARRAY_CHUNK) {
    const chunk = sourceIds.slice(i, i + SQLITE_INARRAY_CHUNK)
    const sourceRefs = tx
      .select()
      .from(chatMessageFileRefTable)
      .where(inArray(chatMessageFileRefTable.sourceId, chunk))
      .all()
    const values = sourceRefs.flatMap((ref) => {
      const copiedSourceId = sourceIdMap.get(ref.sourceId)
      if (!copiedSourceId) return []
      return [
        {
          id: uuidv4(),
          fileEntryId: ref.fileEntryId,
          sourceId: copiedSourceId,
          role: ref.role,
          createdAt: now,
          updatedAt: now
        }
      ]
    })
    for (let j = 0; j < values.length; j += SQLITE_INSERT_CHUNK) {
      tx.insert(chatMessageFileRefTable)
        .values(values.slice(j, j + SQLITE_INSERT_CHUNK))
        .run()
    }
  }
}

function buildSearchPredicate(q: string | undefined): SQL | undefined {
  const trimmed = q?.trim()
  if (!trimmed) return undefined
  const escaped = trimmed.replace(/[\\%_]/g, '\\$&')
  const pattern = `%${escaped}%`
  return sql`${topicTable.name} LIKE ${pattern} ESCAPE '\\'`
}

/**
 * Scoped search predicate for the list/stats paths. `name` matches the topic
 * name only; `name-or-owner` ORs in the owning assistant's name — callers must
 * LEFT JOIN the assistant table on live assistants only.
 */
function buildScopedSearchPredicate(q: string | undefined, scope: TopicSearchScope): SQL | undefined {
  const trimmed = q?.trim()
  if (!trimmed) return undefined
  const pattern = `%${trimmed.replace(/[\\%_]/g, '\\$&')}%`
  const nameMatch = sql`${topicTable.name} LIKE ${pattern} ESCAPE '\\'`
  if (scope === 'name') return nameMatch
  const assistantNameMatch = sql`${assistantTable.name} LIKE ${pattern} ESCAPE '\\'`
  return or(nameMatch, assistantNameMatch)
}

function assertActiveAssistantTx(tx: Pick<DbOrTx, 'select'>, assistantId: string): void {
  const [assistant] = tx
    .select({ id: assistantTable.id })
    .from(assistantTable)
    .where(and(eq(assistantTable.id, assistantId), isNull(assistantTable.deletedAt)))
    .limit(1)
    .all()
  if (!assistant) throw DataApiErrorFactory.notFound('Assistant', assistantId)
}

/**
 * Shared record filters for flat list and stats paths.
 * Callers join live assistants before applying these filters, so `unlinked`
 * covers both NULL owners and topics whose assistant is soft-deleted. `pinned`
 * is NOT built here — it needs the pin subquery and only applies to lists.
 */
function buildRecordFilters(query: {
  q?: string
  searchScope?: TopicSearchScope
  assistantId?: string
  ids?: string[]
}): SQL[] {
  const filters: SQL[] = [isNull(topicTable.deletedAt)]
  const search = buildScopedSearchPredicate(query.q, query.searchScope ?? 'name')
  if (search) filters.push(search)
  if (query.assistantId === 'unlinked') {
    filters.push(isNull(assistantTable.id))
  } else if (query.assistantId !== undefined) {
    filters.push(eq(topicTable.assistantId, query.assistantId))
  }
  if (query.ids !== undefined) filters.push(inArray(topicTable.id, query.ids))
  return filters
}

export class TopicService {
  getById(id: string): Topic {
    const db = application.get('DbService').getDb()

    const [row] = db
      .select()
      .from(topicTable)
      .where(and(eq(topicTable.id, id), isNull(topicTable.deletedAt)))
      .limit(1)
      .all()

    if (!row) {
      throw DataApiErrorFactory.notFound('Topic', id)
    }

    return rowToTopic(row)
  }

  /**
   * The single most-recently-updated non-deleted topic across all assistants, or
   * `null` when the library is empty.
   *
   * First-entry restore resumes the last-touched conversation. It cannot read the
   * regular first page of `listByCursor` for this: that page is pinned-first then
   * unpinned-by-`orderKey` (manual/creation order), so the globally latest-updated
   * topic is not guaranteed to be on it. This `updatedAt DESC LIMIT 1` proves global
   * latest independent of how the rail happens to page.
   */
  getLatestUpdated(): Topic | null {
    const db = application.get('DbService').getDb()

    const [row] = db
      .select()
      .from(topicTable)
      .where(isNull(topicTable.deletedAt))
      .orderBy(desc(topicTable.updatedAt), asc(topicTable.id))
      .limit(1)
      .all()

    return row ? rowToTopic(row) : null
  }

  ensureTraceId(topicId: string): string {
    return application.get('DbService').withWriteTx((tx) => {
      const [row] = tx
        .select({ traceId: topicTable.traceId })
        .from(topicTable)
        .where(and(eq(topicTable.id, topicId), isNull(topicTable.deletedAt)))
        .limit(1)
        .all()

      if (!row) {
        throw DataApiErrorFactory.notFound('Topic', topicId)
      }
      if (row.traceId) {
        return row.traceId
      }

      const traceId = randomBytes(16).toString('hex')
      tx.update(topicTable).set({ traceId }).where(eq(topicTable.id, topicId)).run()
      return traceId
    })
  }

  create(dto: CreateTopicDto): Topic {
    const dbService = application.get('DbService')
    const messageService = getDataService('MessageService')

    const row = dbService.withWriteTx((tx) => {
      const topicRow = insertWithOrderKey(
        tx,
        topicTable,
        {
          name: dto.name,
          assistantId: dto.assistantId,
          activeNodeId: null
        },
        {
          pkColumn: topicTable.id,
          position: 'first',
          scope: isNull(topicTable.deletedAt)
        }
      ) as TopicRow
      messageService.createRootMessageTx(tx, topicRow.id)
      return topicRow
    })

    logger.info('Created empty topic', { id: row.id })

    return rowToTopic(row)
  }

  duplicate(sourceTopicId: string, dto: DuplicateTopicDto): Topic {
    const dbService = application.get('DbService')
    const messageService = getDataService('MessageService')

    const copiedTopic = dbService.withWriteTx((tx) => {
      const [sourceTopic] = tx
        .select()
        .from(topicTable)
        .where(and(eq(topicTable.id, sourceTopicId), isNull(topicTable.deletedAt)))
        .limit(1)
        .all()
      if (!sourceTopic) throw DataApiErrorFactory.notFound('Topic', sourceTopicId)

      const sourcePathRows = messageService.getPathRowsToNodeTx(tx, dto.nodeId, { topicId: sourceTopicId })

      const newTopicRow = insertWithOrderKey(
        tx,
        topicTable,
        {
          name: dto.name ?? sourceTopic.name,
          isNameManuallyEdited: dto.name !== undefined ? true : sourceTopic.isNameManuallyEdited,
          assistantId: sourceTopic.assistantId,
          activeNodeId: null
        },
        {
          pkColumn: topicTable.id,
          // Keep duplicated conversations aligned with newly created agent sessions: newest active work appears first.
          position: 'first',
          scope: isNull(topicTable.deletedAt)
        }
      ) as TopicRow

      // New topic is a creation path → create its virtual root before copying the path
      // (copyPathRowsTx reparents the copied head onto it).
      messageService.createRootMessageTx(tx, newTopicRow.id)

      const { copiedMessageIds, copiedActiveNodeId } = messageService.copyPathRowsTx(tx, sourcePathRows, {
        topicId: newTopicRow.id
      })

      // Intentionally copies only topic metadata, root-to-node messages, and chat-message file refs.
      // Pins, tags, trace links, and pruned siblings/descendants stay with their original rows.
      copyChatMessageFileRefsBySourceIdMapTx(tx, copiedMessageIds)

      const [updatedTopicRow] = tx
        .update(topicTable)
        .set({ activeNodeId: copiedActiveNodeId })
        .where(eq(topicTable.id, newTopicRow.id))
        .returning()
        .all()

      return rowToTopic(updatedTopicRow)
    })

    logger.info('Duplicated topic path into new topic', {
      sourceTopicId,
      nodeId: dto.nodeId,
      newTopicId: copiedTopic.id,
      activeNodeId: copiedTopic.activeNodeId
    })

    return copiedTopic
  }

  /** Pin state and ordering go through `/pins` and `/topics/:id/order` — not this DTO. */
  update(id: string, dto: UpdateTopicDto): Topic {
    const dbService = application.get('DbService')

    const topic = dbService.withWriteTx((tx) => {
      const [existing] = tx
        .select({ id: topicTable.id })
        .from(topicTable)
        .where(and(eq(topicTable.id, id), isNull(topicTable.deletedAt)))
        .limit(1)
        .all()
      if (!existing) throw DataApiErrorFactory.notFound('Topic', id)

      const updates: Partial<typeof topicTable.$inferInsert> = {}
      if (dto.name !== undefined) {
        updates.name = dto.name
        // Name-only patches are user/manual renames. Auto-namers must opt out explicitly.
        updates.isNameManuallyEdited = dto.isNameManuallyEdited ?? true
      } else if (dto.isNameManuallyEdited !== undefined) {
        // Keep flag-only patches for repair/migration paths that need to adjust metadata.
        updates.isNameManuallyEdited = dto.isNameManuallyEdited
      }
      if (dto.assistantId !== undefined) {
        if (dto.assistantId !== null) {
          assertActiveAssistantTx(tx, dto.assistantId)
        }
        updates.assistantId = dto.assistantId
      }

      const [row] = tx.update(topicTable).set(updates).where(eq(topicTable.id, id)).returning().all()
      if (!row) throw DataApiErrorFactory.notFound('Topic', id)

      return rowToTopic(row)
    })

    logger.info('Updated topic', { id, changes: Object.keys(dto) })

    return topic
  }

  move(id: string, dto: MoveTopicDto): void {
    return withSqliteErrors(
      () =>
        application.get('DbService').withWriteTx((tx) => {
          const [target] = tx
            .select({ id: topicTable.id })
            .from(topicTable)
            .where(and(eq(topicTable.id, id), isNull(topicTable.deletedAt)))
            .limit(1)
            .all()
          if (!target) throw DataApiErrorFactory.notFound('Topic', id)

          if (dto.assistantId !== null) {
            const [assistant] = tx
              .select({ id: assistantTable.id })
              .from(assistantTable)
              .where(and(eq(assistantTable.id, dto.assistantId), isNull(assistantTable.deletedAt)))
              .limit(1)
              .all()
            if (!assistant) throw DataApiErrorFactory.notFound('Assistant', dto.assistantId)
          }

          tx.update(topicTable).set({ assistantId: dto.assistantId }).where(eq(topicTable.id, id)).run()
          applyMoves(tx, topicTable, [{ id, anchor: dto.order }], {
            pkColumn: topicTable.id,
            scope: isNull(topicTable.deletedAt)
          })
        }),
      {
        ...defaultHandlersFor('Topic', id),
        foreignKey: () =>
          dto.assistantId === null
            ? DataApiErrorFactory.notFound('Topic', id)
            : DataApiErrorFactory.notFound('Assistant', dto.assistantId)
      } satisfies SqliteErrorHandlers
    )
  }

  /**
   * Hard delete + tag/pin purge. Any future soft-delete path MUST also
   * call `pinService.purgeForEntitiesTx(tx, 'topic', [id])` — a surviving pin row
   * makes `listByCursor`'s JOIN silently hide the topic from both sections.
   *
   * TODO: Clean up associated files (images, attachments) from disk.
   */
  delete(id: string): void {
    const dbService = application.get('DbService')
    dbService.withWriteTx((tx) => this.deleteManyByIdsTx(tx, [id], { requireAll: true }))

    logger.info('Deleted topic', { id })
  }

  deleteByIds(ids: string[]): DeleteTopicsResult {
    const dbService = application.get('DbService')
    const deletedIds = dbService.withWriteTx((tx) => this.deleteManyByIdsTx(tx, ids, { requireAll: true }))

    logger.info('Deleted topics', { count: deletedIds.length })

    return { deletedIds, deletedCount: deletedIds.length }
  }

  private deleteManyByIdsTx(tx: DbOrTx, ids: string[], options: { requireAll?: boolean } = {}): string[] {
    const uniqueIds = Array.from(new Set(ids))
    if (uniqueIds.length === 0) return []

    const rows = tx
      .select({ id: topicTable.id })
      .from(topicTable)
      .where(and(inArray(topicTable.id, uniqueIds), isNull(topicTable.deletedAt)))
      .all()
    const deletedIds = rows.map((row) => row.id)

    if (options.requireAll && deletedIds.length !== uniqueIds.length) {
      const foundIds = new Set(deletedIds)
      const missingId = uniqueIds.find((candidate) => !foundIds.has(candidate)) ?? uniqueIds[0]
      throw DataApiErrorFactory.notFound('Topic', missingId)
    }
    if (deletedIds.length === 0) return []

    const messageService = getDataService('MessageService')
    messageService.purgeByTopicIdsTx(tx, deletedIds)
    tagService.purgeForEntitiesTx(tx, 'topic', deletedIds)
    pinService.purgeForEntitiesTx(tx, 'topic', deletedIds)
    tx.delete(topicTable).where(inArray(topicTable.id, deletedIds)).run()
    return deletedIds
  }

  setActiveNode(topicId: string, nodeId: string): { activeNodeId: string } {
    application.get('DbService').withWriteTx((tx) => this.setActiveNodeTx(tx, topicId, nodeId))
    logger.info('Set active node', { topicId, activeNodeId: nodeId })
    return { activeNodeId: nodeId }
  }

  /**
   * Tx-aware variant — composes inside a caller's transaction (e.g.
   * MessageService.create / fork). Validates the topic is not soft-deleted
   * and the message belongs to it. Skip validation by passing `assumeValid`
   * when the caller has already verified the (topicId, nodeId) pair.
   */
  setActiveNodeTx(tx: DbOrTx, topicId: string, nodeId: string, options: { assumeValid?: boolean } = {}): void {
    if (!options.assumeValid) {
      const [topic] = tx
        .select({ id: topicTable.id })
        .from(topicTable)
        .where(and(eq(topicTable.id, topicId), isNull(topicTable.deletedAt)))
        .limit(1)
        .all()
      if (!topic) throw DataApiErrorFactory.notFound('Topic', topicId)

      const [message] = tx
        .select({ topicId: messageTable.topicId, role: messageTable.role })
        .from(messageTable)
        .where(and(eq(messageTable.id, nodeId), isNull(messageTable.deletedAt)))
        .limit(1)
        .all()
      if (!message || message.topicId !== topicId) {
        throw DataApiErrorFactory.notFound('Message', nodeId)
      }
      // The virtual root is structural and never the active node — pointing activeNodeId
      // at it would make the branch/tree reads resolve to an empty conversation.
      if (message.role === 'root') {
        throw DataApiErrorFactory.invalidOperation(
          'set active node to the virtual root',
          'the virtual root cannot be the active node'
        )
      }
    }

    const updated = tx
      .update(topicTable)
      .set({ activeNodeId: nodeId })
      .where(and(eq(topicTable.id, topicId), isNull(topicTable.deletedAt)))
      .returning({ id: topicTable.id })
      .all()
    if (updated.length !== 1) throw DataApiErrorFactory.notFound('Topic', topicId)
  }

  clearActiveNodeTx(tx: DbOrTx, topicId: string): void {
    const updated = tx
      .update(topicTable)
      .set({ activeNodeId: null })
      .where(and(eq(topicTable.id, topicId), isNull(topicTable.deletedAt)))
      .returning({ id: topicTable.id })
      .all()
    if (updated.length !== 1) throw DataApiErrorFactory.notFound('Topic', topicId)
  }

  /**
   * Two independent list streams — pinned and ordinary rows never mix in one
   * response or cursor:
   *
   * - `pinned === true` → pin-owned stream ordered by `pin.orderKey ASC,
   *   topic.id ASC`, independent of `sortBy` (ignored on this path).
   * - otherwise → ordinary keyset stream ordered by `sortBy ?? 'createdAt'`
   *   (`createdAt`/`updatedAt` → `DESC, id ASC`; `orderKey` → `ASC, id ASC`).
   *   `pinned === false` excludes pinned rows (the flat view's ordinary band);
   *   omitting `pinned` lists every row in the chosen order.
   *
   * Omitting `sortBy` defaults to `createdAt` — there is no legacy composite
   * pinned-then-ordinary view. Every paged caller selects one stream.
   */
  listByCursor(query: ListTopicsQuery = {}): CursorPaginationResponse<TopicListItem> {
    if (query.pinned === true) {
      return this.listPinnedByCursor(query)
    }
    return this.listFlatByCursor(query, query.sortBy ?? 'createdAt')
  }

  /**
   * Pinned-only page. Pin order is its own business order and deliberately
   * ignores `query.sortBy` when both fields are supplied.
   */
  private listPinnedByCursor(query: ListTopicsQuery): CursorPaginationResponse<TopicListItem> {
    const db = application.get('DbService').getDb()
    const limit = Math.min(query.limit ?? DEFAULT_LIMIT, MAX_LIMIT)
    const filters = buildRecordFilters(query)
    const { where, orderBy } = keysetOrdering(pinTable.orderKey, topicTable.id, { major: 'asc', tie: 'asc' })
    const cursor = decodeListCursor(query.cursor, asStringKey, 'topics-pinned')
    if (cursor) filters.push(where(cursor))

    const rows = db
      .select({ topic: topicTable, pinId: pinTable.id, pinOrderKey: pinTable.orderKey })
      .from(topicTable)
      .innerJoin(pinTable, and(eq(pinTable.entityType, 'topic'), eq(pinTable.entityId, topicTable.id)))
      .leftJoin(assistantTable, and(eq(topicTable.assistantId, assistantTable.id), isNull(assistantTable.deletedAt)))
      .where(and(...filters))
      .orderBy(...orderBy)
      .limit(limit + 1)
      .all()

    const hasMore = rows.length > limit
    const pageRows = rows.slice(0, limit)
    const last = pageRows[pageRows.length - 1]

    return {
      items: pageRows.map((row) => toTopicListItem(rowToTopic(row.topic), row.pinId)),
      nextCursor: hasMore ? encodeCursor(last.pinOrderKey, last.topic.id) : undefined
    }
  }

  /**
   * Flat single-stream page: `createdAt` → immutable creation
   * order, `updatedAt` → activity order (both `DESC, id ASC`), and `orderKey`
   * → manual order (`ASC, id ASC`). Cursor is the shared `(sortValue, id)`
   * tuple codec; a value cursor stays valid when its anchor row is deleted.
   * Mutating `updatedAt` or `orderKey` between page requests may move a row
   * across the boundary; callers restart pagination after local mutations that
   * affect either sort key.
   */
  private listFlatByCursor(query: ListTopicsQuery, sortBy: TopicSortBy): CursorPaginationResponse<TopicListItem> {
    const db = application.get('DbService').getDb()
    const limit = Math.min(query.limit ?? DEFAULT_LIMIT, MAX_LIMIT)

    const filters = buildRecordFilters(query)
    if (query.pinned === false) {
      const pinnedSubquery = db.select({ id: pinTable.entityId }).from(pinTable).where(eq(pinTable.entityType, 'topic'))
      filters.push(notInArray(topicTable.id, pinnedSubquery))
    }

    const isTimestampSort = sortBy === 'createdAt' || sortBy === 'updatedAt'
    const timestampColumn = sortBy === 'createdAt' ? topicTable.createdAt : topicTable.updatedAt
    const { where, orderBy } = isTimestampSort
      ? keysetOrdering(timestampColumn, topicTable.id, { major: 'desc', tie: 'asc' })
      : keysetOrdering(topicTable.orderKey, topicTable.id, { major: 'asc', tie: 'asc' })
    const cursor = isTimestampSort
      ? decodeListCursor(query.cursor, asNumericKey, 'topics-flat')
      : decodeListCursor(query.cursor, asStringKey, 'topics-flat')
    if (cursor) filters.push(where(cursor))

    const rows = db
      .select({ topic: topicTable, pinId: pinTable.id })
      .from(topicTable)
      .leftJoin(pinTable, and(eq(pinTable.entityType, 'topic'), eq(pinTable.entityId, topicTable.id)))
      .leftJoin(assistantTable, and(eq(topicTable.assistantId, assistantTable.id), isNull(assistantTable.deletedAt)))
      .where(and(...filters))
      .orderBy(...orderBy)
      .limit(limit + 1)
      .all()

    const hasMore = rows.length > limit
    const pageRows = rows.slice(0, limit)
    const last = pageRows[pageRows.length - 1]
    const nextCursor = hasMore
      ? encodeCursor(
          sortBy === 'createdAt'
            ? last.topic.createdAt
            : sortBy === 'updatedAt'
              ? last.topic.updatedAt
              : last.topic.orderKey,
          last.topic.id
        )
      : undefined

    return {
      items: pageRows.map((row) => toTopicListItem(rowToTopic(row.topic), row.pinId)),
      nextCursor
    }
  }

  /**
   * Factual aggregation for `GET /topics/stats`. Counts include
   * pinned rows; the renderer derives display counts (`count - pinnedCount`).
   * Runs separately from list reads, so a subsequent refetch reconciles any
   * transient disagreement between their independent SQLite snapshots.
   */
  stats(query: TopicStatsQuery = {}): TopicStats {
    const db = application.get('DbService').getDb()
    const filters = buildRecordFilters(query)
    const pinJoin = and(eq(pinTable.entityType, 'topic'), eq(pinTable.entityId, topicTable.id))
    const assistantScope = sql<string | null>`CASE
      WHEN ${assistantTable.id} IS NULL THEN NULL
      ELSE ${topicTable.assistantId}
    END`

    const byAssistantRows = db
      .select({
        assistantId: assistantScope,
        count: count(),
        pinnedCount: count(pinTable.id)
      })
      .from(topicTable)
      .leftJoin(pinTable, pinJoin)
      .leftJoin(assistantTable, and(eq(topicTable.assistantId, assistantTable.id), isNull(assistantTable.deletedAt)))
      .where(and(...filters))
      .groupBy(assistantScope)
      .all()

    let total = 0
    let pinnedCount = 0
    for (const row of byAssistantRows) {
      total += row.count
      pinnedCount += row.pinnedCount
    }

    return {
      total,
      pinnedCount,
      byAssistant: byAssistantRows.map((row) => ({
        assistantId: row.assistantId,
        count: row.count,
        pinnedCount: row.pinnedCount
      }))
    }
  }

  search(query: { q: string; limit: number; updatedAtFrom?: number }): TopicEntitySearchItem[] {
    const db = application.get('DbService').getDb()
    const limit = Math.min(query.limit, MAX_LIMIT)
    const filters: SQL[] = [isNull(topicTable.deletedAt)]
    const search = buildSearchPredicate(query.q)
    if (search) filters.push(search)
    if (query.updatedAtFrom !== undefined) {
      filters.push(gte(topicTable.updatedAt, query.updatedAtFrom))
    }

    const rows = db
      .select({
        id: topicTable.id,
        name: topicTable.name,
        assistantId: topicTable.assistantId,
        assistantName: assistantTable.name,
        updatedAt: topicTable.updatedAt
      })
      .from(topicTable)
      .leftJoin(assistantTable, and(eq(topicTable.assistantId, assistantTable.id), isNull(assistantTable.deletedAt)))
      .where(and(...filters))
      .orderBy(desc(topicTable.updatedAt), asc(topicTable.id))
      .limit(limit)
      .all()

    return rows.map((row) => ({
      type: 'topic',
      id: row.id,
      title: row.name,
      subtitle: row.assistantName ?? undefined,
      updatedAt: timestampToISO(row.updatedAt),
      target: { topicId: row.id, assistantId: row.assistantId ?? undefined }
    }))
  }

  reorder(id: string, anchor: OrderRequest): void {
    const db = application.get('DbService').getDb()
    db.transaction((tx) => {
      applyMoves(tx, topicTable, [{ id, anchor }], {
        pkColumn: topicTable.id,
        scope: isNull(topicTable.deletedAt)
      })
    })
  }

  reorderBatch(moves: Array<{ id: string; anchor: OrderRequest }>): void {
    if (moves.length === 0) return

    const db = application.get('DbService').getDb()
    db.transaction((tx) => {
      const ids = moves.map((m) => m.id)
      const targets = tx
        .select({ id: topicTable.id })
        .from(topicTable)
        .where(and(inArray(topicTable.id, ids), isNull(topicTable.deletedAt)))
        .all()

      if (targets.length !== ids.length) {
        const found = new Set(targets.map((t) => t.id))
        const missing = ids.find((id) => !found.has(id)) ?? ids[0]
        throw DataApiErrorFactory.notFound('Topic', missing)
      }
      applyMoves(tx, topicTable, moves, {
        pkColumn: topicTable.id,
        scope: isNull(topicTable.deletedAt)
      })
    })
  }

  deleteByAssistantId(assistantId: string): DeleteTopicsResult {
    const dbService = application.get('DbService')
    const deletedIds = dbService.withWriteTx((tx) => this.deleteByAssistantIdTx(tx, assistantId))

    logger.info('Deleted assistant topics', { assistantId, count: deletedIds.length })

    return { deletedIds, deletedCount: deletedIds.length }
  }

  deleteByAssistantIdTx(tx: DbOrTx, assistantId: string, options: { validateAssistant?: boolean } = {}): string[] {
    if (options.validateAssistant ?? true) {
      assertActiveAssistantTx(tx, assistantId)
    }

    const rows = tx
      .select({ id: topicTable.id })
      .from(topicTable)
      .where(and(eq(topicTable.assistantId, assistantId), isNull(topicTable.deletedAt)))
      .all()

    return this.deleteManyByIdsTx(
      tx,
      rows.map((row) => row.id)
    )
  }
}

export const topicService = new TopicService()

registerDataService('TopicService', topicService)
