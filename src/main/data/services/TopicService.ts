// Topic CRUD, branch switching, ordering.

import { randomBytes } from 'node:crypto'

import { application } from '@application'
import { notifyDataApiDataChange } from '@data/dataApiDataChange'
import { assistantTable } from '@data/db/schemas/assistant'
import { chatMessageFileRefTable } from '@data/db/schemas/fileRelations'
import { messageTable } from '@data/db/schemas/message'
import { pinTable } from '@data/db/schemas/pin'
import { topicTable } from '@data/db/schemas/topic'
import type { DbOrTx } from '@data/db/types'
import { loggerService } from '@logger'
import { DataApiErrorFactory } from '@shared/data/api/errors'
import type { OrderRequest } from '@shared/data/api/schemas/_endpointHelpers'
import type { EntitySearchItem } from '@shared/data/api/schemas/search'
import type {
  CreateTopicDto,
  DeleteTopicsResult,
  DuplicateTopicDto,
  LatestTopicQuery,
  ListTopicsQuery,
  MoveTopicDto,
  ReusableTopicPlaceholderResponse,
  ReuseOrCreateTopicDto,
  UpdateTopicDto
} from '@shared/data/api/schemas/topics'
import type { CursorPaginationResponse } from '@shared/data/api/types'
import type { Topic } from '@shared/data/types/topic'
import type { SQL } from 'drizzle-orm'
import { and, asc, desc, eq, gt, gte, inArray, isNotNull, isNull, lt, notInArray, or, sql } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'

import { getDataService, registerDataService } from './dataServiceRegistry'
import { pinService } from './PinService'
import { tagService } from './TagService'
import { applyMoves, insertWithOrderKey } from './utils/orderKey'
import {
  decodePinnedListCursor,
  encodeEntityCursor,
  encodeEntitySectionStart,
  encodePinCursor
} from './utils/pinnedListCursor'
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
    lastActivityAt: timestampToISO(row.lastActivityAt),
    createdAt: timestampToISO(row.createdAt),
    updatedAt: timestampToISO(row.updatedAt),
    deletedAt: row.deletedAt != null ? timestampToISO(row.deletedAt) : undefined
  }
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

function assertActiveAssistantTx(tx: Pick<DbOrTx, 'select'>, assistantId: string): void {
  const [assistant] = tx
    .select({ id: assistantTable.id })
    .from(assistantTable)
    .where(and(eq(assistantTable.id, assistantId), isNull(assistantTable.deletedAt)))
    .limit(1)
    .all()
  if (!assistant) throw DataApiErrorFactory.notFound('Assistant', assistantId)
}

export class TopicService {
  notifyReadModelChange(topicIds: readonly string[], kind: 'membership' | 'projection'): void {
    if (topicIds.length === 0) return
    const entityIds = [...new Set(topicIds)]
    notifyDataApiDataChange([
      { endpoint: '/topics', kind, entityIds },
      { endpoint: '/topics', kind: 'order', dimension: 'lastActivityAt', entityIds },
      { endpoint: '/topics/:id', entityIds },
      { endpoint: '/topics/latest' }
    ])
  }

  notifyPurged(topicIds: readonly string[]): void {
    if (topicIds.length === 0) return
    this.notifyReadModelChange(topicIds, 'membership')
    notifyDataApiDataChange([
      { endpoint: '/topics/:topicId/messages', kind: 'membership' },
      { endpoint: '/topics/:topicId/tree' },
      { endpoint: '/messages/:id' }
    ])
  }

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
   * The single most-recently-active non-deleted topic across all assistants, or
   * `null` when the library is empty.
   *
   * First-entry restore resumes the last-touched conversation. It cannot read the
   * regular first page of `listByCursor` for this: that page is pinned-first then
   * unpinned-by-`orderKey` (manual/creation order), so the globally latest-active
   * topic is not guaranteed to be on it. This `lastActivityAt DESC LIMIT 1` proves global
   * latest independent of how the rail happens to page.
   *
   * An optional `assistantId` narrows the scan to one assistant's topics — used by
   * per-assistant sidebar entries to resume that assistant's last conversation.
   */
  getLatestActive(query: LatestTopicQuery = {}): Topic | null {
    const db = application.get('DbService').getDb()
    const ownerFilter =
      query.assistantId === 'unlinked'
        ? isNull(assistantTable.id)
        : query.assistantId
          ? eq(assistantTable.id, query.assistantId)
          : undefined

    const [row] = db
      .select({ topic: topicTable })
      .from(topicTable)
      .leftJoin(assistantTable, and(eq(topicTable.assistantId, assistantTable.id), isNull(assistantTable.deletedAt)))
      .where(and(isNull(topicTable.deletedAt), ownerFilter))
      .orderBy(desc(topicTable.lastActivityAt), asc(topicTable.id))
      .limit(1)
      .all()

    return row ? rowToTopic(row.topic) : null
  }

  /** Reuse or create one exact empty placeholder under a serialized write transaction. */
  reuseOrCreatePlaceholder(dto: ReuseOrCreateTopicDto): ReusableTopicPlaceholderResponse {
    const result = application.get('DbService').withWriteTx((tx) => {
      if (dto.assistantId) assertActiveAssistantTx(tx, dto.assistantId)

      const [reusable] = tx
        .select({ topic: topicTable })
        .from(topicTable)
        .leftJoin(assistantTable, and(eq(topicTable.assistantId, assistantTable.id), isNull(assistantTable.deletedAt)))
        .where(
          and(
            isNull(topicTable.deletedAt),
            dto.assistantId ? eq(assistantTable.id, dto.assistantId) : isNull(topicTable.assistantId),
            dto.excludeTopicId ? notInArray(topicTable.id, [dto.excludeTopicId]) : undefined,
            isNull(topicTable.activeNodeId),
            eq(topicTable.isNameManuallyEdited, false),
            sql`trim(${topicTable.name}) = ''`
          )
        )
        .orderBy(desc(topicTable.updatedAt), asc(topicTable.id))
        .limit(1)
        .all()

      if (reusable) return { row: reusable.topic, created: false }
      return {
        row: this.createTx(tx, { assistantId: dto.assistantId ?? undefined }),
        created: true
      }
    })

    if (result.created) {
      this.notifyReadModelChange([result.row.id], 'membership')
      logger.info('Created empty topic', { id: result.row.id })
    }

    return { topic: rowToTopic(result.row), created: result.created }
  }

  /** Monotonically advance a topic's activity time within the caller's write transaction. */
  advanceLastActivityAtTx(tx: DbOrTx, topicId: string, timestamp: number): void {
    const updated = tx
      .update(topicTable)
      .set({
        lastActivityAt: sql`max(${topicTable.lastActivityAt}, ${timestamp})`,
        updatedAt: sql`max(${topicTable.updatedAt}, ${timestamp})`
      })
      .where(and(eq(topicTable.id, topicId), isNull(topicTable.deletedAt)))
      .returning({ id: topicTable.id })
      .all()
    if (updated.length !== 1) throw DataApiErrorFactory.notFound('Topic', topicId)
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
    const row = application.get('DbService').withWriteTx((tx) => this.createTx(tx, dto))
    this.notifyReadModelChange([row.id], 'membership')

    logger.info('Created empty topic', { id: row.id })

    return rowToTopic(row)
  }

  private createTx(tx: DbOrTx, dto: CreateTopicDto): TopicRow {
    const createdAt = Date.now()
    const topicRow = insertWithOrderKey(
      tx,
      topicTable,
      {
        name: dto.name,
        assistantId: dto.assistantId,
        activeNodeId: null,
        lastActivityAt: createdAt,
        createdAt,
        updatedAt: createdAt
      },
      {
        pkColumn: topicTable.id,
        position: 'first',
        scope: isNull(topicTable.deletedAt)
      }
    ) as TopicRow
    getDataService('MessageService').createRootMessageTx(tx, topicRow.id)
    return topicRow
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
    this.notifyReadModelChange([copiedTopic.id], 'membership')

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
    this.notifyReadModelChange([id], 'projection')

    logger.info('Updated topic', { id, changes: Object.keys(dto) })

    return topic
  }

  /** Atomically update a topic's assistant and global order. */
  move(id: string, dto: MoveTopicDto): Topic {
    const topic = application.get('DbService').withWriteTx((tx) => {
      const [target] = tx
        .select({ id: topicTable.id })
        .from(topicTable)
        .where(and(eq(topicTable.id, id), isNull(topicTable.deletedAt)))
        .limit(1)
        .all()
      if (!target) throw DataApiErrorFactory.notFound('Topic', id)

      assertActiveAssistantTx(tx, dto.assistantId)

      if ('before' in dto.order || 'after' in dto.order) {
        const anchorId = 'before' in dto.order ? dto.order.before : dto.order.after
        if (anchorId === id) {
          const message = 'move: anchor topic must differ from the moved topic'
          throw DataApiErrorFactory.validation({ order: [message] }, message)
        }

        const [anchor] = tx
          .select({ assistantId: topicTable.assistantId })
          .from(topicTable)
          .where(and(eq(topicTable.id, anchorId), isNull(topicTable.deletedAt)))
          .limit(1)
          .all()
        if (!anchor) throw DataApiErrorFactory.notFound('Topic', anchorId)
        if (anchor.assistantId !== dto.assistantId) {
          const message = 'move: anchor topic must belong to the target assistant'
          throw DataApiErrorFactory.validation({ order: [message] }, message)
        }
      }

      tx.update(topicTable).set({ assistantId: dto.assistantId }).where(eq(topicTable.id, id)).run()
      applyMoves(tx, topicTable, [{ id, anchor: dto.order }], {
        pkColumn: topicTable.id,
        scope: isNull(topicTable.deletedAt)
      })

      const [row] = tx.select().from(topicTable).where(eq(topicTable.id, id)).limit(1).all()
      if (!row) throw DataApiErrorFactory.notFound('Topic', id)
      return rowToTopic(row)
    })
    this.notifyReadModelChange([id], 'projection')
    return topic
  }

  /** Archive by default; permanently remove the topic and messages on request. */
  delete(id: string, options: { permanent?: boolean } = {}): void {
    const dbService = application.get('DbService')
    const deletedIds = dbService.withWriteTx((tx) =>
      options.permanent === true
        ? this.purgeManyByIdsTx(tx, [id], { requireAll: true })
        : this.archiveManyByIdsTx(tx, [id], { requireAll: true })
    )
    this.notifyReadModelChange(deletedIds, 'membership')
    pinService.notifyPurged()

    logger.info(options.permanent === true ? 'Permanently deleted topic' : 'Archived topic', { id })
  }

  deleteByIds(ids: string[], options: { permanent?: boolean } = {}): DeleteTopicsResult {
    const dbService = application.get('DbService')
    const deletedIds = dbService.withWriteTx((tx) =>
      options.permanent === true
        ? this.purgeManyByIdsTx(tx, ids, { requireAll: true })
        : this.archiveManyByIdsTx(tx, ids, { requireAll: true })
    )
    this.notifyReadModelChange(deletedIds, 'membership')
    if (deletedIds.length > 0) pinService.notifyPurged()

    logger.info(options.permanent === true ? 'Permanently deleted topics' : 'Archived topics', {
      count: deletedIds.length
    })

    return { deletedIds, deletedCount: deletedIds.length }
  }

  private archiveManyByIdsTx(tx: DbOrTx, ids: string[], options: { requireAll?: boolean } = {}): string[] {
    const uniqueIds = Array.from(new Set(ids))
    if (uniqueIds.length === 0) return []

    const rows = tx
      .select({ id: topicTable.id })
      .from(topicTable)
      .where(and(inArray(topicTable.id, uniqueIds), isNull(topicTable.deletedAt)))
      .all()
    const archivedIds = rows.map((row) => row.id)

    if (options.requireAll && archivedIds.length !== uniqueIds.length) {
      const foundIds = new Set(archivedIds)
      const missingId = uniqueIds.find((candidate) => !foundIds.has(candidate)) ?? uniqueIds[0]
      throw DataApiErrorFactory.notFound('Topic', missingId)
    }
    if (archivedIds.length === 0) return []

    const now = Date.now()
    for (let i = 0; i < archivedIds.length; i += SQLITE_INARRAY_CHUNK) {
      tx.update(topicTable)
        .set({ deletedAt: now })
        .where(inArray(topicTable.id, archivedIds.slice(i, i + SQLITE_INARRAY_CHUNK)))
        .run()
    }
    tagService.purgeForEntitiesTx(tx, 'topic', archivedIds)
    pinService.purgeForEntitiesTx(tx, 'topic', archivedIds)

    return archivedIds
  }

  private purgeManyByIdsTx(tx: DbOrTx, ids: string[], options: { requireAll?: boolean } = {}): string[] {
    const uniqueIds = Array.from(new Set(ids))
    if (uniqueIds.length === 0) return []

    const rows = tx
      .select({ id: topicTable.id })
      .from(topicTable)
      .where(and(inArray(topicTable.id, uniqueIds), isNotNull(topicTable.deletedAt)))
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

  restore(id: string): Topic {
    const [row] = application
      .get('DbService')
      .getDb()
      .update(topicTable)
      .set({ deletedAt: null })
      .where(and(eq(topicTable.id, id), isNotNull(topicTable.deletedAt)))
      .returning()
      .all()
    if (!row) throw DataApiErrorFactory.notFound('Topic', id)

    this.notifyReadModelChange([id], 'membership')
    logger.info('Restored topic', { id })
    return rowToTopic(row)
  }

  purgeExpiredTx(tx: DbOrTx, cutoffMs: number, limit: number): string[] {
    const rows = tx
      .select({ id: topicTable.id })
      .from(topicTable)
      .where(and(isNotNull(topicTable.deletedAt), lt(topicTable.deletedAt, cutoffMs)))
      .limit(limit)
      .all()
    return this.purgeManyByIdsTx(
      tx,
      rows.map((row) => row.id)
    )
  }

  setActiveNode(topicId: string, nodeId: string): { activeNodeId: string } {
    application.get('DbService').withWriteTx((tx) => this.setActiveNodeTx(tx, topicId, nodeId))
    notifyDataApiDataChange([
      {
        endpoint: '/topics/:topicId/messages',
        kind: 'membership',
        routeParams: { topicId },
        entityIds: [nodeId]
      },
      { endpoint: '/topics/:topicId/tree', routeParams: { topicId }, entityIds: [nodeId] },
      { endpoint: '/topics', kind: 'projection', entityIds: [topicId] },
      { endpoint: '/topics/:id', routeParams: { id: topicId }, entityIds: [topicId] }
    ])
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
   * Two-section page: pinned topics (via `pin` JOIN, ordered by `pin.orderKey`)
   * then unpinned (ordered by `topic.orderKey ASC, id ASC` — manual/creation
   * drag order). A partial pin page spills into the unpinned section to fill
   * `limit`. This mirrors `AgentSessionService.listByCursor` so both rails share
   * one pagination contract (pinned-first, then manual order); recency ordering
   * for the time-grouped view is applied by the renderer over the loaded list.
   */
  listByCursor(query: ListTopicsQuery = {}): CursorPaginationResponse<Topic> {
    const db = application.get('DbService').getDb()
    const limit = Math.min(query.limit ?? DEFAULT_LIMIT, MAX_LIMIT)
    const cursor = decodePinnedListCursor(query.cursor, 'topic')
    const search = buildSearchPredicate(query.q)
    const inTrash = query.inTrash === true

    const items: Array<{ topic: Topic; pinOrderKey?: string }> = []

    if (!inTrash && cursor.section === 'pin') {
      const pinAfter = cursor.orderKey
        ? or(
            gt(pinTable.orderKey, cursor.orderKey),
            and(eq(pinTable.orderKey, cursor.orderKey), gt(topicTable.id, cursor.id))
          )
        : undefined
      const pinRows = db
        .select({ topic: topicTable, pinOrderKey: pinTable.orderKey })
        .from(topicTable)
        .innerJoin(pinTable, and(eq(pinTable.entityType, 'topic'), eq(pinTable.entityId, topicTable.id)))
        .where(and(isNull(topicTable.deletedAt), pinAfter, search))
        .orderBy(asc(pinTable.orderKey), asc(topicTable.id))
        .limit(limit + 1)
        .all()

      // Stale pin cursor (anchor row deleted between requests) → 0 rows for a
      // non-empty `cursor.orderKey`. Hand back an entity-section-start cursor so
      // the next call advances cleanly instead of restarting topics from the top.
      if (pinRows.length === 0 && cursor.orderKey !== '') {
        return { items: [], nextCursor: encodeEntitySectionStart() }
      }

      const hasMoreInPin = pinRows.length > limit
      for (const row of pinRows.slice(0, limit)) {
        items.push({ topic: rowToTopic(row.topic), pinOrderKey: row.pinOrderKey })
      }

      if (hasMoreInPin) {
        const last = items[items.length - 1]
        return {
          items: items.map((i) => i.topic),
          nextCursor: encodePinCursor(last.pinOrderKey ?? '', last.topic.id)
        }
      }

      if (items.length >= limit) {
        return {
          items: items.map((i) => i.topic),
          nextCursor: encodeEntitySectionStart()
        }
      }
    }

    // Tuple cursor `(orderKey, id)` over `ORDER BY orderKey ASC, id ASC`: the id
    // tiebreaker prevents dedup/skip across pages when two rows share an orderKey.
    const remaining = limit - items.length
    const pinnedSubquery = db.select({ id: pinTable.entityId }).from(pinTable).where(eq(pinTable.entityType, 'topic'))

    let topicAfter: SQL | undefined
    if (cursor.section === 'entity' && cursor.orderKey !== null) {
      topicAfter = inTrash
        ? or(
            lt(topicTable.updatedAt, Number(cursor.orderKey)),
            and(eq(topicTable.updatedAt, Number(cursor.orderKey)), gt(topicTable.id, cursor.id))
          )
        : or(
            gt(topicTable.orderKey, cursor.orderKey),
            and(eq(topicTable.orderKey, cursor.orderKey), gt(topicTable.id, cursor.id))
          )
    }

    const topicRows = db
      .select()
      .from(topicTable)
      .where(
        and(
          inTrash ? isNotNull(topicTable.deletedAt) : isNull(topicTable.deletedAt),
          notInArray(topicTable.id, pinnedSubquery),
          topicAfter,
          search
        )
      )
      .orderBy(
        ...(inTrash ? [desc(topicTable.updatedAt), asc(topicTable.id)] : [asc(topicTable.orderKey), asc(topicTable.id)])
      )
      .limit(remaining + 1)
      .all()

    const hasMoreInTopic = topicRows.length > remaining
    for (const row of topicRows.slice(0, remaining)) {
      items.push({ topic: rowToTopic(row) })
    }

    let nextCursor: string | undefined
    if (hasMoreInTopic) {
      const last = topicRows[remaining - 1]
      nextCursor = encodeEntityCursor(inTrash ? String(last.updatedAt) : last.orderKey, last.id)
    }

    return { items: items.map((i) => i.topic), nextCursor }
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
        lastActivityAt: topicTable.lastActivityAt
      })
      .from(topicTable)
      .leftJoin(assistantTable, and(eq(topicTable.assistantId, assistantTable.id), isNull(assistantTable.deletedAt)))
      .where(and(...filters))
      .orderBy(desc(topicTable.lastActivityAt), asc(topicTable.id))
      .limit(limit)
      .all()

    return rows.map((row) => ({
      type: 'topic',
      id: row.id,
      title: row.name,
      subtitle: row.assistantName ?? undefined,
      lastActivityAt: timestampToISO(row.lastActivityAt),
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
      applyMoves(tx, topicTable, moves, {
        pkColumn: topicTable.id,
        scope: isNull(topicTable.deletedAt)
      })
    })
  }

  deleteByAssistantId(assistantId: string): DeleteTopicsResult {
    const dbService = application.get('DbService')
    const deletedIds = dbService.withWriteTx((tx) => this.deleteByAssistantIdTx(tx, assistantId))
    this.notifyReadModelChange(deletedIds, 'membership')
    if (deletedIds.length > 0) pinService.notifyPurged()

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

    return this.archiveManyByIdsTx(
      tx,
      rows.map((row) => row.id)
    )
  }
}

export const topicService = new TopicService()

registerDataService('TopicService', topicService)
