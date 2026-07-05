// Topic CRUD, branch switching, ordering.

import { randomBytes } from 'node:crypto'

import { application } from '@application'
import { assistantTable } from '@data/db/schemas/assistant'
import { chatMessageFileRefTable } from '@data/db/schemas/fileRelations'
import { messageTable } from '@data/db/schemas/message'
import { pinTable } from '@data/db/schemas/pin'
import { topicTable } from '@data/db/schemas/topic'
import type { DbOrTx } from '@data/db/types'
import { loggerService } from '@logger'
import { DataApiErrorFactory } from '@shared/data/api'
import type { CursorPaginationResponse } from '@shared/data/api/apiTypes'
import type { OrderRequest } from '@shared/data/api/schemas/_endpointHelpers'
import type { EntitySearchItem } from '@shared/data/api/schemas/search'
import type {
  CreateTopicDto,
  DeleteTopicsResult,
  DuplicateTopicDto,
  ListTopicsQuery,
  RestoreTopicsResult,
  UpdateTopicDto
} from '@shared/data/api/schemas/topics'
import type { Topic } from '@shared/data/types/topic'
import type { SQL } from 'drizzle-orm'
import { and, asc, desc, eq, gt, gte, inArray, isNotNull, isNull, lt, notInArray, or, sql } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'

import { getDataService, registerDataService } from './dataServiceRegistry'
import { pinService } from './PinService'
import { tagService } from './TagService'
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
  const { deletedAt, ...clean } = nullsToUndefined(row)
  return {
    ...clean,
    createdAt: timestampToISO(row.createdAt),
    updatedAt: timestampToISO(row.updatedAt),
    // Read-only trash marker: present iff the row is archived (mirrors FileEntry).
    ...(deletedAt != null ? { deletedAt: timestampToISO(deletedAt) } : {})
  }
}

function topicScopePredicate(groupId: string | null): SQL {
  return groupId === null ? isNull(topicTable.groupId) : eq(topicTable.groupId, groupId)
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
    const groupId = dto.groupId ?? null

    const row = dbService.withWriteTx((tx) => {
      const topicRow = insertWithOrderKey(
        tx,
        topicTable,
        {
          name: dto.name,
          assistantId: dto.assistantId,
          groupId,
          activeNodeId: null
        },
        {
          pkColumn: topicTable.id,
          position: 'first',
          scope: topicScopePredicate(groupId)
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
          groupId: sourceTopic.groupId,
          activeNodeId: null
        },
        {
          pkColumn: topicTable.id,
          // Keep duplicated conversations aligned with newly created agent sessions: newest active work appears first.
          position: 'first',
          scope: topicScopePredicate(sourceTopic.groupId ?? null)
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
      if (dto.assistantId !== undefined) updates.assistantId = dto.assistantId
      if (dto.groupId !== undefined) updates.groupId = dto.groupId

      const [row] = tx.update(topicTable).set(updates).where(eq(topicTable.id, id)).returning().all()
      if (!row) throw DataApiErrorFactory.notFound('Topic', id)

      return rowToTopic(row)
    })

    logger.info('Updated topic', { id, changes: Object.keys(dto) })

    return topic
  }

  /**
   * Archive by default (soft delete: `deletedAt = now`, messages untouched);
   * `permanent: true` hard-deletes via the purge path (messages + tag/pin purge).
   * Any soft-delete path MUST also call
   * `pinService.purgeForEntitiesTx(tx, 'topic', [id])` — a surviving pin row
   * makes `listByCursor`'s JOIN silently hide the topic from both sections.
   * Disk attachments of purged messages are reclaimed by the file orphan sweep.
   */
  delete(id: string, options: { permanent?: boolean } = {}): void {
    const dbService = application.get('DbService')
    if (options.permanent === true) {
      dbService.withWriteTx((tx) => this.purgeManyByIdsTx(tx, [id], { requireAll: true }))
      logger.info('Permanently deleted topic', { id })
      return
    }
    dbService.withWriteTx((tx) => this.archiveManyByIdsTx(tx, [id], { requireAll: true }))
    logger.info('Archived topic', { id })
  }

  deleteByIds(ids: string[], options: { permanent?: boolean } = {}): DeleteTopicsResult {
    const permanent = options.permanent === true
    const dbService = application.get('DbService')
    const deletedIds = dbService.withWriteTx((tx) =>
      permanent
        ? this.purgeManyByIdsTx(tx, ids, { requireAll: true })
        : this.archiveManyByIdsTx(tx, ids, { requireAll: true })
    )

    logger.info(permanent ? 'Permanently deleted topics' : 'Archived topics', { count: deletedIds.length })

    return { deletedIds, deletedCount: deletedIds.length }
  }

  /**
   * Soft delete: sets `deletedAt` on the topic rows only. Messages stay in
   * place (hidden via the archived container) so restore is lossless; pins and
   * tags are purged immediately and NOT restored (RFC §3.4 — a surviving pin
   * row would hide the topic from `listByCursor`'s JOIN).
   */
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

  /**
   * Hard delete: purges messages, tags, and pins, then deletes the topic rows.
   * The row select intentionally does NOT filter `deletedAt` so already-archived
   * topics can be permanently deleted from the trash.
   */
  private purgeManyByIdsTx(tx: DbOrTx, ids: string[], options: { requireAll?: boolean } = {}): string[] {
    const uniqueIds = Array.from(new Set(ids))
    if (uniqueIds.length === 0) return []

    const rows = tx.select({ id: topicTable.id }).from(topicTable).where(inArray(topicTable.id, uniqueIds)).all()
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

  /** Restore an archived topic. Pins/tags purged at archive time are NOT restored. */
  restore(id: string): Topic {
    const topic = application.get('DbService').withWriteTx((tx) => {
      const [row] = tx
        .update(topicTable)
        .set({ deletedAt: null })
        .where(and(eq(topicTable.id, id), isNotNull(topicTable.deletedAt)))
        .returning()
        .all()
      if (!row) throw DataApiErrorFactory.notFound('Topic', id)
      return rowToTopic(row)
    })

    logger.info('Restored topic', { id })

    return topic
  }

  /**
   * Bulk restore. Idempotent: missing or already-active ids are simply omitted
   * from `restoredIds` (no requireAll semantics, mirroring bulk session deletes).
   */
  restoreByIds(ids: string[]): RestoreTopicsResult {
    const uniqueIds = Array.from(new Set(ids))
    const restoredIds = application.get('DbService').withWriteTx((tx) => {
      const restored: string[] = []
      for (let i = 0; i < uniqueIds.length; i += SQLITE_INARRAY_CHUNK) {
        const chunk = uniqueIds.slice(i, i + SQLITE_INARRAY_CHUNK)
        const rows = tx
          .update(topicTable)
          .set({ deletedAt: null })
          .where(and(inArray(topicTable.id, chunk), isNotNull(topicTable.deletedAt)))
          .returning({ id: topicTable.id })
          .all()
        restored.push(...rows.map((row) => row.id))
      }
      return restored
    })

    logger.info('Restored topics', { count: restoredIds.length })

    return { restoredIds }
  }

  /**
   * Hard-delete archived topics whose `deletedAt` is older than `cutoffMs`,
   * up to `limit` rows. Consumed by the trash purge job. Returns purged ids.
   */
  purgeExpiredTx(tx: DbOrTx, cutoffMs: number, limit: number): string[] {
    const rows = tx
      .select({ id: topicTable.id })
      .from(topicTable)
      .where(and(isNotNull(topicTable.deletedAt), lt(topicTable.deletedAt, cutoffMs)))
      .limit(limit)
      .all()
    if (rows.length === 0) return []
    return this.purgeManyByIdsTx(
      tx,
      rows.map((row) => row.id)
    )
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
   * Two-section page: pinned topics (via `pin` JOIN, ordered by pin.orderKey)
   * then unpinned (ordered by `updatedAt DESC, id ASC`). A partial pin page
   * spills into the unpinned section to fill `limit`. `topic.orderKey` is
   * maintained but unused at read time — it's there for a future drag-mode
   * toggle.
   *
   * `inTrash: true` lists archived topics instead: the pin section is skipped
   * entirely (archiving purges pins) and the topic-section query flips to
   * `isNotNull(deletedAt)` with the same `(updatedAt DESC, id ASC)` cursor.
   */
  listByCursor(query: ListTopicsQuery = {}): CursorPaginationResponse<Topic> {
    const db = application.get('DbService').getDb()
    const limit = Math.min(query.limit ?? DEFAULT_LIMIT, MAX_LIMIT)
    const cursor: Cursor = query.cursor ? decodeCursor(query.cursor) : { section: 'pin', orderKey: '' }
    const search = buildSearchPredicate(query.q)
    const inTrash = query.inTrash === true

    const items: Array<{ topic: Topic; pinOrderKey?: string }> = []

    if (!inTrash && cursor.section === 'pin') {
      const pinAfter = cursor.orderKey ? gt(pinTable.orderKey, cursor.orderKey) : undefined
      const pinRows = db
        .select({ topic: topicTable, pinOrderKey: pinTable.orderKey })
        .from(topicTable)
        .innerJoin(pinTable, and(eq(pinTable.entityType, 'topic'), eq(pinTable.entityId, topicTable.id)))
        .where(and(isNull(topicTable.deletedAt), pinAfter, search))
        .orderBy(asc(pinTable.orderKey), asc(topicTable.id))
        .limit(limit + 1)
        .all()

      // Stale pin cursor (anchor row deleted between requests) → 0 rows for a
      // non-empty `cursor.orderKey`. Hand back a topic-section-start cursor so
      // the next call advances cleanly instead of restarting topics from the top.
      if (pinRows.length === 0 && cursor.orderKey !== '') {
        return { items: [], nextCursor: encodeTopicSectionStart() }
      }

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

    // In trash mode the notInArray(pinned) filter is harmless — archived topics
    // have no pin rows — so the query shape stays identical to the active list.
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
      .orderBy(desc(topicTable.updatedAt), asc(topicTable.id))
      .limit(remaining + 1)
      .all()

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
      const [target] = tx
        .select({ groupId: topicTable.groupId })
        .from(topicTable)
        .where(and(eq(topicTable.id, id), isNull(topicTable.deletedAt)))
        .limit(1)
        .all()
      if (!target) throw DataApiErrorFactory.notFound('Topic', id)

      applyMoves(tx, topicTable, [{ id, anchor }], {
        pkColumn: topicTable.id,
        scope: topicScopePredicate(target.groupId)
      })
    })
  }

  /** Cross-scope (mixed `groupId`) batches are rejected with VALIDATION_ERROR. */
  reorderBatch(moves: Array<{ id: string; anchor: OrderRequest }>): void {
    if (moves.length === 0) return

    const db = application.get('DbService').getDb()
    db.transaction((tx) => {
      const ids = moves.map((m) => m.id)
      const targets = tx
        .select({ id: topicTable.id, groupId: topicTable.groupId })
        .from(topicTable)
        .where(and(inArray(topicTable.id, ids), isNull(topicTable.deletedAt)))
        .all()

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
      applyMoves(tx, topicTable, moves, {
        pkColumn: topicTable.id,
        scope: topicScopePredicate(scopeValue ?? null)
      })
    })
  }

  deleteByAssistantId(assistantId: string): DeleteTopicsResult {
    const dbService = application.get('DbService')
    const deletedIds = dbService.withWriteTx((tx) => this.deleteByAssistantIdTx(tx, assistantId))

    logger.info('Archived assistant topics', { assistantId, count: deletedIds.length })

    return { deletedIds, deletedCount: deletedIds.length }
  }

  /** Archives (soft-deletes) the assistant's live topics — RFC §4.3: assistant-scoped topic deletes archive. */
  deleteByAssistantIdTx(tx: DbOrTx, assistantId: string, options: { validateAssistant?: boolean } = {}): string[] {
    if (options.validateAssistant ?? true) {
      const [assistant] = tx
        .select({ id: assistantTable.id })
        .from(assistantTable)
        .where(and(eq(assistantTable.id, assistantId), isNull(assistantTable.deletedAt)))
        .limit(1)
        .all()
      if (!assistant) throw DataApiErrorFactory.notFound('Assistant', assistantId)
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
